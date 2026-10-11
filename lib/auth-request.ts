import {database} from './database';
import {rateLimit} from './rate-limit';

export function sameOrigin(req:Request){
 const origin=req.headers.get('origin');if(!origin)return false;
 try{const source=new URL(origin),target=new URL(req.url);return ['http:','https:'].includes(source.protocol)&&source.protocol===target.protocol&&source.host===(req.headers.get('host')||target.host)}catch{return false}
}
export const authJson=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function authRateLimit(key:string,max:number,windowSeconds:number){
 return rateLimit((sql,params)=>database().prepare(sql).bind(...params).execute(),key,max,windowSeconds);
}
