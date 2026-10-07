// Local-only fixture setup. Never connects to hosted Supabase or Netlify.
import {samples} from '../lib/shared.ts';
const root='http://localhost:5173';
for(const entry of samples){const response=await fetch(root+'/api/contest',{method:'POST',headers:{Origin:root,Cookie:'contest-local-preview=admin','Content-Type':'application/json'},body:JSON.stringify({action:'save',entry:{...entry,published:true}})});if(!response.ok)throw Error(await response.text());}
console.log(`Published ${samples.length} fictional sample contestants to the local preview.`);
