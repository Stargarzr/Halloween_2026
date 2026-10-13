import {sameOrigin} from '@/lib/auth-request';
import { getMember, signOutPath } from '@/lib/auth';
import { database, bucket, hash, randomIndex, standings } from '@/lib/server';
import {categories} from '@/lib/shared';
import {aiConfig,generateBackground,vendorLabel,AiError} from '@/lib/ai';
export const dynamic='force-dynamic';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>json({error:message},status);
// The composite votes foreign key uses ON UPDATE/DELETE RESTRICT, which PostgreSQL reports as 23001 (restrict_violation); the plain entry reference reports 23503. Both mean "votes exist".
const votesLock=(e:unknown)=>['23503','23001'].includes((e as any)?.code);
// Transaction-scoped advisory lock keyed by image id, shared by save and delete, released at commit or rollback.
const imageLock=(image:string)=>database().prepare('SELECT pg_advisory_xact_lock(hashtext(?))').bind(image);
// Under the image-key lock that save also takes, re-check references and remove the photo only when none remain. Storage removal cannot be rolled back, so the transaction holds nothing but the lock and the check;
// a save that wins the lock first leaves a reference and the photo stays, a save that waits finds the photo gone and returns "not found". Shared by entry delete, photo replacement and the orphan sweep.
async function removeUnreferenced(key:string){if(!/^[a-f0-9-]{36}$/.test(key))return false;const db=database();return db.transaction(async run=>{await run(imageLock(key));if((await run(db.prepare('SELECT 1 FROM entries WHERE image=?').bind(key))).rows.length)return false;await bucket().delete(key);return true})}
// Photos uploaded but never attached to a contestant (editor closed, photo swapped before saving) are removed once they are older than CONTEST_ORPHAN_AGE_MS (default one hour, so an upload still being edited is never touched).
// Runs after save and delete, bounded per request, and only logs failures because the organizer's action has already succeeded.
async function sweepOrphans(){try{const cutoff=Date.now()-Number(process.env.CONTEST_ORPHAN_AGE_MS??3600000);const stale=(await bucket().list()).filter(o=>/^[a-f0-9-]{36}$/.test(o.key)&&o.uploaded.getTime()<cutoff);if(!stale.length)return;
const used=new Set((await database().prepare('SELECT image FROM entries').all()).results.map((r:any)=>r.image));let removed=0;for(const o of stale.filter(o=>!used.has(o.key)).slice(0,25))if(await removeUnreferenced(o.key))removed++;if(removed)console.log(`Removed ${removed} unused photo(s)`)}catch(e){console.error('Unused photo sweep failed',e)}}
async function state(){return (await database().prepare('SELECT state FROM event WHERE id=1').first<{state:string}>())?.state||'draft'}
// The event row is created by migration 0001 (and by applyLocalMigrations locally), so GET no longer runs an INSERT per poll.
export async function GET(){try{
const member=await getMember();if(!member)return fail('Sign in with your work email to access the contest.',401);
const db=database(),admin=member.admin;
const [s,rows,draws,roster]=await Promise.all([state(),standings(),db.prepare('SELECT * FROM draws').all().then(r=>r.results),admin?db.prepare('SELECT * FROM entries ORDER BY name').all().then(r=>r.results):null]);
// Visibility (UX 6): voters never see counts before results are final. Until the state is closed they get the standings rows with votes:null, ordered by category then name, and their entries are those same published rows.
const reveal=admin||s==='closed';
const visible=reveal?rows:rows.map((e:any)=>({...e,votes:null})).sort((a:any,b:any)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name));
const entries=roster??[...visible].sort((a:any,b:any)=>a.name.localeCompare(b.name)).map((e:any)=>({...e,votes:undefined}));
return json({state:s,admin,account:{email:member.email,localPreview:!!member.localPreview,signOut:signOutPath()},entries,standings:visible,draws,aiEnabled:admin&&aiConfig().enabled,aiTaglines:admin&&aiConfig().taglines,aiVendor:admin&&aiConfig().enabled?vendorLabel[aiConfig().vendor!]:null});
}catch(e){console.error(e);return fail('Contest storage is temporarily unavailable. Please try again.',503)}}
export async function POST(req:Request){try{
// Entry time for the AI generation budget: Netlify's 60 s limit counts from here, not from the vendor call.
const startedAt=Date.now();
const member=await getMember();if(!member)return fail('Sign in with your work email to access the contest.',401);
if(!sameOrigin(req))return fail('Please use the contest website.',403);
if(Number(req.headers.get('content-length')||0)>4.5*1024*1024)return fail('File is too large.',413);
const db=database();
if(req.headers.get('content-type')?.includes('multipart/form-data')){
if(!member.admin)return fail('Organizer login required.',403);
if(await state()==='closed')return fail('Results are finalized and the roster is locked.');
const form=await req.formData(),file=form.get('file');
if(!(file instanceof File)||file.size>4*1024*1024||file.size===0)return fail('Choose a JPG, PNG, or WebP image under 4 MB.');
const bytes=new Uint8Array(await file.arrayBuffer());const type=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'?'image/webp':'';
if(!type)return fail('Choose a valid JPG, PNG, or WebP image.');
const id=crypto.randomUUID();await bucket().put(id,bytes,{httpMetadata:{contentType:type}});return json({image:id});
}
const body:any=await req.json();if(!body||typeof body!=='object')return fail('Invalid request.');const action=body.action;
if(action==='vote'||action==='ballot'){
const voter=await hash(member.id);await db.prepare('INSERT INTO codes(hash,created) VALUES(?,?) ON CONFLICT DO NOTHING').bind(voter,new Date().toISOString()).run();
if(action==='ballot')return json({votes:(await db.prepare('SELECT category,entry FROM votes WHERE code=?').bind(voter).all()).results});
if(!categories.includes(body.category)||typeof body.entry!=='string')return fail('Select an eligible contestant.');
try{const r=await db.prepare("INSERT INTO votes(id,code,category,entry) SELECT ?,?,?,e.id FROM entries e,event s WHERE e.id=? AND e.category=? AND e.published=1 AND s.id=1 AND s.state='open'").bind(crypto.randomUUID(),voter,body.category,body.entry,body.category).run();if(!r.meta.changes)return fail('Voting is closed or this entry is unavailable.');}catch(e){const code=(e as any)?.code;if(code==='23505')return fail('Your account has already voted in this category.',409);if(votesLock(e))return fail('This entry is no longer available in that category.',409);throw e}
return json({ok:true});
}
if(!member.admin)return fail('Organizer login required.',403);
const current=await state();
if(action==='save'){
if(current==='closed')return fail('Results are finalized and the roster is locked.');
const e=body.entry||{};for(const [key,max] of [['name',80],['costume',100],['description',500],['tagline',140]] as const){if(typeof e[key]!=='string'||e[key].length>max||(key==='name'||key==='costume')&&!e[key].trim())return fail(`Please check the ${key} field.`)}
if(!categories.includes(e.category))return fail('Choose a category.');
if(typeof e.image!=='string'||!(/^[a-f0-9-]{36}$/.test(e.image)||/^sample:[0-5]$/.test(e.image)))return fail('Upload and review an image first.');
const id=e.id||crypto.randomUUID();
// The image key is locked for the whole save (existence check plus upsert) so a concurrent delete cannot remove the photo between the check and the insert; delete takes the same lock.
// The composite foreign key on votes refuses a category change or unpublish while votes exist; a save that leaves both unchanged passes.
try{const {outcome,previous}=await db.transaction(async run=>{
await run(imageLock(e.image));
if(!e.image.startsWith('sample:')&&!await bucket().head(e.image))return {outcome:'missing',previous:''};
const previous:string=(await run(db.prepare('SELECT image FROM entries WHERE id=?').bind(id))).rows[0]?.image||'';
await run(db.prepare("INSERT INTO entries(id,name,costume,category,description,tagline,image,published) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM event WHERE state='closed') ON CONFLICT(id) DO UPDATE SET name=excluded.name,costume=excluded.costume,category=excluded.category,description=excluded.description,tagline=excluded.tagline,image=excluded.image,published=excluded.published WHERE NOT EXISTS(SELECT 1 FROM event WHERE state='closed')").bind(id,e.name.trim(),e.costume.trim(),e.category,e.description,e.tagline,e.image,e.published===true||e.published===1?1:0));
return {outcome:'saved',previous}});
if(outcome==='missing')return fail('Uploaded image was not found. Please upload again.');
// A replaced photo is removed after the commit unless another contestant still uses it.
if(previous&&previous!==e.image){try{await removeUnreferenced(previous)}catch(storageError){console.error('Replaced photo removal failed',id,previous,storageError)}}}catch(err){if(votesLock(err))return fail('This contestant has votes, so its category and published status are locked.',409);throw err}
await sweepOrphans();
return json({ok:true});
}
if(action==='delete'){
if(current==='closed')return fail('Results are finalized and the roster is locked.',409);
if(typeof body.id!=='string')return fail('Choose a contestant to delete.');
const row=await db.prepare('SELECT image FROM entries WHERE id=?').bind(body.id).first<{image:string}>();if(!row)return fail('Contestant not found.',404);
// Step 1 commits the row deletion on its own. The votes foreign key refuses it while votes exist; the NOT EXISTS guard covers a finalize that lands between the state read and the delete.
try{const r=await db.prepare("DELETE FROM entries WHERE id=? AND NOT EXISTS(SELECT 1 FROM event WHERE state='closed')").bind(body.id).run();if(!r.meta.changes)return fail('Results are finalized and the roster is locked.',409)}catch(err){if(votesLock(err))return fail('This contestant has votes and cannot be deleted. Pause voting and reset the round first.',409);throw err}
// Step 2, after the commit: remove the photo unless another contestant still uses it. Failures here are logged: the row is already gone.
try{await removeUnreferenced(row.image)}catch(storageError){console.error('Photo removal failed after deleting entry',body.id,row.image,storageError)}
await sweepOrphans();
return json({ok:true});
}
if(action==='open'){
const list=await standings();if(categories.some(c=>!list.some((e:any)=>e.category===c)))return fail('Publish at least one entry in every category first.');
await db.prepare("INSERT INTO event(id,state) VALUES(1,'open') ON CONFLICT(id) DO UPDATE SET state='open' WHERE event.state IN ('draft','paused')").run();if(await state()!=='open')return fail('Finalized results cannot reopen.');return json({ok:true});
}
if(action==='close'){await db.prepare("UPDATE event SET state='paused' WHERE id=1 AND state='open'").run();return json({ok:true});}
if(action==='finalize'){await db.prepare("UPDATE event SET state='closed' WHERE id=1 AND state='paused'").run();if(await state()!=='closed')return fail('Pause voting before finalizing results.');return json({ok:true});}
// The UPDATE's row lock (not a snapshot read) is what makes reset safe against a concurrent finalize/open; the delete predicates re-read the row inside the same transaction.
if(action==='reset'){const [guard]=await db.batch([db.prepare("UPDATE event SET state='draft' WHERE id=1 AND state IN ('draft','paused')"),db.prepare("DELETE FROM votes WHERE (SELECT state FROM event WHERE id=1)='draft'"),db.prepare("DELETE FROM draws WHERE (SELECT state FROM event WHERE id=1)='draft'")]);if(!(guard.rowCount??guard.affectedRows))return fail('Pause voting before resetting; finalized results cannot be reset.',409);return json({ok:true});}
if(action==='draw'){
if(current!=='closed'||!categories.includes(body.category))return fail('Close voting before drawing a winner.');
const prior=await db.prepare('SELECT * FROM draws WHERE category=?').bind(body.category).first();if(prior)return json({draw:prior});
const list=(await standings()).filter((e:any)=>e.category===body.category) as any[];const tied=list.filter(e=>e.votes===list[0]?.votes);if(tied.length<2||!list[0]?.votes)return fail('This category has no tied votes to resolve.');
const winner=tied[randomIndex(tied.length)];await db.prepare('INSERT INTO draws(category,winner,tied,time) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(body.category,winner.id,JSON.stringify(tied.map(e=>({id:e.id,name:e.name,votes:e.votes}))),new Date().toISOString()).run();return json({draw:await db.prepare('SELECT * FROM draws WHERE category=?').bind(body.category).first()});
}
if(action==='generate'){
if(current==='closed')return fail('Results are finalized and the roster is locked.');if(!aiConfig().enabled)return fail('AI images are not configured. Upload a finished image instead.');
if(typeof body.image!=='string'||!/^[a-f0-9-]{36}$/.test(body.image))return fail('Upload the original photo first.');
if(body.costume!==undefined&&(typeof body.costume!=='string'||body.costume.length>100))return fail('Please check the costume field.');if(body.name!==undefined&&(typeof body.name!=='string'||body.name.length>80))return fail('Please check the name field.');
// Storage calls cannot be aborted, so each is raced against the absolute deadline (58 s after handler entry, under Netlify's 60 s) and reports a 504 instead of a platform page; a write that lands late is an unreferenced object the sweep removes.
const deadline=<T,>(work:Promise<T>,cap:number,message:string)=>{const left=Math.min(cap,58000-(Date.now()-startedAt));if(left<=0)return Promise.reject(new AiError(message,504));let timer:ReturnType<typeof setTimeout>;return Promise.race([work.finally(()=>clearTimeout(timer)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AiError(message,504)),left);timer.unref()})])};
let photo;try{photo=await deadline(bucket().get(body.image),10000,'The original photo could not be read in time. Please try again.')}catch(e){if(e instanceof AiError)return fail(e.message,e.status);throw e}if(!photo)return fail('Original image not found.');
// Vendor, prompts and the optional tagline live in lib/ai; an AiError carries the organizer-facing message and status (502 vendor failure, 504 timeout).
let generated;try{generated=await generateBackground({photo:photo.body,contentType:photo.httpMetadata?.contentType||'image/png',category:body.category,costume:body.costume,name:body.name},startedAt)}catch(aiError){if(aiError instanceof AiError)return fail(aiError.message,aiError.status);throw aiError}
const id=crypto.randomUUID();try{await deadline(bucket().put(id,generated.image,{httpMetadata:{contentType:generated.contentType}}),58000,'The generated image could not be stored in time. Please try again.')}catch(e){if(e instanceof AiError)return fail(e.message,e.status);throw e}return json({image:id,...(generated.tagline?{tagline:generated.tagline}:{})});
}
return fail('Unknown action.');
}catch(e){console.error(e);return fail('The request could not be completed. Your changes have not been confirmed. Please try again.',500)}}
