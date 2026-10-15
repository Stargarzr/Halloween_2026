import {authClient} from '@/lib/supabase/server';
import {memberFromVerifiedUser} from '@/lib/access-policy';

type EmailOtpType='signup'|'invite'|'magiclink'|'recovery'|'email_change'|'email';
const otpTypes=new Set<EmailOtpType>(['signup','invite','magiclink','recovery','email_change','email']);

export async function GET(req:Request){
 const url=new URL(req.url);
 let client:Awaited<ReturnType<typeof authClient>>|undefined;
 let established=false;
 try{
  client=await authClient();
  const code=url.searchParams.get('code');
  const tokenHash=url.searchParams.get('token_hash');
  const type=url.searchParams.get('type');
  let result;
  if(code){
   result=await client.auth.exchangeCodeForSession(code);
  }else if(tokenHash&&type&&otpTypes.has(type as EmailOtpType)){
   result=await client.auth.verifyOtp({token_hash:tokenHash,type:type as EmailOtpType});
  }
  if(result&&!result.error&&result.data.session){
   established=true;
   if(memberFromVerifiedUser(result.data.user)){
    return Response.redirect(new URL('/',url),303);
   }
  }
 }catch(error){
  console.error('Email callback failed:',error);
 }
 if(client&&established){
  try{await client.auth.signOut()}catch(error){console.error('Email callback sign-out failed:',error)}
 }
 return Response.redirect(new URL('/',url),303);
}
