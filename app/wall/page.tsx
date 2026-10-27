import {redirect} from 'next/navigation';
import {getMember} from '@/lib/auth';
import {database} from '@/lib/server';
import {validWallKey,photoSignature} from '@/lib/wall';
export const dynamic='force-dynamic';
export const metadata={title:'Photo wall · Boo Ballot'};
type Tile={id:string;name:string;costume:string;tagline:string;image:string};
// Each tile is a square photo over a name strip, about 1:1.15. Pick the column count that gives the largest tile on a 16:9 screen below the header, so every published contestant fits without scrolling.
const TILE=1.15,SCREEN_W=16,SCREEN_H=8.1;
function columnsFor(n:number){let best=1,size=0;for(let c=1;c<=n;c++){const s=Math.min(SCREEN_W/c,SCREEN_H/(Math.ceil(n/c)*TILE));if(s>size){size=s;best=c}}return best}
// Read-only display for projecting during the event: published contestants only, the same set every voter sees. Reload the page to pick up roster changes.
// Open to any signed-in member, or with ?key=WALL_TOKEN (TV browser, Orator web slide); keyed views load each photo by its signature instead of a session.
export default async function Wall({searchParams}:{searchParams:Promise<{key?:string}>}){
 const member=await getMember(),keyed=!member&&validWallKey((await searchParams).key);
 if(!member&&!keyed)redirect('/sign-in');
 const src=(image:string)=>keyed?`/api/image/${image}?sig=${photoSignature(image)}`:`/api/image/${image}`;
 const tiles=(await database().prepare('SELECT id,name,costume,tagline,image FROM entries WHERE published=1 ORDER BY name').all()).results as Tile[];
 const cols=columnsFor(tiles.length),rows=Math.ceil(tiles.length/cols);
 return <main className="wall">
  <header className="wall-header"><span>The AI Uprising.</span><small>When AI Haunts Halloween · {tiles.length} {tiles.length===1?'contestant':'contestants'}</small></header>
  {tiles.length?<div className="wall-grid" style={{'--cols':cols,'--rows':rows} as React.CSSProperties}><div className="wall-tiles">
   {tiles.map(t=><figure key={t.id} className="wall-card">
    <div className="wall-photo">{t.image.startsWith('sample:')?<div role="img" aria-label={`${t.name} as ${t.costume} (illustrative sample)`} className="sample-photo" style={{backgroundPosition:`${Number(t.image.split(':')[1])%3*50}% ${Math.floor(Number(t.image.split(':')[1])/3)*100}%`}}/>:<img src={src(t.image)} alt={`${t.name} as ${t.costume}`}/>}{t.tagline&&<p className="wall-tagline">“{t.tagline}”</p>}</div>
    <figcaption><strong>{t.name}</strong><span>{t.costume}</span></figcaption>
   </figure>)}
  </div></div>:<p className="wall-empty">No contestants have been published yet.</p>}
 </main>;
}
