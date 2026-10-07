export const allowedDomains = new Set(['cgi.com','cgifederal.com']);
export const administratorEmails = new Set(['teri.musick@cgi.com','zachary.sarver@cgi.com','heath.rasnake@cgi.com','morghan.scales@cgi.com']);
export type Member={id:string;email:string;admin:boolean;localPreview?:boolean};
export function eligibleEmail(value:unknown):value is string{
 if(typeof value!=='string')return false;
 const parts=value.trim().toLowerCase().split('@');
 return parts.length===2&&/^[^\s@]+$/.test(parts[0])&&allowedDomains.has(parts[1]);
}
// The caller must obtain this record from Supabase auth.getUser(), not client input.
export function memberFromVerifiedUser(user:{id:string;email?:string;email_confirmed_at?:string}|null):Member|null{
 if(!user?.id||!user.email_confirmed_at||!eligibleEmail(user.email))return null;
 const email=user.email.trim().toLowerCase();
 return {id:`user:${user.id}`,email,admin:administratorEmails.has(email)};
}
