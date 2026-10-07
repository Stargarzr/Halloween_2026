import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
export async function authClient(){
 const jar=await cookies();
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw Error('Email sign-in has not been connected yet.');
 return createServerClient(url,key,{
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
