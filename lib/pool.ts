// Pool policy and transaction helper for the hosted PostgreSQL path. Its only runtime import is pg itself, so
// tests/database.mjs can load it directly under Node.
import {Client,type PoolConfig} from 'pg';
type Params=unknown[]|undefined;
export type Query=(sql:string,params?:Params)=>Promise<{rows:any[];rowCount?:number|null;affectedRows?:number}>;
// The subset of pg.PoolClient that runTransaction needs; tests pass a stub.
export type TransactionClient={query:(sql:string,params?:Params)=>Promise<any>;release:(error?:Error|boolean)=>void};
// TLS policy (Performance 4): when DATABASE_URL is set, ssl is always set here, {ca} from SUPABASE_CA_CERT or
// {rejectUnauthorized:true}. pg merges the parsed connection string over these options, so any ssl*/sslmode/
// uselibpqcompat parameter in the URL would silently replace the object below. Two layers refuse that: the URL's own
// query keys are read the way pg-connection-string reads them (WHATWG URL, so percent-encoded names decode), and the
// effective parameters pg will use are checked after its merge. With a CA configured any TLS parameter in the URL is an
// error (the README procedure says to remove sslmode and keep the CA in the environment); without one only sslmode values
// that keep verification on are accepted. Never rejectUnauthorized:false, never NODE_TLS_REJECT_UNAUTHORIZED=0.
const safeModes=new Set(['require','verify-ca','verify-full']);
export function poolConfig(env:Record<string,string|undefined>):PoolConfig{
 const connectionString=env.DATABASE_URL;
 if(!connectionString)throw Error('DATABASE_URL is not set.');
 // pg also accepts relative strings such as `db?host=…`, which `new URL` cannot scan; Supabase URLs are absolute, so require that.
 if(!/^postgres(ql)?:\/\//i.test(connectionString))throw Error('DATABASE_URL must be an absolute postgres:// URL.');
 const ca=env.SUPABASE_CA_CERT?.trim();
 for(const [key,value] of new URL(connectionString).searchParams){
  if(!/^(ssl[a-z]*|uselibpqcompat)$/i.test(key))continue;
  if(ca)throw Error(`DATABASE_URL must not contain ${key} while SUPABASE_CA_CERT is set; remove it from the URL and keep the CA in the environment.`);
  if(key!=='sslmode')throw Error(`DATABASE_URL parameter ${key} is not supported; configure TLS through SUPABASE_CA_CERT.`);
  if(!safeModes.has(value))throw Error(`DATABASE_URL sslmode=${value} is not allowed; TLS verification is mandatory.`);
 }
 const config:PoolConfig={connectionString,ssl:ca?{ca}:{rejectUnauthorized:true},max:3,idleTimeoutMillis:10000,connectionTimeoutMillis:10000,statement_timeout:10000,allowExitOnIdle:true};
 // What pg will actually use: the parsed URL merged over the options above. Constructing a Client opens nothing.
 let effective:unknown;
 // connectionParameters is a real pg.Client field that @types/pg does not declare.
 try{effective=(new Client(config) as unknown as {connectionParameters:{ssl?:unknown}}).connectionParameters.ssl}catch(e){throw Error(`DATABASE_URL could not be parsed: ${(e as Error).message}`)}
 const ssl=effective as {rejectUnauthorized?:unknown;ca?:unknown}|boolean|undefined;
 const verified=!!ssl&&typeof ssl==='object'&&ssl.rejectUnauthorized!==false&&(ca?ssl.ca===ca:!('ca' in ssl));
 if(!verified)throw Error('DATABASE_URL overrides the TLS settings derived from the environment; remove ssl, sslmode, and related parameters from the URL.');
 return config;
}
// Runs fn inside BEGIN/COMMIT on one client and releases that client exactly once on every path (Performance 5).
// If ROLLBACK itself fails the client is released with that error, so node-postgres destroys the connection instead
// of returning a client stuck in an aborted transaction to the pool. The original error always propagates.
export async function runTransaction<T>(client:TransactionClient,fn:(query:Query)=>Promise<T>):Promise<T>{
 let result:T;
 try{await client.query('BEGIN');result=await fn((sql,params)=>client.query(sql,params));await client.query('COMMIT')}
 catch(e){
  try{await client.query('ROLLBACK')}
  catch(rollbackError){client.release(rollbackError instanceof Error?rollbackError:Error(String(rollbackError)));throw e}
  client.release();throw e;
 }
 client.release();
 return result;
}
