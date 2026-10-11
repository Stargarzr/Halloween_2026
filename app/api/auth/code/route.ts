import {authClient} from '@/lib/supabase/server';
import {eligibleEmail,hasPlusTag,normalizeEmail} from '@/lib/access-policy';
import {sameOrigin,authJson,authRateLimit} from '@/lib/auth-request';
import {isLoopbackHost} from '@/lib/runtime';

function callbackUrl():string|undefined{
 const configured=process.env.SITE_URL?.trim();
 if(!configured){
  if(process.env.NODE_ENV==='production')throw Error('SITE_URL must be configured for email sign-in.');
  return undefined;
 }
 const site=new URL(configured);
 if(site.username||site.password||site.search||site.hash||site.pathname!=='/'||
  (site.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&site.protocol==='http:'&&
   isLoopbackHost(site.host)))){
  throw Error('SITE_URL must be an HTTPS site origin (or a local development origin).');
 }
 return new URL('/auth/callback',site).toString();
}

export async function POST(req:Request){
 if(!sameOrigin(req))return authJson({error:'Please use the contest sign-in page.'},403);
 try{
  const {email}=await req.json() as Record<string,unknown>;
  if(hasPlusTag(email))return authJson({error:'Email aliases with a + are not eligible. Use your work email without a + tag.'},400);
  if(!eligibleEmail(email))return authJson({error:'Use your cgi.com or cgifederal.com email address.'},400);
  const emailRedirectTo=callbackUrl();
  const normalizedEmail=normalizeEmail(email);
  if(!await authRateLimit(`code:${normalizedEmail}`,3,600))return authJson({error:'Too many requests. Wait 10 minutes before requesting another code.'},429);
  const {error}=await (await authClient()).auth.signInWithOtp({
   email:normalizedEmail,
   options:{shouldCreateUser:true,...(emailRedirectTo?{emailRedirectTo}:{})},
  });
  if(error)return authJson({error:'A code could not be sent. Wait a minute and retry, or contact an organizer.'},error.status===429?429:503);
  return authJson({ok:true});
 }catch{return authJson({error:'Email sign-in is not available yet. Contact an organizer.'},503)}
}
