#!/usr/bin/env node
// One-command hosted setup for Boo Ballot: Supabase project + migrations + auth config, Netlify site + env + deploy, then live checks.
// Idempotent: re-running against existing resources only re-applies configuration. Nothing secret is ever printed.
// See deploy.md for the prerequisites and the few things that stay manual (SMTP credentials, DNS).
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import pg from 'pg';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const args=parseArgs(process.argv.slice(2));
const dryRun=!!args['dry-run'];
const log=(...m)=>console.log(...m);
const fail=(m)=>{console.error('\n✖ '+m);process.exit(1)};

if(args.help){console.log(`Usage: node scripts/deploy-setup.mjs [options]
  --name <slug>            Base name for new resources (default boo-ballot)
  --supabase-ref <ref>     Reuse an existing Supabase project (needs SUPABASE_DB_PASSWORD in the environment)
  --org-id <id>            Supabase organization for a new project (auto when you have exactly one)
  --region <region>        Supabase region for a new project (default us-east-1)
  --netlify-site <id|name> Reuse an existing Netlify site
  --site-url <https://…>   Public origin (default: the Netlify site URL)
  --otp-limit <n>          Supabase rate_limit_otp (default 600)
  --verify-limit <n>       Supabase rate_limit_verify (default 600)
  --skip-deploy            Configure everything but do not build/deploy
  --dry-run                Print the plan, change nothing
Environment (optional): SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD, OPENAI_API_KEY,
  SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SENDER_EMAIL SMTP_SENDER_NAME (custom SMTP; raises the email-send limit)`);process.exit(0)}

const name=(args.name||'boo-ballot').replace(/[^a-z0-9-]/g,'-');
const region=args.region||'us-east-1';
const otpLimit=Number(args['otp-limit']||600), verifyLimit=Number(args['verify-limit']||600);

// ---------- helpers ----------
function parseArgs(list){const o={};for(let i=0;i<list.length;i++){const a=list[i];if(!a.startsWith('--'))continue;const k=a.slice(2);const v=list[i+1]&&!list[i+1].startsWith('--')?list[++i]:true;o[k]=v}return o}
function run(cmd,argv,opts={}){const r=spawnSync(cmd,argv,{encoding:'utf8',...opts});if(r.error)fail(`${cmd} not found: ${r.error.message}`);if(r.status!==0&&!opts.allowFail)fail(`${cmd} ${argv.filter(a=>!/^(sb_|postgres|eyJ|-----)/.test(a)).join(' ')} failed:\n${(r.stderr||r.stdout).slice(0,800)}`);return r}
function json(cmd,argv){const out=run(cmd,argv).stdout;const i=out.indexOf('[')<0?out.indexOf('{'):Math.min(...[out.indexOf('['),out.indexOf('{')].filter(x=>x>=0));try{return JSON.parse(out.slice(i))}catch{fail(`could not parse JSON from ${cmd}: ${out.slice(0,200)}`)}}
function supabaseToken(){if(process.env.SUPABASE_ACCESS_TOKEN)return process.env.SUPABASE_ACCESS_TOKEN;const k=spawnSync('security',['find-generic-password','-s','Supabase CLI','-w'],{encoding:'utf8'});if(k.status===0&&k.stdout.trim())return k.stdout.trim();const f=path.join(process.env.HOME||'',' .supabase/access-token'.trim());if(existsSync(f))return readFileSync(f,'utf8').trim();fail('No Supabase access token: run `supabase login` or set SUPABASE_ACCESS_TOKEN')}
async function api(token,method,p,body){const r=await fetch('https://api.supabase.com/v1'+p,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const t=await r.text();if(!r.ok)fail(`Supabase API ${method} ${p} → ${r.status}: ${t.slice(0,300)}`);return t?JSON.parse(t):null}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

// ---------- 1. preflight ----------
log('▸ Preflight');
run('supabase',['--version']);run('netlify',['--version']);run('openssl',['version']);
const nlUser=run('netlify',['api','getCurrentUser'],{allowFail:true});if(nlUser.status!==0||!/"email"/.test(nlUser.stdout))fail('Netlify CLI is not logged in: run `netlify login`');log(`  netlify user ${(nlUser.stdout.match(/"email":\s*"([^"]+)"/)||[])[1]||''}`);
const token=supabaseToken();
const migrationsDir=path.join(root,'supabase','migrations');
const migrations=readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort();
log(`  migrations: ${migrations.join(', ')}`);
if(!/^https:\/\/[^/]+$/.test(args['site-url']||'https://x')&&args['site-url'])fail('--site-url must be an absolute https origin with no path');

// ---------- 2. Supabase project ----------
log('▸ Supabase project');
let ref=args['supabase-ref'],dbPassword=process.env.SUPABASE_DB_PASSWORD;
const projects=json('supabase',['projects','list','-o','json']);
if(ref){const p=projects.find(p=>p.ref===ref);if(!p)fail(`project ${ref} not found in your account`);if(!dbPassword)fail('reusing a project needs SUPABASE_DB_PASSWORD in the environment');log(`  reusing ${p.name} (${ref}, ${p.region}, ${p.status})`)}
else{
  const existing=projects.find(p=>p.name===name);
  if(existing){fail(`a project named ${name} already exists (${existing.ref}); pass --supabase-ref ${existing.ref} with SUPABASE_DB_PASSWORD, or --name something else`)}
  let org=args['org-id'];if(!org){const orgs=json('supabase',['orgs','list','-o','json']);if(orgs.length!==1)fail(`pass --org-id; your organizations: ${orgs.map(o=>`${o.id} (${o.name})`).join(', ')}`);org=orgs[0].id}
  dbPassword=randomBytes(30).toString('base64').replace(/[^A-Za-z0-9]/g,'').slice(0,32);
  log(`  creating ${name} in ${org} (${region}) with a generated database password`);
  if(dryRun){ref='<new-ref>'}else{const created=json('supabase',['projects','create',name,'--org-id',org,'--region',region,'--db-password',dbPassword,'-o','json']);ref=created.ref;log(`  created ${ref}`)}
}
if(!dryRun){for(let i=0;i<40;i++){const p=json('supabase',['projects','list','-o','json']).find(p=>p.ref===ref);if(p&&p.status==='ACTIVE_HEALTHY')break;log(`  waiting for the project to be healthy (${p?.status})…`);await sleep(15000)}}

// ---------- 3. API keys ----------
log('▸ API keys');
let publishable,secret;
if(!dryRun){const keys=json('supabase',['projects','api-keys','--project-ref',ref,'-o','json']);publishable=keys.find(k=>k.type==='publishable')?.api_key||keys.find(k=>k.name==='anon')?.api_key;secret=keys.find(k=>k.type==='secret')?.api_key||keys.find(k=>k.name==='service_role')?.api_key;if(!publishable||!secret)fail('could not read the publishable and secret keys');log(`  publishable key ${publishable.slice(0,14)}…, secret key present`)}

// ---------- 4. CA certificate from the pooler's own chain, then a verified connection ----------
log('▸ Database TLS');
const poolerHosts=['aws-0-'+region+'.pooler.supabase.com','aws-1-'+region+'.pooler.supabase.com'];
let ca='',poolerHost='',dbClient=null;
if(!dryRun){
  for(const host of poolerHosts){const chain=spawnSync('openssl',['s_client','-starttls','postgres','-connect',`${host}:6543`,'-showcerts'],{input:'',encoding:'utf8'}).stdout||'';const certs=chain.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[];for(const c of certs){const info=spawnSync('openssl',['x509','-noout','-subject','-issuer'],{input:c,encoding:'utf8'}).stdout;const s=(info.match(/subject=(.*)/)||[])[1]?.trim(),i=(info.match(/issuer=(.*)/)||[])[1]?.trim();if(s&&s===i){ca=c+'\n';log(`  root CA from ${host}: ${s.split('CN=')[1]||s}`);break}}if(ca)break}
  if(!ca)fail('could not extract the Supabase root CA; download it from the dashboard (Project Settings → Database) and set SUPABASE_CA_CERT by hand');
  for(const host of poolerHosts){const c=new pg.Client({host,port:5432,user:`postgres.${ref}`,password:dbPassword,database:'postgres',ssl:{ca},connectionTimeoutMillis:15000});try{await c.connect();poolerHost=host;dbClient=c;log(`  verified TLS connection to ${host} (session port 5432)`);break}catch(e){log(`  ${host}: ${e.code||''} ${String(e.message).slice(0,70)}`)}}
  if(!dbClient)fail('no pooler host accepted the connection; check the database password and that the project is healthy');
}
const databaseUrl=dryRun?'<pooler url>':`postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@${poolerHost}:6543/postgres`;

// ---------- 5. migrations (idempotent files) ----------
log('▸ Migrations');
if(!dryRun){for(const m of migrations){try{await dbClient.query(readFileSync(path.join(migrationsDir,m),'utf8'));log(`  applied ${m}`)}catch(e){fail(`${m}: ${e.code||''} ${e.message}`)}}
  const t=await dbClient.query("select c.relname n, c.relrowsecurity rls from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' order by 1");const noRls=t.rows.filter(r=>!r.rls).map(r=>r.n);if(noRls.length)fail(`tables without RLS: ${noRls.join(', ')}`);
  const b=await dbClient.query("select id,public from storage.buckets where id='costume-photos'");if(!b.rows.length||b.rows[0].public)fail('costume-photos bucket missing or public');
  const g=await dbClient.query("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')");if(g.rows[0].n)fail('anon/authenticated still have grants on public tables');
  log(`  ${t.rows.length} tables with RLS, private costume-photos bucket, browser roles revoked`);await dbClient.end()}

// ---------- 6. Netlify site ----------
log('▸ Netlify site');
let siteId,siteUrl;
if(args['netlify-site']){const s=json('netlify',['api','getSite',...(/^[0-9a-f-]{36}$/.test(args['netlify-site'])?['--data',JSON.stringify({site_id:args['netlify-site']})]:['--data',JSON.stringify({site_id:args['netlify-site']})])]);siteId=s.id;siteUrl=s.ssl_url||s.url;log(`  reusing ${s.name} (${siteUrl})`)}
else{const sname=`${name}-${randomBytes(3).toString('hex')}`;log(`  creating ${sname}`);if(dryRun){siteId='<new-site>';siteUrl=`https://${sname}.netlify.app`}else{const out=run('netlify',['sites:create','--name',sname,'--disable-linking']).stdout;siteId=(out.match(/Project ID:\s+(\S+)/)||out.match(/Site ID:\s+(\S+)/))?.[1];siteUrl=(out.match(/URL:\s+(https:\/\/\S+)/)||[])[1];if(!siteId||!siteUrl)fail('could not read the new site id/url from netlify output:\n'+out);log(`  created ${siteUrl}`)}}
const SITE_URL=args['site-url']||siteUrl.replace(/\/$/,'');

// ---------- 7. Supabase auth configuration (Management API) ----------
log('▸ Supabase auth configuration');
const smtp=process.env.SMTP_HOST?{smtp_host:process.env.SMTP_HOST,smtp_port:process.env.SMTP_PORT||'587',smtp_user:process.env.SMTP_USER,smtp_pass:process.env.SMTP_PASS,smtp_admin_email:process.env.SMTP_SENDER_EMAIL,smtp_sender_name:process.env.SMTP_SENDER_NAME||'Boo Ballot'}:null;
const tokenLine='<p style="font-size:1.4em;letter-spacing:.15em"><strong>{{ .Token }}</strong></p>';
const magic=`<h2>Your Boo Ballot sign-in</h2><p>Enter this code on the sign-in page:</p>${tokenLine}<p>Or open this link in the same browser: <a href="{{ .ConfirmationURL }}">Sign in</a></p>`;
const confirm=`<h2>Confirm your email for Boo Ballot</h2><p>Enter this code on the sign-in page:</p>${tokenLine}<p>Or open this link in the same browser: <a href="{{ .ConfirmationURL }}">Confirm</a></p>`;
if(!dryRun){const current=await api(token,'GET',`/projects/${ref}/config/auth`);
  const patch={site_url:SITE_URL,uri_allow_list:[SITE_URL,SITE_URL+'/auth/callback',SITE_URL+'/**'].join(','),external_email_enabled:true,mailer_autoconfirm:false,rate_limit_otp:otpLimit,rate_limit_verify:verifyLimit};
  if(smtp){Object.assign(patch,smtp,{rate_limit_email_sent:Number(process.env.SMTP_EMAIL_LIMIT||300)})}
  await api(token,'PATCH',`/projects/${ref}/config/auth`,patch);
  log(`  site_url ${SITE_URL}; allowlist includes /auth/callback; rate_limit_otp ${otpLimit}, rate_limit_verify ${verifyLimit}; SMTP ${smtp?'configured, email limit raised':'NOT configured (Supabase default sender: 2 emails/hour, team members only)'}`);
  // Templates: Supabase refuses template edits on the free tier while the default sender is in use; then the email carries only the link.
  const templates={};
  if(!/\{\{ \.Token \}\}/.test(current.mailer_templates_magic_link_content||''))templates.mailer_templates_magic_link_content=magic;
  if(!/\{\{ \.Token \}\}/.test(current.mailer_templates_confirmation_content||''))templates.mailer_templates_confirmation_content=confirm;
  if(Object.keys(templates).length){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(templates)});if(r.ok)log('  email templates now show {{ .Token }} next to the link');else log(`  ⚠ email templates NOT changed (${(await r.text()).slice(0,160)}). Until custom SMTP is configured (SMTP_* variables) the sign-in email contains only the link, which must be opened in the same browser.`)}
  else log('  email templates already show {{ .Token }}')}
else log(`  would set site_url ${SITE_URL}, allowlist, limits ${otpLimit}/${verifyLimit}, templates with {{ .Token }}${smtp?', SMTP':''}`);

// ---------- 8. Netlify environment ----------
log('▸ Netlify environment (scoped to builds + functions, production context)');
const vars=[['SUPABASE_URL',`https://${ref}.supabase.co`,false],['SUPABASE_PUBLISHABLE_KEY',publishable,false],['SUPABASE_SERVICE_ROLE_KEY',secret,true],['DATABASE_URL',databaseUrl,true],['SUPABASE_CA_CERT',ca,false],['SITE_URL',SITE_URL,false]];
if(process.env.OPENAI_API_KEY)vars.push(['OPENAI_API_KEY',process.env.OPENAI_API_KEY,true]);
for(const [k,v,isSecret] of vars){if(dryRun){log(`  would set ${k}${isSecret?' (secret)':''}`);continue}run('netlify',['env:set','--site',siteId,'--context','production','--scope','builds','functions',...(isSecret?['--secret']:[]),k,'--',v]);log(`  set ${k}${isSecret?' (secret)':''}`)}

// ---------- 9. deploy ----------
if(args['skip-deploy']||dryRun){log(`▸ Deploy skipped${dryRun?' (dry run)':''}`)}
else{log('▸ Build and deploy (this takes a few minutes)');const d=run('netlify',['deploy','--build','--prod','--site',siteId,'--message','deploy-setup'],{stdio:['ignore','pipe','pipe']});const m=d.stdout.match(/Website URL:\s+(\S+)|Deploy is live/);log(`  ${m?'deployed':'finished'}: ${SITE_URL}`)}

// ---------- 10. live checks ----------
if(!dryRun&&!args['skip-deploy']){log('▸ Live checks');
  const h=await fetch(SITE_URL+'/sign-in');const need=['x-frame-options','referrer-policy','x-content-type-options','strict-transport-security'];const missing=need.filter(n=>!h.headers.get(n));log(`  /sign-in ${h.status}; security headers ${missing.length?'MISSING: '+missing.join(', '):'present'}; cache-control ${h.headers.get('cache-control')}`);
  const c=await fetch(SITE_URL+'/api/contest');log(`  /api/contest without a session → ${c.status} (expect 401)`);
  const p=await fetch(SITE_URL+'/api/auth/code',{method:'POST',headers:{Origin:SITE_URL,'Content-Type':'application/json'},body:JSON.stringify({email:'probe+tag@cgi.com'})});log(`  plus-tag sign-in probe → ${p.status} (expect 400, no email sent)`);
  const x=await fetch(SITE_URL+'/api/auth/code',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({email:'a@cgi.com'})});log(`  cross-origin sign-in probe → ${x.status} (expect 403)`);}

log(`\n✔ Done.
  App:        ${SITE_URL}
  Supabase:   https://supabase.com/dashboard/project/${ref}
  Netlify:    ${siteId}
Still manual: ${smtp?'nothing for email':'custom SMTP (set SMTP_* and re-run, or configure in the Supabase dashboard)'}; a custom domain if wanted.
Tear down:   netlify sites:delete ${siteId} --force   and   supabase projects delete ${ref}`);
