import {authClient} from '@/lib/supabase/server';
import {eligibleEmail} from '@/lib/access-policy';
import {sameOrigin,authJson} from '@/lib/auth-request';
export async function POST(req:Request){
 if(!sameOrigin(req))return authJson({error:'Please use the contest sign-in page.'},403);
 try{
  const {email}=await req.json() as Record<string,unknown>;
  if(!eligibleEmail(email))return authJson({error:'Use your cgi.com or cgifederal.com email address.'},400);
  const {error}=await (await authClient()).auth.signInWithOtp({email:email.trim().toLowerCase(),options:{shouldCreateUser:true}});
  if(error)return authJson({error:'A code could not be sent. Wait a minute and retry, or contact an organizer.'},error.status===429?429:503);
  return authJson({ok:true});
 }catch{return authJson({error:'Email sign-in is not available yet. Contact an organizer.'},503)}
}
