import {cookies} from 'next/headers';
import {isLocalPreview} from '@/lib/runtime';
import {sameOrigin,authJson} from '@/lib/auth-request';
export async function POST(req:Request){
 if(!isLocalPreview()||!['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname))return new Response('Not found',{status:404});
 if(!sameOrigin(req))return authJson({error:'Please use the local preview.'},403);
 const role=(await req.formData()).get('role');if(role!=='admin'&&role!=='voter')return authJson({error:'Choose a preview role.'},400);
 (await cookies()).set('contest-local-preview',role==='admin'?role:`voter:${crypto.randomUUID()}`,{httpOnly:true,sameSite:'strict',path:'/',maxAge:3600});
 return new Response(null,{status:303,headers:{Location:'/'}});
}
