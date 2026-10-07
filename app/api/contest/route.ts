import {sameOrigin} from '@/lib/auth-request';
import { getMember, signOutPath } from '@/lib/auth';
import { database, bucket, isAdmin, hash, randomIndex, standings } from '@/lib/server';
import {categories} from '@/lib/shared';
export const dynamic='force-dynamic';
const json=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>json({error:message},status);
async function state(){return (await database().prepare('SELECT state FROM event WHERE id=1').first<{state:string}>())?.state||'draft'}
async function initialize(){await database().prepare("INSERT INTO event(id,state) VALUES(1,'draft') ON CONFLICT DO NOTHING").run();}
export async function GET(){try{const member=await getMember();if(!member)return fail('Sign in with your work email to access the contest.',401);const db=database(),admin=member.admin;await initialize();const s=await state();return json({state:s,admin,account:{email:member.email,localPreview:!!member.localPreview,signOut:signOutPath()},entries:(await db.prepare(admin?'SELECT * FROM entries ORDER BY name':'SELECT * FROM entries WHERE published=1 ORDER BY name').all()).results,standings:await standings(),draws:(await db.prepare('SELECT * FROM draws').all()).results,aiEnabled:admin&&!!process.env.OPENAI_API_KEY});}catch(e){console.error(e);return fail('Contest storage is temporarily unavailable. Please try again.',503)}}
export async function POST(req:Request){try{
const member=await getMember();if(!member)return fail('Sign in with your work email to access the contest.',401);
if(!sameOrigin(req))return fail('Please use the contest website.',403);
if(Number(req.headers.get('content-length')||0)>5*1024*1024)return fail('File is too large.',413);
const db=database();
if(req.headers.get('content-type')?.includes('multipart/form-data')){
if(!await isAdmin())return fail('Organizer login required.',403);
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
try{const r=await db.prepare("INSERT INTO votes(id,code,category,entry) SELECT ?,?,?,e.id FROM entries e,event s WHERE e.id=? AND e.category=? AND e.published=1 AND s.id=1 AND s.state='open'").bind(crypto.randomUUID(),voter,body.category,body.entry,body.category).run();if(!r.meta.changes)return fail('Voting is closed or this entry is unavailable.');}catch(e){if((e as any)?.code==='23505')return fail('Your account has already voted in this category.',409);throw e}
return json({ok:true});
}
if(!await isAdmin())return fail('Organizer login required.',403);
const current=await state();
if(action==='save'){
if(current==='closed')return fail('Results are finalized and the roster is locked.');
const e=body.entry||{};for(const [key,max] of [['name',80],['costume',100],['description',500],['tagline',140]] as const){if(typeof e[key]!=='string'||e[key].length>max||(key==='name'||key==='costume')&&!e[key].trim())return fail(`Please check the ${key} field.`)}
if(!categories.includes(e.category))return fail('Choose a category.');
if(typeof e.image!=='string'||!(/^[a-f0-9-]{36}$/.test(e.image)||/^sample:[0-5]$/.test(e.image)))return fail('Upload and review an image first.');
if(!e.image.startsWith('sample:')&&!await bucket().head(e.image))return fail('Uploaded image was not found. Please upload again.');
const id=e.id||crypto.randomUUID();await db.prepare("INSERT INTO entries(id,name,costume,category,description,tagline,image,published) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM event WHERE state='closed') ON CONFLICT(id) DO UPDATE SET name=excluded.name,costume=excluded.costume,category=excluded.category,description=excluded.description,tagline=excluded.tagline,image=excluded.image,published=excluded.published WHERE NOT EXISTS(SELECT 1 FROM event WHERE state='closed')").bind(id,e.name.trim(),e.costume.trim(),e.category,e.description,e.tagline,e.image,e.published===true?1:0).run();return json({ok:true});
}
if(action==='removeSamples'){
if(current==='closed')return fail('Results are finalized and the roster is locked.');await db.prepare("DELETE FROM entries WHERE sample=1 AND NOT EXISTS(SELECT 1 FROM event WHERE state='closed')").run();return json({ok:true});
}
if(action==='open'){
const list=await standings();if(categories.some(c=>!list.some((e:any)=>e.category===c)))return fail('Publish at least one entry in every category first.');
await db.prepare("INSERT INTO event(id,state) VALUES(1,'open') ON CONFLICT(id) DO UPDATE SET state='open' WHERE event.state IN ('draft','paused')").run();if(await state()!=='open')return fail('Finalized results cannot reopen.');return json({ok:true});
}
if(action==='close'){await db.prepare("UPDATE event SET state='paused' WHERE id=1 AND state='open'").run();return json({ok:true});}
if(action==='finalize'){await db.prepare("UPDATE event SET state='closed' WHERE id=1 AND state='paused'").run();if(await state()!=='closed')return fail('Pause voting before finalizing results.');return json({ok:true});}
if(action==='reset'){await db.batch([db.prepare('DELETE FROM votes'),db.prepare('DELETE FROM draws'),db.prepare("INSERT INTO event(id,state) VALUES(1,'draft') ON CONFLICT(id) DO UPDATE SET state='draft'")]);return json({ok:true});}
if(action==='draw'){
if(current!=='closed'||!categories.includes(body.category))return fail('Close voting before drawing a winner.');
const prior=await db.prepare('SELECT * FROM draws WHERE category=?').bind(body.category).first();if(prior)return json({draw:prior});
const list=(await standings()).filter((e:any)=>e.category===body.category) as any[];const tied=list.filter(e=>e.votes===list[0]?.votes);if(tied.length<2||!list[0]?.votes)return fail('This category has no tied votes to resolve.');
const winner=tied[randomIndex(tied.length)];await db.prepare('INSERT INTO draws(category,winner,tied,time) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').bind(body.category,winner.id,JSON.stringify(tied.map(e=>({id:e.id,name:e.name,votes:e.votes}))),new Date().toISOString()).run();return json({draw:await db.prepare('SELECT * FROM draws WHERE category=?').bind(body.category).first()});
}
if(action==='generate'){
if(current==='closed')return fail('Results are finalized and the roster is locked.');const key=process.env.OPENAI_API_KEY;if(!key)return fail('AI images are not configured. Upload a finished image instead.');
if(typeof body.image!=='string'||!/^[a-f0-9-]{36}$/.test(body.image))return fail('Upload the original photo first.');
const photo=await bucket().get(body.image);if(!photo)return fail('Original image not found.');
const themes:Record<string,string>={'Best Team/Group Costume':'a neon-green machine resistance bunker with flickering jack-o-lantern command screens and a distant friendly robot assembly line','Most Creative/Original':'a phosphor-green AI invention lab with holographic pumpkins, candy-blueprint projections and cheerful malfunctioning terminals','Funniest':'a dark green robot breakroom with a candy-bucket conveyor, a slightly confused photocopier android and harmless system-error confetti'};const theme=themes[body.category]||'a neon-green machine resistance bunker with flickering jack-o-lantern command screens';const form=new FormData();form.set('model','gpt-image-2');form.set('image',new Blob([await photo.arrayBuffer()],{type:photo.httpMetadata?.contentType||'image/png'}),'photo.png');form.set('prompt',`Edit only the background into ${theme}, a funny tasteful post-apocalyptic Halloween office scene in the age of machines. Preserve every person, face, identity, pose, clothing, costume and prop as faithfully as possible. No text, logos, weapons, extra people, gore or frightening imagery.`);form.set('size','1024x1024');
const response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form});if(!response.ok)return fail('Image generation did not complete. Try again or upload a finished image.',502);const result:any=await response.json();if(!result.data?.[0]?.b64_json)return fail('No image returned. Please try again.',502);
const id=crypto.randomUUID();await bucket().put(id,Uint8Array.from(atob(result.data[0].b64_json),c=>c.charCodeAt(0)),{httpMetadata:{contentType:'image/png'}});return json({image:id});
}
return fail('Unknown action.');
}catch(e){console.error(e);return fail('The request could not be completed. Your changes have not been confirmed. Please try again.',500)}}
