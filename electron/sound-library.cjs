'use strict';
// Original FreeCut synthesis code: GPL-3.0-or-later. Generated sound files:
// CC0-1.0. No recordings, external samples, melodies or third-party sound packs.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const definitions=[
 ['click','轻快点击','交互提示',.12],['tap','柔和轻敲','交互提示',.22],['pop','气泡弹出','交互提示',.24],['snap','清脆拍点','交互提示',.14],
 ['confirm','完成提示','交互提示',.7],['notify','消息提醒','交互提示',.8],['warning','注意提示','交互提示',.65],['error','低落提示','交互提示',.6],
 ['swoosh','空气划过','转场',.7],['rise','电子上升','转场',1.1],['fall','电子下降','转场',.9],['impact','低频落点','转场',.5],
 ['sparkle','闪光点缀','氛围',1.2],['tick','短促节拍','交互提示',.09],['shutter','机械双击','交互提示',.25],['chime','柔和钟音','氛围',1.6],
];
const CATALOG=Object.freeze(definitions.map(([id,name,category,duration])=>Object.freeze({id,name,category,duration,license:'CC0-1.0'})));
const RATE=48000;
function generateSound(id){
 const definition=CATALOG.find(item=>item.id===id);if(!definition)throw Error('音效不在内置列表中。');
 const duration=definition.duration,count=Math.round(duration*RATE),samples=new Float32Array(count);
 let seed=0x2d38159;for(const char of id)seed=Math.imul(seed^char.charCodeAt(0),16777619);
 const noise=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
 const tone=(frequency,t)=>Math.sin(2*Math.PI*frequency*t),chirp=(a,b,t)=>Math.sin(2*Math.PI*(a*t+(b-a)*t*t/(2*duration)));
 const note=(frequency,t,start,decay=9)=>t<start?0:tone(frequency,t-start)*Math.min(1,(t-start)/.005)*Math.exp(-decay*(t-start));
 let filtered=0,lastNoise=0,peak=0;
 for(let i=0;i<count;i++){
  const t=i/RATE,n=noise();filtered=.8*filtered+.2*n;let sample=0;
  switch(id){
   case 'click':sample=(.55*n+.45*tone(1700,t))*Math.exp(-80*t);break;
   case 'tap':sample=(tone(430,t)+.2*tone(910,t))*Math.exp(-32*t);break;
   case 'pop':sample=chirp(650,80,t)*Math.exp(-16*t);break;
   case 'snap':sample=(n-lastNoise)*Math.exp(-60*t);break;
   case 'confirm':sample=note(660,t,0)+note(880,t,.15)+note(1320,t,.3);break;
   case 'notify':sample=(tone(880,t)+.22*tone(1760,t))*Math.exp(-6*t);break;
   case 'warning':sample=note(660,t,0)+note(440,t,.22);break;
   case 'error':sample=note(440,t,0)+note(330,t,.18);break;
   case 'swoosh':sample=(filtered+.08*chirp(700,1900,t))*Math.exp(-Math.pow((t-.34)/.16,2));break;
   case 'rise':sample=(.65*chirp(120,1500,t)+.35*filtered)*(t/duration);break;
   case 'fall':sample=(.7*chirp(1400,90,t)+.3*filtered)*(1-t/duration);break;
   case 'impact':sample=tone(72,t)*Math.exp(-15*t)+.3*n*Math.exp(-70*t);break;
   case 'sparkle':sample=note(1320,t,0,12)+note(1760,t,.16,12)+note(2200,t,.33,12)+note(2640,t,.5,10);break;
   case 'tick':sample=tone(2400,t)*Math.exp(-95*t);break;
   case 'shutter':sample=n*(Math.exp(-90*t)+(t>.09?Math.exp(-90*(t-.09)):0));break;
   case 'chime':sample=(tone(440,t)+.55*tone(660,t)+.3*tone(880,t))*Math.exp(-3.5*t);break;
  }
  lastNoise=n;sample*=Math.min(1,t/.002)*Math.min(1,(duration-t)/.02);samples[i]=sample;peak=Math.max(peak,Math.abs(sample));
 }
 const buffer=Buffer.alloc(44+count*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(RATE,24);buffer.writeUInt32LE(RATE*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(count*2,40);
 for(let i=0;i<count;i++)buffer.writeInt16LE(Math.round(samples[i]/Math.max(peak,.001)*.65*32767),44+i*2);
 return buffer;
}
function createSoundLibrary({userData,importPath}){
 const directory=path.join(userData,'sounds-v1'),pending=new Map();
 function create(id){
  if(typeof id!=='string'||!CATALOG.some(item=>item.id===id))return Promise.reject(Error('音效不在内置列表中。'));
  if(pending.has(id))return pending.get(id);
  const task=(async()=>{
   const bytes=generateSound(id),file=path.join(directory,`${id}.wav`);await fs.mkdir(directory,{recursive:true});
   const stat=await fs.lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw Error('音效缓存路径无效。');
   if(!stat||(stat.size!==bytes.length)||!bytes.equals(await fs.readFile(file))){
    const temporary=path.join(directory,`.${id}-${crypto.randomUUID()}.tmp`);
    try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}
   }
   return {...await importPath(file),name:CATALOG.find(item=>item.id===id).name};
  })().finally(()=>pending.delete(id));pending.set(id,task);return task;
 }
 return {list:()=>CATALOG.map(item=>({...item})),create};
}
function registerSoundLibrary({ipcMain,app,importPath,validateSender}){
 const library=createSoundLibrary({userData:app.getPath('userData'),importPath});
 for(const [name,fn]of [['list',()=>library.list()],['create',id=>library.create(id)]])ipcMain.handle(`freecut:sounds-${name}`,async(event,data)=>{if(typeof validateSender!=='function')throw Error('音效请求未配置权限校验。');validateSender(event);return fn(data);});
 return library;
}
module.exports={CATALOG,generateSound,createSoundLibrary,registerSoundLibrary};
