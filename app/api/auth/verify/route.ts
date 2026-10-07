import {authClient} from '@/lib/supabase/server';
import {eligibleEmail,memberFromVerifiedUser} from '@/lib/access-policy';
import {sameOrigin,authJson} from '@/lib/auth-request';
export async function POST(req:Request){
 if(!sameOrigin(req))return authJson({error:'Please use the contest sign-in page.'},403);
 try{
  const {email,code}=await req.json() as Record<string,unknown>;
  if(!eligibleEmail(email)||typeof code!=='string'||!/^\d{6,8}$/.test(code))return authJson({error:'Enter your work email and the code from your inbox.'},400);
  const client=await authClient();
  const {data,error}=await client.auth.verifyOtp({email:email.trim().toLowerCase(),token:code,type:'email'});
  if(error||!memberFromVerifiedUser(data.user)){await client.auth.signOut();return authJson({error:'That code is invalid or expired. Request a new code and try again.'},401)}
  return authJson({ok:true});
 }catch{return authJson({error:'We could not verify your code. Please try again.'},503)}
}
