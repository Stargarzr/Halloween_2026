import { Pool } from 'pg';
import { isLocalPreview } from './runtime';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
type Query = (sql:string,params?:any[])=>Promise<{rows:any[];rowCount?:number|null;affectedRows?:number}>;
type Connection = {query:Query;transaction:<T>(fn:(query:Query)=>Promise<T>)=>Promise<T>};
const globalDatabase=globalThis as typeof globalThis & {contestDatabase?:Promise<Connection>};
async function connect():Promise<Connection>{
 if(process.env.DATABASE_URL){
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000});
  return {query:(sql,params)=>pool.query(sql,params),transaction:async fn=>{const client=await pool.connect();try{await client.query('BEGIN');const result=await fn((sql,params)=>client.query(sql,params));await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}};
 }
 if(!isLocalPreview())throw Error('Database is not configured.');
 const {PGlite}=await import('@electric-sql/pglite');
 const localDirectory=process.env.CONTEST_LOCAL_DATA_DIR||path.join(process.cwd(),'.local-contest');
 await mkdir(localDirectory,{recursive:true});
 const local=new PGlite(path.join(localDirectory,'database'));
 await local.waitReady;
 await local.exec(await readFile(path.join(process.cwd(),'supabase/migrations/202610070001_contest.sql'),'utf8'));
 return {query:(sql,params)=>local.query(sql,params),transaction:fn=>local.transaction(tx=>fn((sql,params)=>tx.query(sql,params)))};
}
function connection(){return globalDatabase.contestDatabase??=connect().catch(e=>{delete globalDatabase.contestDatabase;throw e})}
export class Statement {
 params:any[]=[];sql:string;
 constructor(sql:string){let index=0;this.sql=sql.replace(/\?/g,()=>`$${++index}`)}
 bind(...params:any[]){const bound=new Statement(this.sql);bound.params=params;return bound}
 async first<T=any>():Promise<T|null>{return (await this.execute()).rows[0]??null}
 async all(){return {results:(await this.execute()).rows}}
 async run(){const r=await this.execute();return {meta:{changes:r.rowCount??r.affectedRows??0}}}
 async execute(query?:Query){return (query??(await connection()).query)(this.sql,this.params)}
}
export function database(){return {prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>(await connection()).transaction(async query=>{const results=[];for(const statement of statements)results.push(await statement.execute(query));return results})}}
