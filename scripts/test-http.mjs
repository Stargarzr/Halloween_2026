import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(path.join(tmpdir(),'boo-http-'));
const root='http://127.0.0.1:5174';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','5174'],{env:{...process.env,NODE_ENV:'development',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',DATABASE_URL:'',NETLIFY:'',CONTEST_LOCAL_DATA_DIR:directory,CONTEST_TEST_BUILD_DIR:'.next-test'},stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
try{
 let ready=false;for(let i=0;i<60;i++){try{const r=await fetch(root+'/sign-in');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}if(!ready)throw Error(output);
 const admin='contest-local-preview=admin',voterA=`contest-local-preview=voter:${crypto.randomUUID()}`,voterB=`contest-local-preview=voter:${crypto.randomUUID()}`;
 async function call(body,cookie=admin){const r=await fetch(root+'/api/contest',{method:'POST',headers:{Origin:root,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
 async function get(cookie=admin){const r=await fetch(root+'/api/contest',{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json()}
 assert.equal((await fetch(root+'/api/contest')).status,401);
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
 assert.equal((await call({action:'close'})).status,200);
 assert.equal((await call({action:'vote',entry:entries[0].id,category:categories[0]},voterB)).status,400);
 assert.equal((await call({action:'finalize'})).status,200);
 assert.equal((await call({action:'save',entry:entries[0]})).status,400);
 assert.equal((await call({action:'open'})).status,400);
 assert.equal((await call({action:'reset'})).status,200);
 assert.equal((await get()).state,'draft');
 assert.equal((await call({action:'ballot'},voterA)).data.votes.length,0);
 assert.equal((await fetch(root+'/api/contest',{method:'POST',headers:{Origin:'https://evil.example',Cookie:admin,'Content-Type':'application/json'},body:JSON.stringify({action:'reset'})})).status,403);
 console.log('PASS: Next.js API authorization, private photos, upload/save, voter restrictions, concurrent votes, independent accounts, pause/finalize/reset, cross-origin rejection.');
}catch(e){console.error(output.slice(-5000));throw e}finally{server.kill('SIGTERM')}
