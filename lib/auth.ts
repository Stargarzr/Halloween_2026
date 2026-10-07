import {cookies} from 'next/headers';
import {cache} from 'react';
import {authClient} from './supabase/server';
import {memberFromVerifiedUser,type Member} from './access-policy';
import {isLocalPreview,authConfigured} from './runtime';
export const localPreview=isLocalPreview();
export const getMember=cache(async():Promise<Member|null>=>{
 if(isLocalPreview()){
  const role=(await cookies()).get('contest-local-preview')?.value;
  return role==='admin'||(role?.startsWith('voter:')&&/^voter:[a-f0-9-]{36}$/.test(role))?{id:`preview:${role}`,email:role==='admin'?'organizer@local.test':'voter@local.test',admin:role==='admin',localPreview:true}:null;
 }
 if(!authConfigured())return null;
 try{const {data:{user},error}=await (await authClient()).auth.getUser();return error?null:memberFromVerifiedUser(user)}catch{return null}
});
export function signOutPath(){return '/api/auth/sign-out'}
