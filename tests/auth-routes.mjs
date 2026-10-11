import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {applyLocalMigrations} from '../lib/migrations.ts';

const moduleUrl=source=>`data:text/javascript,${encodeURIComponent(source)}`;
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const policyUrl=moduleUrl(compile(readFileSync('lib/access-policy.ts','utf8')));
const limiterUrl=moduleUrl(compile(readFileSync('lib/rate-limit.ts','utf8')));
const dbStubUrl=moduleUrl('export function database(){return {prepare(sql){return {bind(...params){return {execute(){return globalThis.__authTestQuery(sql,params)}}}}}}}');
const requestUrl=moduleUrl(compile(readFileSync('lib/auth-request.ts','utf8'))
 .replaceAll("'./database'",JSON.stringify(dbStubUrl))
 .replaceAll("'./rate-limit'",JSON.stringify(limiterUrl)));
globalThis.__authTestQuery=async()=>({rows:[{allowed:true}]});
const runtimeUrl=moduleUrl(compile(readFileSync('lib/runtime.ts','utf8')));
const clientUrl=moduleUrl('export async function authClient(){return globalThis.__authTestClient()}');
async function route(file){
 const source=compile(readFileSync(file,'utf8'))
  .replaceAll("'@/lib/supabase/server'",JSON.stringify(clientUrl))
  .replaceAll("'@/lib/access-policy'",JSON.stringify(policyUrl))
  .replaceAll("'@/lib/auth-request'",JSON.stringify(requestUrl))
  .replaceAll("'@/lib/runtime'",JSON.stringify(runtimeUrl));
 return import(moduleUrl(source));
}
const {GET:callback}=await route('app/auth/callback/route.ts');
const {POST:sendCode}=await route('app/api/auth/code/route.ts');
const {POST:verifyCode}=await route('app/api/auth/verify/route.ts');
const verified={id:'test-user',email:'voter@cgi.com',email_confirmed_at:'2026-10-10T12:00:00Z'};
const callbackRequest=(query,init)=>new Request(`https://ballot.example/auth/callback${query}`,init);
const sendRequest=email=>new Request('https://ballot.example/api/auth/code',{method:'POST',headers:{origin:'https://ballot.example',host:'ballot.example','content-type':'application/json'},body:JSON.stringify({email})});
function mockClient({user=verified,error=null,throws=false,signOutThrows=false,initialSession=null,createsSession=true}={}){
 const calls={exchanges:[],otps:[],sends:[],signOut:0,session:initialSession};
 const completedSignIn=()=>{
  const session=!error&&createsSession?{access_token:'new-token'}:null;
  if(session)calls.session='set';
  return {data:{user,session},error};
 };
 const auth={
  async exchangeCodeForSession(code){calls.exchanges.push(code);if(throws)throw Error('exchange failed');return completedSignIn()},
  async verifyOtp(otp){calls.otps.push(otp);return completedSignIn()},
  async signInWithOtp(input){calls.sends.push(input);return {error}},
  async signOut(){calls.signOut++;if(signOutThrows)throw Error('sign-out failed');calls.session=null;return {error:null}},
 };
 globalThis.__authTestClient=async()=>({auth});
 return calls;
}

{
 const calls=mockClient();
 const response=await callback(callbackRequest('?code=one-time-code'));
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'https://ballot.example/');
 assert.deepEqual(calls.exchanges,['one-time-code']);assert.equal(calls.session,'set');assert.equal(calls.signOut,0);
}
for(const type of ['signup','invite','magiclink','recovery','email_change','email']){
 const calls=mockClient();
 const response=await callback(callbackRequest(`?token_hash=hash123&type=${type}`));
 assert.equal(response.status,303);assert.deepEqual(calls.otps,[{token_hash:'hash123',type}]);assert.equal(calls.signOut,0);assert.equal(calls.session,'set');
}
{
 const calls=mockClient({error:{message:'bad code'},initialSession:'existing'});
 assert.equal((await callback(callbackRequest('?code=bad'))).status,303);
 assert.equal(calls.signOut,0);assert.equal(calls.session,'existing');
}
{
 const calls=mockClient({error:{message:'expired token'},initialSession:'existing'});
 assert.equal((await callback(callbackRequest('?token_hash=bad&type=email'))).status,303);
 assert.equal(calls.signOut,0);assert.equal(calls.session,'existing');
}
{
 const calls=mockClient({createsSession:false,initialSession:'existing'});
 assert.equal((await callback(callbackRequest('?code=no-session'))).status,303);
 assert.equal(calls.signOut,0);assert.equal(calls.session,'existing');
}
{
 const calls=mockClient({user:{...verified,email:'outsider@example.com'},initialSession:'existing'});
 await callback(callbackRequest('?token_hash=hash&type=email'));
 assert.equal(calls.signOut,1);assert.equal(calls.session,null);
}
for(const query of ['', '?token_hash=hash&type=unknown', '?token_hash=hash', '?code=', '?error=access_denied&error_code=otp_expired']){
 const calls=mockClient({initialSession:'existing'});
 assert.equal((await callback(callbackRequest(query,{headers:{'Sec-Fetch-Site':'cross-site'}}))).status,303);
 assert.equal(calls.exchanges.length,0);assert.equal(calls.otps.length,0);assert.equal(calls.signOut,0);assert.equal(calls.session,'existing');
}
{
 const calls=mockClient({throws:true,initialSession:'existing'});
 const oldError=console.error;console.error=()=>{};
 try{assert.equal((await callback(callbackRequest('?code=throws'))).status,303)}finally{console.error=oldError}
 assert.equal(calls.signOut,0);assert.equal(calls.session,'existing');
}
{
 const user={...verified,get email(){throw Error('bad user data')}};
 const calls=mockClient({user});
 const oldError=console.error;console.error=()=>{};
 try{assert.equal((await callback(callbackRequest('?code=good'))).status,303)}finally{console.error=oldError}
 assert.equal(calls.signOut,1);assert.equal(calls.session,null);
}
{
 const priorSite=process.env.SITE_URL,priorNode=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV='production';process.env.SITE_URL='https://ballot.example';
  let calls=mockClient();
  assert.equal((await sendCode(sendRequest(' VOTER@CGI.COM '))).status,200);
  assert.deepEqual(calls.sends,[{email:'voter@cgi.com',options:{shouldCreateUser:true,emailRedirectTo:'https://ballot.example/auth/callback'}}]);
  for(const site of [undefined,'http://ballot.example','https://user:secret@ballot.example','not a url','https://ballot.example/other','https://ballot.example/?q=1']){
   if(site===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=site;
   calls=mockClient();
   assert.equal((await sendCode(sendRequest('voter@cgi.com'))).status,503,`site=${site}`);
   assert.equal(calls.sends.length,0);
  }
  process.env.NODE_ENV='development';delete process.env.SITE_URL;
  calls=mockClient();
  assert.equal((await sendCode(sendRequest('voter@cgi.com'))).status,200);
  assert.deepEqual(calls.sends,[{email:'voter@cgi.com',options:{shouldCreateUser:true}}]);
  process.env.SITE_URL='http://localhost:5173';
  calls=mockClient();
  assert.equal((await sendCode(sendRequest('voter@cgi.com'))).status,200);
  assert.equal(calls.sends[0].options.emailRedirectTo,'http://localhost:5173/auth/callback');
 }finally{
  if(priorSite===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=priorSite;
  if(priorNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNode;
 }
}
console.log('PASS: magic-link callback, verified-user gate, sign-out, trusted SITE_URL callback destination.');

const {rateLimit}=await import(limiterUrl);
const db=new PGlite();
try{
 await applyLocalMigrations(sql=>db.exec(sql));
 const query=(sql,params)=>db.query(sql,params);
 const acl=(await db.query("SELECT c.relrowsecurity AS rls, has_table_privilege('anon','public.auth_attempts','SELECT') AS anon_select, has_table_privilege('authenticated','public.auth_attempts','INSERT') AS member_insert FROM pg_class c WHERE c.oid='public.auth_attempts'::regclass")).rows[0];
 assert.deepEqual(acl,{rls:true,anon_select:false,member_insert:false});
 await db.exec(readFileSync('supabase/migrations/202610070003_auth_attempts.sql','utf8'));
 assert.deepEqual(await applyLocalMigrations(sql=>db.exec(sql)),[]);
 const attempts=await Promise.all(Array.from({length:8},()=>rateLimit(query,'test:concurrent',3,600)));
 assert.equal(attempts.filter(Boolean).length,3);
 assert.equal((await db.query("SELECT count FROM auth_attempts WHERE key='test:concurrent'")).rows[0].count,8);
 assert.equal(await rateLimit(query,'test:rollover',2,600),true);
 assert.equal(await rateLimit(query,'test:rollover',2,600),true);
 assert.equal(await rateLimit(query,'test:rollover',2,600),false);
 await db.query("UPDATE auth_attempts SET window_start=now()-INTERVAL '601 seconds' WHERE key='test:rollover'");
 assert.equal(await rateLimit(query,'test:rollover',2,600),true);
 assert.equal((await db.query("SELECT count FROM auth_attempts WHERE key='test:rollover'")).rows[0].count,1);
 let logged=0;const oldError=console.error;console.error=()=>logged++;
 try{assert.equal(await rateLimit(async()=>{throw Error('db unavailable')},'test:error',2,600),true)}finally{console.error=oldError}
 assert.equal(logged,1);

 const priorSite=process.env.SITE_URL,priorNode=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV='development';delete process.env.SITE_URL;
  let queries=0;
  globalThis.__authTestQuery=(sql,params)=>{queries++;return query(sql,params)};
  let calls=mockClient();
  const crossOrigin=new Request('https://ballot.example/api/auth/code',{method:'POST',headers:{origin:'https://elsewhere.example',host:'ballot.example','content-type':'application/json'},body:JSON.stringify({email:'person@cgi.com'})});
  assert.equal((await sendCode(crossOrigin)).status,403);
  assert.equal(queries,0);assert.equal(calls.sends.length,0);
  const plus=await sendCode(sendRequest('person+tag@cgi.com'));
  assert.equal(plus.status,400);assert.match((await plus.json()).error,/\+ tag/);
  assert.equal(queries,0);
  assert.equal((await sendCode(sendRequest('outsider@example.com'))).status,400);
  assert.equal(queries,0);
  calls=mockClient();
  for(const email of [' Person@CGI.COM ','person@cgi.com','PERSON@cgi.com'])assert.equal((await sendCode(sendRequest(email))).status,200);
  assert.equal((await sendCode(sendRequest('person@cgi.com'))).status,429);
  assert.equal(calls.sends.length,3);
  assert.equal((await db.query("SELECT count FROM auth_attempts WHERE key='code:person@cgi.com'")).rows[0].count,4);

  calls=mockClient();
  const verifyRequest=(email,code='123456')=>new Request('https://ballot.example/api/auth/verify',{method:'POST',headers:{origin:'https://ballot.example',host:'ballot.example','content-type':'application/json'},body:JSON.stringify({email,code})});
  const plusVerify=await verifyCode(verifyRequest('person+tag@cgi.com'));
  assert.equal(plusVerify.status,400);assert.match((await plusVerify.json()).error,/\+ tag/);
  const beforeInvalid=queries;
  assert.equal((await verifyCode(verifyRequest('person@cgi.com','bad'))).status,400);
  assert.equal(queries,beforeInvalid);
  for(let i=0;i<10;i++)assert.equal((await verifyCode(verifyRequest(i%2?' PERSON@CGI.COM ':'person@cgi.com'))).status,200);
  assert.equal((await verifyCode(verifyRequest('person@cgi.com'))).status,429);
  assert.equal(calls.otps.length,10);
  assert.equal((await db.query("SELECT count FROM auth_attempts WHERE key='verify:person@cgi.com'")).rows[0].count,11);
  calls=mockClient({error:{status:429,message:'Supabase limit'}});
  assert.equal((await verifyCode(verifyRequest('fresh@cgi.com'))).status,429);
  assert.equal(calls.signOut,1);
  calls=mockClient({error:{status:429,message:'Supabase limit'},signOutThrows:true});
  const oldSignOutError=console.error;console.error=()=>{};
  try{assert.equal((await verifyCode(verifyRequest('another@cgi.com'))).status,429)}finally{console.error=oldSignOutError}
  logged=0;console.error=()=>logged++;
  try{
   globalThis.__authTestQuery=async()=>{throw Error('db unavailable')};
   calls=mockClient();
   assert.equal((await sendCode(sendRequest('fresh@cgi.com'))).status,200);
   assert.equal(calls.sends.length,1);
   assert.equal(logged,1);
  }finally{console.error=oldError}
 }finally{
  if(priorSite===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=priorSite;
  if(priorNode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorNode;
 }
 console.log('PASS: atomic auth budgets, migration access controls, window rollover, normalized email routes, 429 preservation, fail-open database handling.');
}finally{await db.close()}
