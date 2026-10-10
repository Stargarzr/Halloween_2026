import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const port=Number(process.env.TEST_HTTP_PORT||5174);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error(`TEST_HTTP_PORT must be an integer from 1024 to 65535 (got "${process.env.TEST_HTTP_PORT}").`);
const directory=await mkdtemp(path.join(tmpdir(),'boo-http-'));
const root=`http://127.0.0.1:${port}`;
// next dev appends its distDir type globs to the TypeScript config it is pointed at, so each port gets a throwaway config (ignored by git) and tsconfig.json is never touched.
const tsconfigPath=`tsconfig.test-${port}.json`;
await writeFile(tsconfigPath,JSON.stringify({extends:'./tsconfig.json'})+'\n');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{env:{...process.env,NODE_ENV:'development',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',DATABASE_URL:'',NETLIFY:'',CONTEST_LOCAL_DATA_DIR:directory,CONTEST_TEST_BUILD_DIR:`.next-test-${port}`,CONTEST_TEST_TSCONFIG:tsconfigPath},stdio:['ignore','pipe','pipe']});
let output='',exited=false;server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);server.on('exit',()=>{exited=true});
try{
 let ready=false;for(let i=0;i<60;i++){if(exited)throw Error('Next.js server exited before becoming ready.\n'+output);try{const r=await fetch(root+'/sign-in');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}if(!ready)throw Error(output);
 const admin='contest-local-preview=admin',voterA=`contest-local-preview=voter:${crypto.randomUUID()}`,voterB=`contest-local-preview=voter:${crypto.randomUUID()}`;
 async function call(body,cookie=admin){const r=await fetch(root+'/api/contest',{method:'POST',headers:{Origin:root,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
 async function get(cookie=admin){const r=await fetch(root+'/api/contest',{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json()}
 assert.equal((await fetch(root+'/api/contest')).status,401);
 // C7: the preview cookie is honoured only for an exact loopback Host; fetch() cannot override Host, so use node:http.
 const rawStatus=host=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/api/contest',headers:{Host:host,Cookie:admin}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject));
 assert.equal(await rawStatus(`localhost:${port}`),200);
 for(const host of ['localhost.attacker.example','127.0.0.1.attacker.example','evil.example'])assert.equal(await rawStatus(host),401,host);
 assert.equal((await fetch(root+'/api/contest',{headers:{'oai-authenticated-user-email':'teri.musick@cgi.com','cf-access-jwt-assertion':'forged'}})).status,401);
 assert.equal((await fetch(root+'/api/auth/code',{method:'POST',headers:{Origin:root,'Content-Type':'application/json'},body:JSON.stringify({email:'outsider@gmail.com'})})).status,400);
 assert.equal((await call({action:'open'},voterA)).status,403);
 assert.equal((await get()).entries.length,0);
 const categories=['Best Team/Group Costume','Most Creative/Original','Funniest'];
 const bytes=Uint8Array.from([137,80,78,71,13,10,26,10]);
 const form=new FormData();form.set('file',new Blob([bytes],{type:'image/png'}),'test.png');
 const upload=await fetch(root+'/api/contest',{method:'POST',headers:{Origin:root,Cookie:admin},body:form});assert.equal(upload.status,200);const {image}=await upload.json();
 assert.equal((await fetch(root+'/api/image/'+image)).status,401);
 assert.equal((await fetch(root+'/api/image/'+image,{headers:{Cookie:voterA}})).status,404);
 const entries=categories.map((category,i)=>({id:crypto.randomUUID(),name:'Test '+i,costume:'Robot',category,description:'Isolated test',tagline:'',image,published:true}));
 for(const entry of entries)assert.equal((await call({action:'save',entry})).status,200);
 assert.equal((await fetch(root+'/api/image/'+image,{headers:{Cookie:voterA}})).status,200);
 assert.equal((await call({action:'vote',entry:entries[0].id,category:categories[0]},voterA)).status,400);
 assert.equal((await call({action:'open'})).status,200);
 const results=await Promise.all(Array.from({length:6},()=>call({action:'vote',entry:entries[0].id,category:categories[0],voter:crypto.randomUUID()},voterA)));
 assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,5);
 assert.equal((await call({action:'ballot'},voterA)).data.votes.length,1);
 assert.equal((await call({action:'ballot'},voterB)).data.votes.length,0);
 const locked='This contestant has votes, so its category and published status are locked.';
 let r=await call({action:'save',entry:{...entries[0],published:false}});assert.equal(r.status,409);assert.equal(r.data.error,locked);
 r=await call({action:'save',entry:{...entries[0],category:categories[1]}});assert.equal(r.status,409);assert.equal(r.data.error,locked);
 assert.equal((await call({action:'save',entry:{...entries[0],description:'Edited while voted'}})).status,200);
 assert.equal((await call({action:'save',entry:{...entries[1],published:false}})).status,200);
 assert.equal((await call({action:'save',entry:entries[1]})).status,200);
 assert.equal((await get()).standings.find(s=>s.id===entries[0].id).votes,1);
 // C4 visibility: voters see no counts until closed; rows ordered by category then name; entries derived from the same rows.
 const voterView=await get(voterA);assert.ok(voterView.standings.length===3&&voterView.standings.every(s=>s.votes===null),'votes hidden while open');
 assert.deepEqual(voterView.standings.map(s=>s.category),[...categories].sort());assert.deepEqual(voterView.entries.map(e=>e.id).sort(),entries.map(e=>e.id).sort());assert.ok(voterView.entries.every(e=>!('votes' in e)));
 assert.equal((await call({action:'save',entry:{...entries[1],published:1}})).status,200);assert.equal((await get(voterA)).entries.length,3,'published:1 accepted');
 // C4 delete: refused with votes; a shared photo survives deleting one of its entries; an unshared photo is removed; unknown id is 404.
 assert.equal((await call({action:'delete',id:entries[0].id})).status,409);
 assert.equal((await call({action:'delete',id:entries[2].id})).status,200);assert.equal((await fetch(root+'/api/image/'+image,{headers:{Cookie:voterA}})).status,200,'shared image kept');
 assert.equal((await call({action:'save',entry:entries[2]})).status,200);
 const second=new FormData();second.set('file',new Blob([bytes],{type:'image/png'}),'second.png');const secondUpload=await fetch(root+'/api/contest',{method:'POST',headers:{Origin:root,Cookie:admin},body:second});const {image:soloImage}=await secondUpload.json();
 const solo={id:crypto.randomUUID(),name:'Solo',costume:'Ghost',category:categories[2],description:'',tagline:'',image:soloImage,published:false};assert.equal((await call({action:'save',entry:solo})).status,200);
 assert.equal((await fetch(root+'/api/image/'+soloImage,{headers:{Cookie:admin}})).status,200);assert.equal((await call({action:'delete',id:solo.id})).status,200);assert.equal((await fetch(root+'/api/image/'+soloImage,{headers:{Cookie:admin}})).status,404,'unshared image removed');
 assert.equal((await call({action:'delete',id:crypto.randomUUID()})).status,404);
 const resetBlocked='Pause voting before resetting; finalized results cannot be reset.';
 r=await call({action:'reset'});assert.equal(r.status,409);assert.equal(r.data.error,resetBlocked);
 assert.equal((await get(voterA)).state,'open');
 assert.equal((await call({action:'ballot'},voterA)).data.votes.length,1);
 assert.equal((await call({action:'close'})).status,200);
 assert.equal((await call({action:'vote',entry:entries[0].id,category:categories[0]},voterB)).status,400);
 assert.equal((await call({action:'reset'})).status,200);
 assert.equal((await get()).state,'draft');
 assert.equal((await call({action:'ballot'},voterA)).data.votes.length,0);
 assert.equal((await call({action:'open'})).status,200);
 assert.equal((await call({action:'close'})).status,200);
 assert.equal((await call({action:'finalize'})).status,200);
 assert.equal((await call({action:'delete',id:entries[1].id})).status,409,'delete when closed');assert.ok((await get()).entries.some(e=>e.id===entries[1].id),'entry survives refused delete');
 assert.equal((await call({action:'save',entry:entries[0]})).status,400);
 assert.equal((await call({action:'open'})).status,400);
 r=await call({action:'reset'});assert.equal(r.status,409);assert.equal(r.data.error,resetBlocked);
 assert.equal((await get()).state,'closed');
 assert.equal((await fetch(root+'/api/contest',{method:'POST',headers:{Origin:'https://evil.example',Cookie:admin,'Content-Type':'application/json'},body:JSON.stringify({action:'reset'})})).status,403);
 console.log('PASS: Next.js API authorization, loopback-only preview cookie, private photos, upload/save, voter restrictions, concurrent votes, independent accounts, voted-entry category/published lock (409), hidden standings for voters until closed, delete rules (votes 409, shared photo kept, orphan photo removed), pause/finalize, reset guard (open 409, paused 200, finalized 409), cross-origin rejection.');
}catch(e){console.error(output.slice(-5000));throw e}finally{server.kill('SIGTERM');await rm(tsconfigPath,{force:true})}
