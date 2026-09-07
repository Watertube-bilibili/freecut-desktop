import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frames=JSON.parse(fs.readFileSync(path.join(project,'frames.json'),'utf8'));
const run=(bin,args)=>{const r=spawnSync(bin,args,{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.error||bin);return r.stdout;};
const duration=p=>Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',p]).trim());
const escapeCaption=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const voices=[];const captions=[];let timeline=0;
for(const [i,f] of frames.entries()){
  const inputs=f.phrases.map((_,j)=>path.join(project,'assets/raw-voice',`${f.id}-${j}.wav`));
  const lengths=inputs.map(duration),tempo=1.32;
  const first=lengths[0]/tempo,second=lengths[1]/tempo;
  const lead=.22,gap=.24;
  if(lead+first+gap+second>f.duration-.12)throw Error(`Scene ${f.id} narration overflows`);
  const out=path.join(project,'assets/voice',`${f.id}.wav`);
  run('ffmpeg',['-y','-hide_banner','-loglevel','error',...inputs.flatMap(p=>['-i',p]),'-filter_complex',`[0:a]atempo=${tempo},aresample=48000,adelay=${lead*1000}:all=1,apad=pad_dur=${gap}[a];[1:a]atempo=${tempo},aresample=48000[b];[a][b]concat=n=2:v=0:a=1,apad,atrim=duration=${f.duration},alimiter=limit=0.9:level=false[out]`,'-map','[out]','-c:a','pcm_s16le',out]);
  const words=[{text:f.phrases[0].replace('GPT 六','GPT-6'),start:lead,end:lead+first},{text:f.phrases[1].replace('GPT 六','GPT-6'),start:lead+first+gap,end:lead+first+gap+second}];
  voices.push({frame:i+1,path:`assets/voice/${f.id}.wav`,duration_s:duration(out),provider:'windows-sapi',voice:'Microsoft Huihui Desktop',tempo,words});
  for(const w of words)captions.push({text:w.text.replace('GPT 六','GPT-6'),start:timeline+w.start,end:timeline+w.end});
  timeline+=f.duration;
}
// Original deterministic 110 BPM electronic score: A minor, F, C, G. No samples.
const sr=48000,n=Math.round(timeline*sr),data=new Float32Array(n*2),beat=60/110;
const chords=[[45,52,57,60],[41,48,53,57],[48,55,60,64],[43,50,55,59]];
const hz=m=>440*2**((m-69)/12);let seed=0x5f1439;
const noise=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
for(let i=0;i<n;i++){
 const t=i/sr,b=Math.floor(t/beat),phase=t%beat,bar=Math.floor(b/4),ch=chords[bar%4];
 const half=t%(beat/2),step=Math.floor(t/(beat/2)),note=ch[[0,2,1,3,2,1,3,2][step%8]]+12;
 const pluck=(Math.sin(2*Math.PI*hz(note)*t)+.2*Math.sin(4*Math.PI*hz(note)*t))*Math.exp(-half*11)*.09;
 const kick=Math.sin(2*Math.PI*(52*phase+25*(1-Math.exp(-phase*25))))*Math.exp(-phase*22)*.20;
 const hat=noise()*Math.exp(-half*90)*.016;
 const bass=Math.sin(2*Math.PI*hz(ch[0]-12)*t)*.1*(1-Math.exp(-phase*40));
 const clap=b%4===1||b%4===3?noise()*Math.exp(-phase*35)*.032:0;
 const fade=Math.min(1,t/.3,Math.max(0,(timeline-t)/1.8));
 const value=(pluck+kick+hat+bass+clap)*fade;
 data[i*2]=value;data[i*2+1]=value*.9+Math.sin(2*Math.PI*hz(note)*t+.2)*Math.exp(-half*11)*.012*fade;
}
const wav=Buffer.alloc(44+n*4);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(sr,24);wav.writeUInt32LE(sr*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*4,40);for(let i=0;i<data.length;i++)wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,data[i]))*32767),44+i*2);
fs.writeFileSync(path.join(project,'assets/music/mint-launch-original.wav'),wav);
fs.writeFileSync(path.join(project,'audio_meta.json'),JSON.stringify({bgm:{path:'assets/music/mint-launch-original.wav',volume:.22},voices,sfx:[]},null,2)+'\n');
const stamp=s=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
fs.writeFileSync(path.join(project,'renders/shuiguan-launch.zh-CN.srt'),captions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
fs.writeFileSync(path.join(project,'captions-timing.json'),JSON.stringify(captions,null,2)+'\n');
console.log(JSON.stringify({duration:timeline,voices:voices.map(v=>({frame:v.frame,duration:v.duration_s,phrases:v.words}))},null,2));
