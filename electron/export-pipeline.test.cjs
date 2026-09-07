'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const cp=require('node:child_process'),{promisify}=require('node:util');
const children=[],originalSpawn=cp.spawn;
cp.spawn=(...args)=>{const child=originalSpawn(...args);children.push(child);return child;};
const {createExporter}=require('./export.cjs');cp.spawn=originalSpawn;
const {createMediaLibrary}=require('./media.cjs');
const ffmpeg=process.env.FREECUT_TEST_FFMPEG||path.resolve('resources/ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const enabled=require('node:fs').existsSync(ffmpeg),run=promisify(cp.execFile);
const command=(args,extra={})=>run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{windowsHide:true,maxBuffer:16*1024*1024,...extra});
function clip(id,kind,assetId,partial={}) {return {id,name:id,kind,assetId,trackId:kind==='audio'?'a':'v',start:0,duration:1,inPoint:0,speed:1,fadeIn:0,fadeOut:0,transform:{x:0,y:0,scale:1,rotation:0,opacity:1,volume:1},keyframes:{},effects:{},...partial};}
function options(assets=[],clips=[],partial={}) {return {width:32,height:32,fps:10,duration:1,quality:'medium',format:'mp4',pipeline:'auto',frameFormat:'rgba',project:{version:1,id:'p',name:'pipeline regression',width:32,height:32,fps:10,background:'#000000',assets,clips,tracks:[{id:'v',name:'video',kind:'video',hidden:false,muted:false},{id:'a',name:'audio',kind:'audio',hidden:false,muted:false}]},...partial};}
async function decoded(file) {const {stdout}=await command(['-i',file,'-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{encoding:'buffer'});assert.equal(stdout.length%(32*32*3),0);return stdout;}
function color(bytes,index,expected) {const offset=(index*32*32+16*32+16)*3;for(let channel=0;channel<3;channel++)assert(Math.abs(bytes[offset+channel]-expected[channel])<15,`frame ${index}: ${bytes.subarray(offset,offset+3)} expected ${expected}`);}
async function clean(directory) {assert.equal((await fs.readdir(directory)).some(file=>file.startsWith('freecut-export-')||file.startsWith('.freecut-')),false);assert(children.every(child=>child.exitCode!==null||child.signalCode!==null),'no encoder child remains alive');}
async function fixture(runTest) {const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-pipeline-'));try{await runTest(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('native pipeline finishes without IPC frames and keeps video/image/audio input indexes separate',{skip:!enabled,timeout:60000},()=>fixture(async directory=>{
  const video=path.join(directory,'red.mp4'),image=path.join(directory,'blue.png'),audio=path.join(directory,'voice.wav'),output=path.join(directory,'result.mp4');
  await command(['-f','lavfi','-i','color=c=red:s=32x32:r=10:d=1','-c:v','libx264',video]);
  await command(['-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1',image]);
  await command(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-c:a','pcm_s16le',audio]);
  const media=createMediaLibrary(ffmpeg),assets=await Promise.all([video,image,audio].map(file=>media.importPath(file)));
  const clips=[clip('video','video',assets[0].id,{duration:.5}),clip('image','image',assets[1].id,{start:.5,duration:.5}),clip('sound','audio',assets[2].id)];
  const exporter=createExporter({ffmpegPath:ffmpeg,temporaryRoot:directory,resolveAsset:media.resolveAsset,emitProgress:()=>{}});
  const job=await exporter.begin(options(assets,clips),output);assert.equal(job.pipeline,'native');
  await exporter.finish(job.jobId);const pixels=await decoded(output);assert.equal(pixels.length,10*32*32*3);color(pixels,2,[255,0,0]);color(pixels,7,[0,0,255]);
  const {stdout}=await command(['-i',output,'-map','0:a:0','-ac','1','-f','f32le','pipe:1'],{encoding:'buffer'});
  let energy=0;for(let index=0;index<stdout.length;index+=4)energy+=stdout.readFloatLE(index)**2;
  assert(Math.sqrt(energy/(stdout.length/4))>.03,'distinct third audio input is audible');await clean(directory);
}));
test('RGBA frames stream into the encoder with no temporary frame files and correct frame colors/count',{skip:!enabled,timeout:60000},()=>fixture(async directory=>{
  const exporter=createExporter({ffmpegPath:ffmpeg,temporaryRoot:directory,resolveAsset:()=>null,emitProgress:()=>{}}),output=path.join(directory,'stream.mp4');
  const job=await exporter.begin(options([],[],{pipeline:'frames'}),output);assert.equal(job.pipeline,'frames');
  for(let index=0;index<10;index++){
    const bytes=Buffer.alloc(32*32*4);for(let pixel=0;pixel<bytes.length;pixel+=4){bytes[pixel+(index<5?0:2)]=255;bytes[pixel+3]=255;}
    await exporter.writeFrame({jobId:job.jobId,index,bytes});
    const names=await fs.readdir(directory,{recursive:true});assert.equal(names.some(name=>/\.(png|rgba)$/i.test(name)),false);
    assert(children.some(child=>child.exitCode===null&&child.signalCode===null),'encoder starts during frame writes');
  }
  await exporter.finish(job.jobId);const pixels=await decoded(output);assert.equal(pixels.length,10*32*32*3);color(pixels,2,[255,0,0]);color(pixels,7,[0,0,255]);await clean(directory);
}));
test('cancel, rejected frames and encoder failure preserve an existing destination and clean owned resources',{skip:!enabled,timeout:60000},()=>fixture(async directory=>{
  const output=path.join(directory,'existing.mp4'),original=Buffer.from('keep existing user file');await fs.writeFile(output,original);
  const exporter=createExporter({ffmpegPath:ffmpeg,temporaryRoot:directory,resolveAsset:()=>null,emitProgress:()=>{}});
  let job=await exporter.begin(options([],[],{pipeline:'frames'}),output);
  await exporter.writeFrame({jobId:job.jobId,index:0,bytes:Buffer.alloc(32*32*4,255)});
  await exporter.cancel(job.jobId);assert.deepEqual(await fs.readFile(output),original);await clean(directory);
  job=await exporter.begin(options([],[],{pipeline:'frames'}),output);
  await assert.rejects(exporter.writeFrame({jobId:job.jobId,index:0,bytes:Buffer.alloc(4)}),/尺寸或格式/);
  await exporter.cancel(job.jobId);assert.deepEqual(await fs.readFile(output),original);await clean(directory);
  // Valid PNG envelope with invalid compressed data passes IPC shape validation;
  // the actual encoder must fail safely instead of replacing the destination.
  job=await exporter.begin(options([],[],{pipeline:'frames',frameFormat:'png',duration:.1}),output);
  const broken=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(broken);broken.write('IHDR',12);broken.writeUInt32BE(32,16);broken.writeUInt32BE(32,20);
  let rejected=false;try{await exporter.writeFrame({jobId:job.jobId,index:0,bytes:broken});await exporter.finish(job.jobId);}catch(error){rejected=true;assert.match(error.message,/失败|尺寸|格式/);}
  assert(rejected,'real decoder rejects invalid PNG payload');await exporter.cancel(job.jobId);assert.deepEqual(await fs.readFile(output),original);await clean(directory);
}));
