import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{fileURLToPath}from'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=[];
function visit(dir){for(const f of fs.readdirSync(path.join(project,dir),{withFileTypes:true})){const rel=path.posix.join(dir,f.name);if(f.isDirectory()){if(f.name!=='raw-voice')visit(rel);}else if(rel!=='assets/manifest.json'){result.push({path:rel,bytes:fs.statSync(path.join(project,rel)).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(project,rel))).digest('hex')});}}}
visit('assets');
for(const file of ['shuiguan-launch-1080p.mp4','shuiguan-launch-cover.png','shuiguan-launch.zh-CN.srt']){const rel='renders/'+file;if(fs.existsSync(path.join(project,rel)))result.push({path:rel,bytes:fs.statSync(path.join(project,rel)).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(project,rel))).digest('hex')});}
fs.writeFileSync(path.join(project,'renders/SHA256SUMS.txt'),result.map(x=>`${x.sha256}  ${x.path}`).join('\n')+'\n');
fs.writeFileSync(path.join(project,'assets/manifest.json'),JSON.stringify({files:result.filter(x=>x.path.startsWith('assets/'))},null,2)+'\n');
