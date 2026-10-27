import {sameOrigin} from '@/lib/auth-request';
import { getMember, signOutPath } from '@/lib/auth';
import { database, bucket, hash, randomIndex, standings } from '@/lib/server';
import {categories} from '@/lib/shared';
import {aiConfig,generateBackground,vendorLabel,AiError} from '@/lib/ai';
export const dynamic='force-dynamic';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>json({error:message},status);
// The composite votes foreign key uses ON UPDATE/DELETE RESTRICT, which PostgreSQL reports as 23001 (restrict_violation); the plain entry reference reports 23503. Both mean "votes exist".
class VoteRefused extends Error{}
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
// Storage calls cannot be aborted, so each is raced against an absolute deadline measured from handler entry (28 s by default, under Netlify's 30 s function limit) and reports a 504 instead of a platform page; a write that lands late is an unreferenced object the sweep removes.
const deadline=<T,>(work:Promise<T>,cap:number,message:string,limit=28000)=>{const left=Math.min(cap,limit-(Date.now()-startedAt));if(left<=0)return Promise.reject(new AiError(message,504));let timer:ReturnType<typeof setTimeout>;return Promise.race([work.finally(()=>clearTimeout(timer)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AiError(message,504)),left);timer.unref()})])};
if(req.headers.get('content-type')?.includes('multipart/form-data')){
if(!member.admin)return fail('Organizer login required.',403);
if(await state()==='closed')return fail('Results are finalized and the roster is locked.');
const form=await req.formData(),file=form.get('file');
if(!(file instanceof File)||file.size>4*1024*1024||file.size===0)return fail('Choose a JPG, PNG, or WebP image under 4 MB.');
const bytes=new Uint8Array(await file.arrayBuffer());const type=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'?'image/webp':'';
if(!type)return fail('Choose a valid JPG, PNG, or WebP image.');
// The event row is held shared during the write, so a clear in progress (which holds the row's update lock while it lists the bucket) either lists this photo or makes this write wait until the clear has committed.
const id=crypto.randomUUID();await db.transaction(async run=>{await run(db.prepare('SELECT 1 FROM event WHERE id=1 FOR SHARE'));await bucket().put(id,bytes,{httpMetadata:{contentType:type}})});return json({image:id});
}
const body:any=await req.json();if(!body||typeof body!=='object')return fail('Invalid request.');const action=body.action;
if(action==='vote'||action==='ballot'){
// A ballot lookup only reads; the voter record is created by the first vote, so a cleared contest stays without voter records until someone votes.
const voter=await hash(member.id);if(action==='ballot')return json({votes:(await db.prepare('SELECT category,entry FROM votes WHERE code=?').bind(voter).all()).results});
if(!categories.includes(body.category)||typeof body.entry!=='string')return fail('Select an eligible contestant.');
// The voter record and the vote are one transaction: a refused vote (voting not open, entry unavailable) rolls the voter record back too, so a cleared contest gains voter records only from accepted votes.
try{await db.transaction(async run=>{await run(db.prepare('INSERT INTO codes(hash,created) VALUES(?,?) ON CONFLICT DO NOTHING').bind(voter,new Date().toISOString()));const r=await run(db.prepare("INSERT INTO votes(id,code,category,entry) SELECT ?,?,?,e.id FROM entries e,event s WHERE e.id=? AND e.category=? AND e.published=1 AND s.id=1 AND s.state='open'").bind(crypto.randomUUID(),voter,body.category,body.entry,body.category));if(!(r.rowCount??r.affectedRows))throw new VoteRefused()})}catch(e){if(e instanceof VoteRefused)return fail('Voting is closed or this entry is unavailable.');const code=(e as any)?.code;if(code==='23505')return fail('Your account has already voted in this category.',409);if(votesLock(e))return fail('This entry is no longer available in that category.',409);throw e}
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
// A share lock on the event row makes the save wait for a clear (which holds the row's update lock) to commit before the upsert, so no contestant is written while the roster is being wiped. Lock order everywhere is event row, then image key.
await run(db.prepare('SELECT 1 FROM event WHERE id=1 FOR SHARE'));await run(imageLock(e.image));
if(!e.image.startsWith('sample:')&&!await bucket().head(e.image))return {outcome:'missing',previous:''};
const row=(await run(db.prepare('SELECT image FROM entries WHERE id=?').bind(id))).rows[0];const previous:string=row?.image||'';
// An editor opened on a roster contestant sends existing:true and may only update that row: when another organizer has deleted it or cleared the contest meanwhile, the save is refused instead of re-creating it.
if(body.existing===true&&!row)return {outcome:'removed',previous:''};
await run(db.prepare("INSERT INTO entries(id,name,costume,category,description,tagline,image,published) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM event WHERE state='closed') ON CONFLICT(id) DO UPDATE SET name=excluded.name,costume=excluded.costume,category=excluded.category,description=excluded.description,tagline=excluded.tagline,image=excluded.image,published=excluded.published WHERE NOT EXISTS(SELECT 1 FROM event WHERE state='closed')").bind(id,e.name.trim(),e.costume.trim(),e.category,e.description,e.tagline,e.image,e.published===true||e.published===1?1:0));
return {outcome:'saved',previous}});
if(outcome==='missing')return fail('Uploaded image was not found. Please upload again.');if(outcome==='removed')return fail('This contestant was removed by another organizer, so it was not saved.',409);
// A replaced photo is removed after the commit unless another contestant still uses it.
if(previous&&previous!==e.image){try{await removeUnreferenced(previous)}catch(storageError){console.error('Replaced photo removal failed',id,previous,storageError)}}}catch(err){if(votesLock(err))return fail('This contestant has votes, so its category and published status are locked.',409);throw err}
await sweepOrphans();
return json({ok:true});
}
if(action==='delete'){
if(current==='closed')return fail('Results are finalized and the roster is locked.',409);
if(typeof body.id!=='string')return fail('Choose a contestant to delete.');
const row=await db.prepare('SELECT image FROM entries WHERE id=?').bind(body.id).first<{image:string}>();if(!row)return fail('Contestant not found.',404);
// Step 1 commits the row deletion on its own, under a share lock on the event row so it cannot interleave with an open counting the roster (or a clear). The votes foreign key refuses it while votes exist; the NOT EXISTS guard covers a finalize that lands between the state read and the delete.
try{const changes=await db.transaction(async run=>{await run(db.prepare('SELECT 1 FROM event WHERE id=1 FOR SHARE'));const r=await run(db.prepare("DELETE FROM entries WHERE id=? AND NOT EXISTS(SELECT 1 FROM event WHERE state='closed')").bind(body.id));return r.rowCount??r.affectedRows??0});if(!changes)return fail('Results are finalized and the roster is locked.',409)}catch(err){if(votesLock(err))return fail('This contestant has votes and cannot be deleted. Pause voting and reset the round first.',409);throw err}
// Step 2, after the commit: remove the photo unless another contestant still uses it. Failures here are logged: the row is already gone.
try{await removeUnreferenced(row.image)}catch(storageError){console.error('Photo removal failed after deleting entry',body.id,row.image,storageError)}
await sweepOrphans();
return json({ok:true});
}
if(action==='open'){
// The event row is locked first and the roster counted in a later statement of the same transaction, so the count sees what a clear committed while the lock was waited for (a subquery inside the UPDATE would be evaluated against the statement's starting snapshot).
// The category CHECK makes "every category" a distinct count. An already open round answers ok, as before.
const opened=await db.transaction(async run=>{const current=(await run(db.prepare('SELECT state FROM event WHERE id=1 FOR UPDATE'))).rows[0]?.state;if(current!=='draft'&&current!=='paused')return current;
if(Number((await run(db.prepare('SELECT COUNT(DISTINCT category) AS n FROM entries WHERE published=1'))).rows[0]?.n)!==categories.length)return 'incomplete';await run(db.prepare("UPDATE event SET state='open' WHERE id=1"));return 'open'});
if(opened==='closed')return fail('Finalized results cannot reopen.');if(opened!=='open')return fail('Publish at least one entry in every category first.');return json({ok:true});
}
if(action==='close'){await db.prepare("UPDATE event SET state='paused' WHERE id=1 AND state='open'").run();return json({ok:true});}
if(action==='finalize'){await db.prepare("UPDATE event SET state='closed' WHERE id=1 AND state='paused'").run();if(await state()!=='closed')return fail('Pause voting before finalizing results.');return json({ok:true});}
// The UPDATE's row lock (not a snapshot read) is what makes reset safe against a concurrent finalize/open; the delete predicates re-read the row inside the same transaction.
if(action==='reset'){const [guard]=await db.batch([db.prepare("UPDATE event SET state='draft' WHERE id=1 AND state IN ('draft','paused')"),db.prepare("DELETE FROM votes WHERE (SELECT state FROM event WHERE id=1)='draft'"),db.prepare("DELETE FROM draws WHERE (SELECT state FROM event WHERE id=1)='draft'")]);if(!(guard.rowCount??guard.affectedRows))return fail('Pause voting before resetting; finalized results cannot be reset.',409);return json({ok:true});}
// Clear removes the whole contest: contestants, their photos, votes, tie-break records and voter records, and returns the event to draft, so a rehearsal can be wiped before the real roster is built.
// Allowed from draft, paused or closed (a finalized rehearsal must be clearable); refused while voting is open so a live round is never wiped by a stray click.
// The rows and the photo listing share one transaction behind the event row's update lock. Save, draw, upload and AI generation hold that row shared while they write, so every photo that can exist at the commit is in the listing,
// and a write that starts later lands after the clear, for the new roster. The listing is capped at 14 s (under the pool's idle-in-transaction limit); a listing failure rolls the rows back and nothing is cleared.
// Photos are removed after the commit through the same lock-and-check path as delete, because storage removal cannot be rolled back; every storage call sits under a 25 s absolute deadline so the function answers before Netlify kills it.
// Each photo is its own attempt, so one failing object does not abandon the rest; photosLeft counts only objects from the clear's own listing that were not removed (a failure or the deadline), and a second clear removes them.
// Anything written after the commit belongs to the new roster and is never counted. A save that waited for the clear's commit can insert its contestant before its photo is reached; that photo is then referenced and kept, which the response reports as `kept` so the organizer is told to review the roster rather than clear again.
if(action==='clear'){const slow='Photo removal ran out of time.',isPhoto=(o:{key:string})=>/^[a-f0-9-]{36}$/.test(o.key);
let photos:{key:string}[]|null;try{photos=await db.transaction(async run=>{const guard=await run(db.prepare("UPDATE event SET state='draft' WHERE id=1 AND state<>'open'"));if(!(guard.rowCount??guard.affectedRows))return null;
for(const table of ['votes','draws','entries','codes'])await run(db.prepare(`DELETE FROM ${table}`));return (await deadline(bucket().list(),14000,slow,14000)).filter(isPhoto)})}catch(e){if(e instanceof AiError)return fail('The photo listing did not complete in time, so nothing was cleared. Please try again.',e.status);throw e}
if(!photos)return fail('Pause voting before clearing the contest.',409);
let removed=0,left=0,kept=0;for(const [i,o] of photos.entries()){try{if(await deadline(removeUnreferenced(o.key),25000,slow,25000))removed++;else kept++}catch(e){console.error('Photo removal after clear failed',o.key,e);left++;if(e instanceof AiError){left+=photos.length-i-1;break}}}
console.log(`Contest cleared: ${removed} photo(s) removed${left?`, ${left} left`:''}${kept?`, ${kept} kept by a concurrent save`:''}`);return json({ok:true,photosLeft:left>0,kept:kept>0});}
if(action==='draw'){
if(current!=='closed'||!categories.includes(body.category))return fail('Close voting before drawing a winner.');
const prior=await db.prepare('SELECT * FROM draws WHERE category=?').bind(body.category).first();if(prior)return json({draw:prior});
const list=(await standings()).filter((e:any)=>e.category===body.category) as any[];const tied=list.filter(e=>e.votes===list[0]?.votes);if(tied.length<2||!list[0]?.votes)return fail('This category has no tied votes to resolve.');
// The insert runs under a share lock on the event row, so a draw that read "closed" before a concurrent clear waits for the clear to commit, sees draft, and records nothing. Two concurrent draws both hold the share lock; ON CONFLICT keeps the first and both answer with it.
const winner=tied[randomIndex(tied.length)];const draw=await db.transaction(async run=>{if((await run(db.prepare('SELECT state FROM event WHERE id=1 FOR SHARE'))).rows[0]?.state!=='closed')return null;
await run(db.prepare('INSERT INTO draws(category,winner,tied,time) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(body.category,winner.id,JSON.stringify(tied.map(e=>({id:e.id,name:e.name,votes:e.votes}))),new Date().toISOString()));return (await run(db.prepare('SELECT * FROM draws WHERE category=?').bind(body.category))).rows[0]??null});
if(!draw)return fail('Close voting before drawing a winner.');return json({draw});
}
if(action==='generate'){
if(current==='closed')return fail('Results are finalized and the roster is locked.');if(!aiConfig().enabled)return fail('AI images are not configured. Upload a finished image instead.');
if(typeof body.image!=='string'||!/^[a-f0-9-]{36}$/.test(body.image))return fail('Upload the original photo first.');
if(body.costume!==undefined&&(typeof body.costume!=='string'||body.costume.length>100))return fail('Please check the costume field.');if(body.name!==undefined&&(typeof body.name!=='string'||body.name.length>80))return fail('Please check the name field.');
let photo;try{photo=await deadline(bucket().get(body.image),6000,'The original photo could not be read in time. Please try again.')}catch(e){if(e instanceof AiError)return fail(e.message,e.status);throw e}if(!photo)return fail('Original image not found.');
// Vendor, prompts and the optional tagline live in lib/ai; an AiError carries the organizer-facing message and status (502 vendor failure, 504 timeout).
let generated;try{generated=await generateBackground({photo:photo.body,contentType:photo.httpMetadata?.contentType||'image/png',category:body.category,costume:body.costume,name:body.name},startedAt)}catch(aiError){if(aiError instanceof AiError)return fail(aiError.message,aiError.status);throw aiError}
// The write holds the event row shared, like an upload, so a clear in progress lists it or it waits for the clear.
const id=crypto.randomUUID();try{await db.transaction(async run=>{await run(db.prepare('SELECT 1 FROM event WHERE id=1 FOR SHARE'));await deadline(bucket().put(id,generated.image,{httpMetadata:{contentType:generated.contentType}}),28000,'The generated image could not be stored in time. Please try again.')})}catch(e){if(e instanceof AiError)return fail(e.message,e.status);throw e}return json({image:id,...(generated.tagline?{tagline:generated.tagline}:{})});
}
return fail('Unknown action.');
}catch(e){console.error(e);return fail('The request could not be completed. Your changes have not been confirmed. Please try again.',500)}}
