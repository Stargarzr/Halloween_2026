import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try{
 await db.exec(readFileSync('supabase/migrations/202610070001_contest.sql','utf8'));
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
 console.log('PASS: PostgreSQL migration, voting window, concurrent duplicate-vote rejection, finalized-state lock, permanent concurrent tie draw.');
}finally{await db.close()}
