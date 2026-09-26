import {spawn,spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
process.env.PATH=dirname(process.execPath)+':'+process.env.PATH;
const state=resolve('.wrangler/test-'+Date.now());
const wrangler=['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js'];
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){
 const r=spawnSync(process.execPath,[...wrangler,'d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to',state,'--file','drizzle/'+file],{stdio:'pipe'});
 if(r.status!==0)throw Error(r.stderr.toString()+r.stdout.toString());
}
const server=spawn(process.execPath,[...wrangler,'dev','--config','dist/server/wrangler.json','--local','--persist-to',state,'--ip','127.0.0.1','--port','5174','--inspector-port','0','--var','ADMIN_EMAILS:seedy@sites.test'],{stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
try{
 let ready=false;for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:5174/api/contest');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw Error('Test server did not start: '+output);
 await new Promise((ok,no)=>{const test=spawn(process.execPath,['tests/api.mjs'],{stdio:'inherit'});test.on('exit',code=>code===0?ok():no(Error('API test failed.')))});
}finally{server.kill('SIGTERM');}
