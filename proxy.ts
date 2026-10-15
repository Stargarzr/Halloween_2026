import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';
export async function proxy(request:NextRequest){
 let response=NextResponse.next({request});
 if(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY){
  const supabase=createServerClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{
   cookieOptions:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'},
   cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{values.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});values.forEach(({name,value,options})=>response.cookies.set(name,value,options))}},
  });
  try{await supabase.auth.getUser()}catch{/* Protected handlers fail closed when verification is unavailable. */}
 }
 response.headers.set('X-Frame-Options','DENY');
 response.headers.set('Referrer-Policy','same-origin');
 response.headers.set('X-Content-Type-Options','nosniff');
 if(process.env.SITE_URL?.startsWith('https://'))response.headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 if(!request.nextUrl.pathname.startsWith('/api/image/'))response.headers.set('Cache-Control','private, no-store');
 return response;
}
export const config={matcher:['/','/sign-in','/auth/:path*','/api/:path*']};
