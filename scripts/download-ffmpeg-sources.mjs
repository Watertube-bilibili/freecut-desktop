import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'resources','ffmpeg-source','archives');
const sources=[
  {name:'FFmpeg',version:'9.0.1',file:'ffmpeg-9.0.1.tar.xz',url:'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',sha256:'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',size:12036420,license:'GPL-3.0-or-later for the configured combined executable'},
  {name:'x264',revision:'b35605ace3ddf7c1a5d67a2eb553f034aef41d55',file:'x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz',url:'https://codeload.github.com/mirror/x264/tar.gz/b35605ace3ddf7c1a5d67a2eb553f034aef41d55',upstream:'https://code.videolan.org/videolan/x264.git',refVerification:'The fixed revision was independently resolved from the official VideoLAN stable ref on 2026-09-06. The archive is the same Git revision from its GitHub mirror.',sha256:'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',size:1040327,license:'GPL-2.0-or-later'},
  {name:'zlib',version:'1.3.1',file:'zlib-1.3.1.tar.gz',url:'https://zlib.net/fossils/zlib-1.3.1.tar.gz',sha256:'9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23',size:1512791,license:'Zlib'},
];
await fs.mkdir(directory,{recursive:true});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const source of sources){
  const destination=path.join(directory,source.file);
  const cached=await fs.readFile(destination).catch(()=>null);
  if(cached&&cached.length===source.size&&hash(cached)===source.sha256){console.log(`Verified cached ${source.name}`);continue;}
  let failure;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await fetch(source.url,{signal:AbortSignal.timeout(180000)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length!==source.size||hash(bytes)!==source.sha256)throw Error('source size/SHA-256 mismatch');
      const partial=destination+'.part';await fs.writeFile(partial,bytes);await fs.rename(partial,destination);failure=null;break;
    }catch(error){failure=error;console.warn(`${source.name}: attempt ${attempt} failed: ${error.message}`);}
  }
  if(failure)throw failure;
  console.log(`Downloaded and verified ${source.name}`);
}
await fs.writeFile(path.join(directory,'sources.lock.json'),JSON.stringify({schema:1,sourceDateEpoch:1786492800,patches:[],sources},null,2));
console.log(`Pinned sources ready: ${directory}`);
