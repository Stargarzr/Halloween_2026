import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
// Optional display key for the projected photo wall, so a TV browser or an Orator web slide needs no work-email sign-in. Unset or shorter than 32 characters disables it.
// It travels in the URL (/wall?key=…) because an embedding iframe gets no third-party cookies. The key grants the wall page and published photos only: never the roster, ballots, results, or any write.
function configured(){const key=process.env.WALL_TOKEN?.trim();return key&&key.length>=32?key:null}
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validWallKey(key:unknown){const want=configured();return !!want&&typeof key==='string'&&same(digest(key.trim()),digest(want))}
// The wall page links each photo as /api/image/<id>?sig=<HMAC of the id>, so the key itself never appears in image URLs. Changing or removing WALL_TOKEN revokes both.
export function photoSignature(id:string){const key=configured();return key?createHmac('sha256',key).update(`wall:${id}`).digest('hex'):null}
export function validPhotoSignature(id:string,sig:string|null){const want=photoSignature(id);return !!want&&!!sig&&same(sig,want)}
