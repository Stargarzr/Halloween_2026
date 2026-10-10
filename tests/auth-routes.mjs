import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const moduleUrl=source=>`data:text/javascript,${encodeURIComponent(source)}`;
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const policyUrl=moduleUrl(compile(readFileSync('lib/access-policy.ts','utf8')));
const requestUrl=moduleUrl(compile(readFileSync('lib/auth-request.ts','utf8')));
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
const verified={id:'test-user',email:'voter@cgi.com',email_confirmed_at:'2026-10-10T12:00:00Z'};
const callbackRequest=(query,init)=>new Request(`https://ballot.example/auth/callback${query}`,init);
const sendRequest=email=>new Request('https://ballot.example/api/auth/code',{method:'POST',headers:{origin:'https://ballot.example',host:'ballot.example','content-type':'application/json'},body:JSON.stringify({email})});
function mockClient({user=verified,error=null,throws=false,initialSession=null,createsSession=true}={}){
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
  async signOut(){calls.signOut++;calls.session=null;return {error:null}},
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
