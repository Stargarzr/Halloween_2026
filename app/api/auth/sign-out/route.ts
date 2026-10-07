import {cookies} from 'next/headers';
import {authClient} from '@/lib/supabase/server';
import {authConfigured} from '@/lib/runtime';
import {sameOrigin,authJson} from '@/lib/auth-request';
export async function POST(req:Request){
 if(!sameOrigin(req))return authJson({error:'Please use the contest website.'},403);
 if(authConfigured())await (await authClient()).auth.signOut();
 (await cookies()).delete('contest-local-preview');
 return new Response(null,{status:303,headers:{Location:'/sign-in','Cache-Control':'no-store'}});
}
