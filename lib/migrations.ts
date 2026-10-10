// Local PGlite migration loader. Hosted Supabase applies migrations through its own tooling; this loader is for local PGlite only.
// The prelude exists because 202610070002_private_storage.sql references the anon/authenticated roles and storage.buckets,
// which Supabase provides and PGlite does not.
// Each migration runs as one multi-statement simple query, `INSERT ledger; <file>;`, which PostgreSQL executes in a single
// implicit transaction: the ledger row and the migration commit together or not at all, a failed migration leaves no trace
// (and no aborted transaction on the session) and is retried on the next start, and a concurrent loader fails on the ledger
// primary key before it runs any DDL. Consequently migration files must not contain their own BEGIN/COMMIT, and `exec` must
// run a multi-statement string as one simple query on one connection (PGlite exec, pg client or pool query without parameters all do).
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
export const preludeSql=`DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,name text NOT NULL,public boolean NOT NULL DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE IF NOT EXISTS public._local_migrations(name text PRIMARY KEY);`;
export type Exec=(sql:string)=>Promise<unknown>;
export const migrationsDirectory=path.join(process.cwd(),'supabase','migrations');
function rowsOf(result:unknown):{name:string}[]{
 const last=(Array.isArray(result)?result[result.length-1]:result) as {rows?:{name:string}[]}|undefined;
 return last?.rows??[];
}
function quote(value:string){return `'${value.replace(/'/g,"''")}'`}
async function recorded(exec:Exec,name:string){return rowsOf(await exec(`SELECT name FROM public._local_migrations WHERE name=${quote(name)}`)).length>0}
export async function applyLocalMigrations(exec:Exec,directory=migrationsDirectory):Promise<string[]>{
 await exec(preludeSql);
 const done=new Set(rowsOf(await exec('SELECT name FROM public._local_migrations')).map(row=>row.name));
 const names=readdirSync(directory).filter(name=>name.endsWith('.sql')).sort();
 const ran:string[]=[];
 for(const name of names){
  if(done.has(name))continue;
  const sql=readFileSync(path.join(directory,name),'utf8');
  try{await exec(`INSERT INTO public._local_migrations(name) VALUES (${quote(name)});\n${sql}\n;`)}
  catch(e){if(await recorded(exec,name))continue;throw e}
  ran.push(name);
 }
 return ran;
}
