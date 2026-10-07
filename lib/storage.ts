import {createClient} from '@supabase/supabase-js';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {isLocalPreview} from './runtime';
const directory=()=>path.join(process.env.CONTEST_LOCAL_DATA_DIR||path.join(process.cwd(),'.local-contest'),'photos');
function valid(id:string){if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('Invalid photo key');return id}
function cloud(){if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Photo storage is not configured');return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}}).storage.from('costume-photos')}
export function bucket(){return {
 async put(id:string,bytes:Uint8Array,options:{httpMetadata:{contentType:string}}){valid(id);if(isLocalPreview()){await mkdir(directory(),{recursive:true});await writeFile(path.join(directory(),id),bytes);await writeFile(path.join(directory(),id+'.json'),JSON.stringify(options.httpMetadata));return}const {error}=await cloud().upload(id,bytes,{contentType:options.httpMetadata.contentType,upsert:false});if(error)throw error},
 async get(id:string){valid(id);let bytes:Uint8Array;let contentType:string;if(isLocalPreview()){try{bytes=new Uint8Array(await readFile(path.join(directory(),id)));contentType=JSON.parse(await readFile(path.join(directory(),id+'.json'),'utf8')).contentType}catch(e:any){if(e.code==='ENOENT')return null;throw e}}else{const {data,error}=await cloud().download(id);if(error){if(String((error as any).statusCode)==='404')return null;throw error}bytes=new Uint8Array(await data.arrayBuffer());contentType=data.type}return {body:bytes as Uint8Array<ArrayBuffer>,httpMetadata:{contentType},arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer}},
 async head(id:string){valid(id);if(isLocalPreview()){try{await readFile(path.join(directory(),id+'.json'));return {key:id}}catch(e:any){if(e.code==='ENOENT')return null;throw e}}const {data,error}=await cloud().list('',{search:id,limit:100});if(error)throw error;return data.find(item=>item.name===id)??null},
 async delete(id:string){valid(id);if(isLocalPreview()){for(const file of [id,id+'.json'])await unlink(path.join(directory(),file)).catch((e:any)=>{if(e.code!=='ENOENT')throw e});return}const {error}=await cloud().remove([id]);if(error)throw error}
}}
