import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {applyLocalMigrations} from '../lib/migrations.ts';
const db=new PGlite();
try{
 await applyLocalMigrations(sql=>db.exec(sql));
 await db.query("INSERT INTO entries(id,name,costume,category,image,published) VALUES('one','Test','Robot','Most Creative/Original','photo',1)");
 await db.query("INSERT INTO codes(hash,created) VALUES('person','today')");
 const vote=()=>db.query("INSERT INTO votes(id,code,category,entry) SELECT $1,'person','Most Creative/Original',e.id FROM entries e,event s WHERE e.id='one' AND e.category='Most Creative/Original' AND e.published=1 AND s.id=1 AND s.state='open'",[crypto.randomUUID()]);
 assert.equal((await vote()).affectedRows,0);
 await db.query("UPDATE event SET state='open'");
 const votes=await Promise.allSettled(Array.from({length:8},vote));assert.equal(votes.filter(x=>x.status==='fulfilled').length,1);assert.equal(votes.filter(x=>x.status==='rejected'&&x.reason.code==='23505').length,7);
 await db.query("UPDATE event SET state='paused'");assert.equal((await vote()).affectedRows,0);
 await db.query("UPDATE event SET state='closed'");
 await db.query("INSERT INTO event(id,state) VALUES(1,'open') ON CONFLICT(id) DO UPDATE SET state='open' WHERE event.state IN ('draft','paused')");assert.equal((await db.query('SELECT state FROM event')).rows[0].state,'closed');
 const attempts=await Promise.all(Array.from({length:5},()=>db.query("INSERT INTO draws(category,winner,tied,time) VALUES('Most Creative/Original',$1,'[]','today') ON CONFLICT DO NOTHING",[crypto.randomUUID()])));assert.equal(attempts.reduce((n,x)=>n+x.affectedRows,0),1);
 assert.equal((await db.query('SELECT * FROM draws')).rows.length,1);
 console.log('PASS: PostgreSQL migration, voting window, concurrent duplicate-vote rejection, finalized-state lock, permanent concurrent tie draw, migration loader.');
}finally{await db.close()}
const expected=readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort();
const dir=mkdtempSync(path.join(tmpdir(),'boo-migrations-'));
try{
 const first=new PGlite(dir);
 try{
  await first.waitReady;
  assert.deepEqual(await applyLocalMigrations(sql=>first.exec(sql)),expected);
  assert.deepEqual((await first.query('SELECT name FROM _local_migrations ORDER BY name')).rows.map(row=>row.name),expected);
  const bucket=(await first.query("SELECT public FROM storage.buckets WHERE id='costume-photos'")).rows;assert.equal(bucket.length,1);assert.equal(bucket[0].public,false);
 }finally{await first.close()}
 const second=new PGlite(dir);
 try{
  await second.waitReady;
  assert.deepEqual(await applyLocalMigrations(sql=>second.exec(sql)),[]);
  assert.deepEqual((await second.query('SELECT name FROM _local_migrations ORDER BY name')).rows.map(row=>row.name),expected);
 }finally{await second.close()}
 console.log('PASS: migration loader applies all migrations once, records the ledger, and is idempotent across restarts.');
}finally{rmSync(dir,{recursive:true,force:true})}
const scratch=mkdtempSync(path.join(tmpdir(),'boo-migrations-atomic-'));
try{
 // Atomicity: a failing migration leaves neither its DDL nor a ledger row, and is retried once fixed; a non-idempotent predecessor is not re-run.
 writeFileSync(path.join(scratch,'0001_fragile.sql'),'CREATE TABLE fragile(id integer);\n');
 writeFileSync(path.join(scratch,'0002_broken.sql'),'CREATE TABLE broken(id integer);\nINSERT INTO missing_table VALUES(1);\n');
 const atomic=new PGlite();
 try{
  await assert.rejects(applyLocalMigrations(sql=>atomic.exec(sql),scratch),{code:'42P01'});
  const regclass=async name=>(await atomic.query(`SELECT to_regclass($1) r`,[name])).rows[0].r;
  assert.equal(await regclass('fragile'),'fragile');assert.equal(await regclass('broken'),null);
  assert.deepEqual((await atomic.query('SELECT name FROM _local_migrations ORDER BY name')).rows.map(row=>row.name),['0001_fragile.sql']);
  assert.equal((await atomic.query('SELECT 1 AS ok')).rows[0].ok,1);
  writeFileSync(path.join(scratch,'0002_broken.sql'),'CREATE TABLE broken(id integer);\n');
  assert.deepEqual(await applyLocalMigrations(sql=>atomic.exec(sql),scratch),['0002_broken.sql']);
  assert.equal(await regclass('broken'),'broken');
  assert.deepEqual(await applyLocalMigrations(sql=>atomic.exec(sql),scratch),[]);
 }finally{await atomic.close()}
 // Concurrency: two loaders on one fresh database apply the non-idempotent migration exactly once.
 const racing=new PGlite();
 try{
  const outcomes=await Promise.all([applyLocalMigrations(sql=>racing.exec(sql),scratch),applyLocalMigrations(sql=>racing.exec(sql),scratch)]);
  assert.deepEqual(outcomes.map(o=>o.length).sort(),[0,2]);
  assert.deepEqual((await racing.query('SELECT name FROM _local_migrations ORDER BY name')).rows.map(row=>row.name),['0001_fragile.sql','0002_broken.sql']);
  assert.equal((await racing.query('SELECT 1 AS ok')).rows[0].ok,1);
 }finally{await racing.close()}
 console.log('PASS: migration unit is atomic with its ledger row, failed migrations retry after a fix, concurrent loaders apply each migration once.');
}finally{rmSync(scratch,{recursive:true,force:true})}
{
 // C6: TLS policy for the hosted pool (Performance 4) and the transaction helper's release discipline (Performance 5).
 const {poolConfig,runTransaction}=await import('../lib/pool.ts');
 const url='postgres://user:secret@db.example:6543/postgres';
 assert.deepEqual(poolConfig({DATABASE_URL:url}).ssl,{rejectUnauthorized:true});
 assert.deepEqual(poolConfig({DATABASE_URL:url,SUPABASE_CA_CERT:'-----BEGIN CERTIFICATE-----\n'}).ssl,{ca:'-----BEGIN CERTIFICATE-----'});
 assert.deepEqual(poolConfig({DATABASE_URL:url+'?sslmode=require'}).ssl,{rejectUnauthorized:true});
 assert.throws(()=>poolConfig({DATABASE_URL:url+'?sslmode=require',SUPABASE_CA_CERT:'CERT'}),/must not contain sslmode/);
 assert.throws(()=>poolConfig({DATABASE_URL:url+'?application_name=x&sslnegotiation=direct',SUPABASE_CA_CERT:'CERT'}),/must not contain sslnegotiation/);
 assert.throws(()=>poolConfig({DATABASE_URL:url+'?%73slmode=require',SUPABASE_CA_CERT:'CERT'}),/must not contain sslmode/);
 assert.throws(()=>poolConfig({DATABASE_URL:url+'?ssl=true',SUPABASE_CA_CERT:'CERT'}),/must not contain ssl /);
 // Percent-encoded parameter names decode before pg merges them, so they must be refused too (C6 review round 1).
 for(const bad of ['sslmode=disable','sslmode=no-verify','sslmode=prefer','sslmode=allow','SSLMODE=disable','uselibpqcompat=true&sslmode=require','ssl=true','ssl=1','sslrootcert=/tmp/ca.pem','sslnegotiation=direct','%73slmode=disable','s%73lmode=no-verify','%75selibpqcompat=true&%73slmode=require','sslmode=requir%65&%73sl=0']){assert.throws(()=>poolConfig({DATABASE_URL:url+'?'+bad}),undefined,bad);assert.throws(()=>poolConfig({DATABASE_URL:url+'?'+bad,SUPABASE_CA_CERT:'CERT'}),undefined,bad+' with CA')}
 assert.deepEqual(poolConfig({DATABASE_URL:url+'?application_name=boo#sslmode=disable'}).ssl,{rejectUnauthorized:true});
 assert.deepEqual(poolConfig({DATABASE_URL:url+'?application_name=boo#sslmode=disable',SUPABASE_CA_CERT:'CERT'}).ssl,{ca:'CERT'});
 // The effective parameters pg derives keep verification on.
 const {Client}=await import('pg');
 for(const env of [{DATABASE_URL:url},{DATABASE_URL:url+'?sslmode=require'},{DATABASE_URL:url,SUPABASE_CA_CERT:'CERT'}]){const ssl=new Client(poolConfig(env)).connectionParameters.ssl;assert.ok(ssl&&typeof ssl==='object'&&ssl.rejectUnauthorized!==false,JSON.stringify(env));if(env.SUPABASE_CA_CERT)assert.equal(ssl.ca,'CERT')}
 assert.throws(()=>poolConfig({}),/DATABASE_URL/);
 for(const relative of ['db?host=db.example&sslmode=prefer','/var/run/postgresql?sslmode=disable','db.example:5432/db','socket:/tmp?db=x'])assert.throws(()=>poolConfig({DATABASE_URL:relative}),/absolute postgres/,relative);
 assert.deepEqual(poolConfig({DATABASE_URL:'postgresql://user:secret@db.example:6543/postgres'}).ssl,{rejectUnauthorized:true});
 const config=poolConfig({DATABASE_URL:url});
 assert.equal(config.statement_timeout,10000);assert.equal(config.allowExitOnIdle,true);assert.equal(config.max,3);assert.equal(config.connectionString,url);
 const stub=failOn=>{const calls=[],releases=[];return {calls,releases,client:{query:async sql=>{calls.push(sql);if(failOn?.(sql))throw Error('boom '+sql)},release:(...args)=>{releases.push(args)}}}};
 let s=stub();assert.equal(await runTransaction(s.client,async q=>{await q('SELECT 1');return 7}),7);assert.deepEqual(s.calls,['BEGIN','SELECT 1','COMMIT']);assert.deepEqual(s.releases,[[]]);
 s=stub(sql=>sql==='SELECT bad');await assert.rejects(runTransaction(s.client,q=>q('SELECT bad')),/boom SELECT bad/);assert.deepEqual(s.calls,['BEGIN','SELECT bad','ROLLBACK']);assert.deepEqual(s.releases,[[]]);
 s=stub(sql=>sql==='SELECT bad'||sql==='ROLLBACK');await assert.rejects(runTransaction(s.client,q=>q('SELECT bad')),/boom SELECT bad/);assert.equal(s.releases.length,1);assert.ok(s.releases[0][0] instanceof Error);assert.match(s.releases[0][0].message,/boom ROLLBACK/);
 s=stub(sql=>sql==='COMMIT');await assert.rejects(runTransaction(s.client,q=>q('SELECT 1')),/boom COMMIT/);assert.deepEqual(s.calls,['BEGIN','SELECT 1','COMMIT','ROLLBACK']);assert.deepEqual(s.releases,[[]]);
 s=stub(sql=>sql==='BEGIN');await assert.rejects(runTransaction(s.client,q=>q('SELECT 1')),/boom BEGIN/);assert.deepEqual(s.releases,[[]]);
 console.log('PASS: pool TLS policy (explicit ssl, CA from environment, sslmode conflicts refused), transaction helper releases exactly once and destroys a client whose rollback failed.');
}
