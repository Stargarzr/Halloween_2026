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
