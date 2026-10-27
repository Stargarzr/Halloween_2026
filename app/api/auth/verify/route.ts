import {authClient} from '@/lib/supabase/server';
import {eligibleEmail,hasPlusTag,memberFromVerifiedUser,normalizeEmail} from '@/lib/access-policy';
import {sameOrigin,authJson,authRateLimit} from '@/lib/auth-request';
export async function POST(req:Request){
 if(!sameOrigin(req))return authJson({error:'Please use the contest sign-in page.'},403);
 try{
  const {email,code}=await req.json() as Record<string,unknown>;
  if(hasPlusTag(email))return authJson({error:'Email aliases with a + are not eligible. Use your work email without a + tag.'},400);
  if(!eligibleEmail(email)||typeof code!=='string'||!/^\d{6,8}$/.test(code))return authJson({error:'Enter your work email and the code from your inbox.'},400);
  const normalizedEmail=normalizeEmail(email);
  if(!await authRateLimit(`verify:${normalizedEmail}`,10,600))return authJson({error:'Too many attempts. Wait 10 minutes and try again.'},429);
  const client=await authClient();
  const {data,error}=await client.auth.verifyOtp({email:normalizedEmail,token:code,type:'email'});
  if(error||!memberFromVerifiedUser(data.user)){
   try{await client.auth.signOut()}catch(signOutError){console.error('Auth sign-out failed:',signOutError)}
   if(error?.status===429)return authJson({error:'Too many attempts. Wait a minute and try again.'},429);
   return authJson({error:'That code is invalid or expired. Request a new code and try again.'},401);
  }
  return authJson({ok:true});
 }catch{return authJson({error:'We could not verify your code. Please try again.'},503)}
}
