import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export function database(): D1Database {const db=(env as any).DB;if(!db)throw new Error('Contest storage is unavailable. Please try again shortly.');return db;}
export function bucket(): R2Bucket {return (env as any).BUCKET;}
export async function isAdmin(){if((env as any).LOCAL_ADMIN==='true')return true;const user=await getChatGPTUser();const allowed=String((env as any).ADMIN_EMAILS||'').toLowerCase().split(',').map(x=>x.trim());return !!user && allowed.includes(user.email.toLowerCase());}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value.trim())))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export function randomIndex(length:number){const limit=Math.floor(4294967296/length)*length;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0]}while(n>=limit);return n%length;}
export async function standings(){const db=database();return (await db.prepare('SELECT e.*, COUNT(v.id) AS votes FROM entries e LEFT JOIN votes v ON v.entry=e.id WHERE e.published=1 GROUP BY e.id ORDER BY votes DESC,e.name ASC').all()).results;}
