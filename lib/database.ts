import { Pool } from 'pg';
import { isLocalPreview } from './runtime';
import { applyLocalMigrations } from './migrations';
import { poolConfig, runTransaction, type Query } from './pool';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
type Connection = {query:Query;transaction:<T>(fn:(query:Query)=>Promise<T>)=>Promise<T>};
const globalDatabase=globalThis as typeof globalThis & {contestDatabase?:Promise<Connection>};
async function connect():Promise<Connection>{
 if(process.env.DATABASE_URL){
  const pool=new Pool(poolConfig(process.env));
  // A dropped idle connection emits 'error' on the pool; without a listener Node treats it as an uncaught exception.
  pool.on('error',e=>console.error('pg pool',e));
  return {query:(sql,params)=>pool.query(sql,params),transaction:async fn=>runTransaction(await pool.connect(),fn)};
 }
 if(!isLocalPreview())throw Error('Database is not configured.');
 const {PGlite}=await import('@electric-sql/pglite');
 const localDirectory=process.env.CONTEST_LOCAL_DATA_DIR||path.join(process.cwd(),'.local-contest');
 await mkdir(localDirectory,{recursive:true});
 const local=new PGlite(path.join(localDirectory,'database'));
 await local.waitReady;
 await applyLocalMigrations(sql=>local.exec(sql));
 return {query:(sql,params)=>local.query(sql,params),transaction:fn=>local.transaction(tx=>fn((sql,params)=>tx.query(sql,params)))};
}
function connection(){return globalDatabase.contestDatabase??=connect().catch(e=>{delete globalDatabase.contestDatabase;throw e})}
export class Statement {
 params:any[]=[];sql:string;
 // Rewrites every `?` to a positional $n placeholder, including a `?` inside a string literal, a comment, or the jsonb
 // `?` operator, so SQL passed here must never contain a literal question mark; bind such values as parameters instead.
 constructor(sql:string){let index=0;this.sql=sql.replace(/\?/g,()=>`$${++index}`)}
 bind(...params:any[]){const bound=new Statement(this.sql);bound.params=params;return bound}
 async first<T=any>():Promise<T|null>{return (await this.execute()).rows[0]??null}
 async all(){return {results:(await this.execute()).rows}}
 async run(){const r=await this.execute();return {meta:{changes:r.rowCount??r.affectedRows??0}}}
 async execute(query?:Query){return (query??(await connection()).query)(this.sql,this.params)}
}
export function database(){return {prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>(await connection()).transaction(async query=>{const results=[];for(const statement of statements)results.push(await statement.execute(query));return results})}}
