import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
// Supabase Auth calls (session lookup, sending a code, verifying one) are bounded so a stalled auth server cannot hold a Netlify function to its 60 s limit. 15 s covers the synchronous SMTP send inside signInWithOtp.
const AUTH_TIMEOUT=15000;
const timedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(AUTH_TIMEOUT)]):AbortSignal.timeout(AUTH_TIMEOUT)});
export async function authClient(){
 const jar=await cookies();
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw Error('Email sign-in has not been connected yet.');
 return createServerClient(url,key,{
  global:{fetch:timedFetch},
  cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'},
  cookies:{
   getAll:()=>jar.getAll(),
   setAll:values=>{
    try{values.forEach(({name,value,options})=>jar.set(name,value,options))}
    catch{/* Server components cannot set cookies; proxy handles refresh. */}
   },
  },
 });
}
