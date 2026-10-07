import {redirect} from 'next/navigation';
import {getMember} from '@/lib/auth';
import {isLocalPreview,authConfigured} from '@/lib/runtime';
import SignInForm from './sign-in-form';
export const dynamic='force-dynamic';
export default async function SignIn(){
 if(await getMember())redirect('/');
 return <main className="sign-in-page"><section className="sign-in-card"><p className="eyebrow">LEBANON SOCIAL CLUB // OCT 29, 2026</p><h1>Human<br/><em>verification.</em></h1><p>AI has taken over Halloween. Your work inbox is your way in.</p><SignInForm configured={authConfigured()}/><p className="muted">Company email only: cgi.com or cgifederal.com. One vote per account in each category. No company password or SSO required.</p>{isLocalPreview()&&<details className="preview-access"><summary>Local testing · no email sent</summary><p>Preview the app as an administrator or voter. These controls are disabled in production.</p><form method="post" action="/api/auth/preview"><button name="role" value="admin">Organizer preview</button><button name="role" value="voter">Voter preview</button></form></details>}</section></main>;
}
