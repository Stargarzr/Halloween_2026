import {getMember} from '@/lib/auth';
export {database} from './database';
export {bucket} from './storage';
import {database} from './database';
export async function isAdmin(){return (await getMember())?.admin === true;}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.trim())))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function randomIndex(length:number){const limit=Math.floor(4294967296/length)*length;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);return n%length;}
export async function standings(){const db=database();return (await db.prepare('SELECT e.*, CAST(COUNT(v.id) AS INTEGER) AS votes FROM entries e LEFT JOIN votes v ON v.entry=e.id AND v.category=e.category WHERE e.published=1 GROUP BY e.id ORDER BY votes DESC,e.name ASC').all()).results;}
