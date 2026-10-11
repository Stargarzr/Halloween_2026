type Query=(sql:string,params:unknown[])=>Promise<{rows:{allowed:boolean}[]}>;

// The conflict update locks one key and increments it in the database, so concurrent requests share a budget.
export async function rateLimit(query:Query,key:string,max:number,windowSeconds:number):Promise<boolean>{
 try{
  const result=await query(`
   INSERT INTO public.auth_attempts AS current (key,count,window_start)
   VALUES ($1,1,now())
   ON CONFLICT (key) DO UPDATE SET
    count=CASE WHEN current.window_start <= now()-($2::integer * INTERVAL '1 second')
     THEN 1 ELSE current.count+1 END,
    window_start=CASE WHEN current.window_start <= now()-($2::integer * INTERVAL '1 second')
     THEN now() ELSE current.window_start END
   RETURNING count <= $3::integer AS allowed`,[key,windowSeconds,max]);
  return result.rows[0]?.allowed===true;
 }catch(error){
  console.error('Auth rate limit unavailable; allowing attempt:',error);
  return true;
 }
}
