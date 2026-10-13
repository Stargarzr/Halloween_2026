import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
// lib/storage.ts imports './runtime' without an extension (Next resolves it); strip-types mode needs the .ts spelled out, so retry extensionless relative specifiers with .ts.
registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&/^\.\.?\//.test(specifier)&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw e}}});
const {bucket}=await import('../lib/storage.ts');
const id='0b6f3c1e-2a4d-4f8e-9c7b-1d2e3f4a5b6c';
for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','R2_ACCOUNT_ID','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'])delete process.env[key];
process.env.NODE_ENV='test';
const requests=[];let reply=()=>new Response(null,{status:204});
// The module sends fetch(url, {method, headers, body}) with raw bytes (a streamed Request body makes Node send chunked, which R2 rejects with 411), so the stub normalizes both call shapes.
globalThis.fetch=async(input,init)=>{const request=new Request(input,init);requests.push({method:request.method,url:request.url,headers:Object.fromEntries(request.headers),body:new Uint8Array(await request.arrayBuffer())});return reply(request)};
const last=()=>requests[requests.length-1];
// Nothing configured, or only part of the R2 set: the Supabase branch stays selected and reports the missing configuration without touching the network.
await assert.rejects(bucket().head(id),/Photo storage is not configured/);
Object.assign(process.env,{R2_ACCOUNT_ID:'acct',R2_BUCKET:'photos',R2_ACCESS_KEY_ID:'AKIATEST'});
await assert.rejects(bucket().head(id),/Photo storage is not configured/);assert.equal(requests.length,0);
process.env.R2_SECRET_ACCESS_KEY='secret';
const url=`https://acct.r2.cloudflarestorage.com/photos/${id}`;
reply=()=>new Response(null,{status:200});
await bucket().put(id,new Uint8Array([1,2,3]),{httpMetadata:{contentType:'image/png'}});
assert.equal(last().method,'PUT');assert.equal(last().url,url);assert.equal(last().headers['content-type'],'image/png');assert.equal(last().headers['if-none-match'],'*');assert.match(last().headers.authorization,/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request/);assert.deepEqual([...last().body],[1,2,3]);
reply=()=>new Response('<Error>PreconditionFailed</Error>',{status:412});
await assert.rejects(bucket().put(id,new Uint8Array([1]),{httpMetadata:{contentType:'image/png'}}),/R2 object already exists/);
reply=()=>new Response(new Uint8Array([9,8,7]),{status:200,headers:{'content-type':'image/jpeg'}});
const file=await bucket().get(id);assert.equal(last().method,'GET');assert.equal(last().url,url);assert.deepEqual([...file.body],[9,8,7]);assert.equal(file.httpMetadata.contentType,'image/jpeg');assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[9,8,7]);
reply=()=>new Response(new Uint8Array([1]),{status:200});
assert.equal((await bucket().get(id)).httpMetadata.contentType,'application/octet-stream');
reply=()=>new Response('<Error>NoSuchKey</Error>',{status:404});
assert.equal(await bucket().get(id),null);assert.equal(await bucket().head(id),null);assert.equal(last().method,'HEAD');
reply=()=>new Response(null,{status:200});
assert.deepEqual(await bucket().head(id),{key:id});
reply=()=>new Response(null,{status:204});
await bucket().delete(id);assert.equal(last().method,'DELETE');assert.equal(last().url,url);
reply=()=>new Response('<Error>AccessDenied: '+'x'.repeat(300)+'</Error>',{status:403});
await assert.rejects(bucket().delete(id),e=>{assert.match(e.message,/^R2 DELETE failed: 403 /);assert.ok(e.message.length<260);return true});
const count=requests.length;
for(const key of ['../etc/passwd','not-a-uuid',id+'x',''])for(const op of ['put','get','head','delete'])await assert.rejects(op==='put'?bucket().put(key,new Uint8Array(),{httpMetadata:{contentType:'image/png'}}):bucket()[op](key),/Invalid photo key/);
assert.equal(requests.length,count);
// list() pages ListObjectsV2 and parses keys with their upload times; a continuation token is followed and XML entities are decoded.
let page=0;reply=()=>{page++;return new Response(page===1?'<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>tok&amp;1</NextContinuationToken><Contents><Key>11111111-1111-4111-8111-111111111111</Key><LastModified>2026-10-13T10:00:00.000Z</LastModified></Contents></ListBucketResult>':'<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>22222222-2222-4222-8222-222222222222</Key><LastModified>2026-10-13T11:00:00.000Z</LastModified></Contents></ListBucketResult>',{status:200,headers:{'content-type':'application/xml'}})};
const listed=await bucket().list();assert.equal(page,2);assert.equal(requests[requests.length-2].method,'GET');assert.match(requests[requests.length-2].url,/^https:\/\/acct\.r2\.cloudflarestorage\.com\/photos\/\?list-type=2&max-keys=1000$/);assert.match(last().url,/continuation-token=tok%261/);
assert.deepEqual(listed.map(o=>[o.key,o.uploaded.toISOString()]),[['11111111-1111-4111-8111-111111111111','2026-10-13T10:00:00.000Z'],['22222222-2222-4222-8222-222222222222','2026-10-13T11:00:00.000Z']]);
console.log('PASS: R2 branch, paged list selected only with all four variables, signed PUT with content type and no-overwrite guard, GET bytes and content type, 404 as null, DELETE, truncated error bodies, invalid keys rejected before any request.');
