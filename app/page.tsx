import {redirect} from 'next/navigation';
import Contest from './contest';
import {getMember} from '@/lib/auth';
export const dynamic='force-dynamic';
export default async function Page(){if(!await getMember())redirect('/sign-in');return <Contest/>}
