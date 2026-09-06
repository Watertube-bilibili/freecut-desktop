'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createMediaLibrary}=require('./media.cjs');
const {validateProject,validateOptions,volumeExpression,atempoChain,planAudio,validFrame,createExporter}=require('./export.cjs');
function fixture() {
  return {version:1,id:'project',name:'测试',width:1920,height:1080,fps:30,background:'#000000',assets:[{id:'a',name:'a.mp4',kind:'video',path:path.resolve('a.mp4'),url:'',duration:10}],tracks:[{id:'v',name:'画面',kind:'video',muted:false,hidden:true,locked:false}],clips:[{id:'c',name:'clip',kind:'video',assetId:'a',trackId:'v',start:2,duration:3,inPoint:1,speed:2,transform:{x:0,y:0,scale:1,rotation:0,opacity:1,volume:0.7},keyframes:{},effects:{},fadeIn:0.2,fadeOut:0.3}]};
}
function options(project=fixture()) { return {project,width:32,height:32,fps:1,duration:1,quality:'medium',format:'mp4'}; }
function pngHeader(w=32,h=32) { const bytes=Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.write('IHDR',12); bytes.writeUInt32BE(w,16); bytes.writeUInt32BE(h,20); return bytes; }

test('project/export validation rejects NaN, injection text, unsupported formats and dangling track references',() => {
  assert.equal(validateProject(fixture()).id,'project');
  const bad=fixture(); bad.clips[0].speed=NaN; assert.throws(() => validateProject(bad),/变速/);
  bad.clips[0].speed='1;movie=secret'; assert.throws(() => validateProject(bad),/变速/);
  bad.clips[0].speed=1; bad.clips[0].trackId='missing'; assert.throws(() => validateProject(bad),/片段/);
  assert.throws(() => validateOptions({...options(),width:1921}),/偶数/);
  assert.throws(() => validateOptions({...options(),format:'shell'}),/格式/);
  assert.throws(() => validateOptions({...options(),fps:Infinity}),/帧率/);
});
test('hidden video remains audible; mute, silent assets and out-of-range clips are excluded',() => {
  const project=fixture();
  const plan=planAudio(project,8,(asset) => ({path:asset.path,hasAudio:true}));
  assert.equal(plan.inputs.length,1);
  assert.match(plan.filterGraph,/atrim=start=1:end=7/);
  assert.match(plan.filterGraph,/atempo=2/);
  assert.match(plan.filterGraph,/volume='0.7'/);
  assert.match(plan.filterGraph,/afade=t=in:st=0:d=0.2/);
  assert.match(plan.filterGraph,/afade=t=out:st=2.7:d=0.3/);
  assert.match(plan.filterGraph,/adelay=96000S:all=1/);
  project.tracks[0].muted=true; assert.equal(planAudio(project,8,() => {throw new Error('must not resolve muted media');}).inputs.length,0);
  project.tracks[0].muted=false; assert.equal(planAudio(project,8,() => ({hasAudio:false})).inputs.length,0);
  assert.equal(planAudio(project,1,() => {throw new Error('must not resolve later clip');}).inputs.length,0);
});
test('mix planning trims at output end and rejects forged unauthorized asset paths',() => {
  const project=fixture(); const result=planAudio(project,3,(asset) => ({path:asset.path,hasAudio:true}));
  assert.match(result.filterGraph,/atrim=start=1:end=3/);
  assert.match(result.filterGraph,/atrim=duration=1/);
  assert.match(result.filterGraph,/normalize=0/);
  assert.throws(() => planAudio(project,8,() => {throw new Error('Unauthorized');}),/Unauthorized/);
});
test('volume keyframe expressions deduplicate points, use outgoing easing and preserve final values',() => {
  assert.equal(volumeExpression([],0.25),'0.25');
  const expression=volumeExpression([{time:0,value:0,easing:'ease-in-out'},{time:2,value:1,easing:'linear'},{time:2,value:0.8,easing:'hold'}],1);
  assert.match(expression,/0.8/); assert.match(expression,/pow\(/); assert.doesNotMatch(expression,/\/0\)/);
  assert.match(volumeExpression([{time:0,value:0.5,easing:'hold'},{time:1,value:1,easing:'linear'}],1),/\*0\)/);
  assert.deepEqual(atempoChain(8),['atempo=2','atempo=2','atempo=2']);
  assert.deepEqual(atempoChain(0.125),['atempo=0.5','atempo=0.5','atempo=0.5']);
});
test('frame validation prevents wrong-size files and arbitrary byte payloads',() => {
  assert.equal(validFrame(pngHeader(),32,32),true);
  assert.equal(validFrame(pngHeader(64),32,32),false);
  assert.equal(validFrame(Buffer.from('not png'),32,32),false);
});
test('export failure/cancel preserves existing output and removes job temporary files',async() => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-test-'));
  try {
    const destination=path.join(directory,'existing.mp4'); await fs.writeFile(destination,'original video');
    const exporter=createExporter({ffmpegPath:path.join(directory,'missing-ffmpeg'),temporaryRoot:directory,resolveAsset:() => null,emitProgress:() => {}});
    const first=await exporter.begin(options(),destination);
    await assert.rejects(exporter.writeFrame({jobId:first.jobId,index:1,bytes:pngHeader()}),/不连续/);
    await assert.rejects(exporter.finish(first.jobId),/帧不完整/);
    await exporter.writeFrame({jobId:first.jobId,index:0,bytes:pngHeader()});
    await assert.rejects(exporter.finish(first.jobId),/编码器|编码失败/);
    assert.equal(await fs.readFile(destination,'utf8'),'original video');
    const second=await exporter.begin(options(),destination);
    await exporter.cancel(second.jobId);
    assert.equal(await fs.readFile(destination,'utf8'),'original video');
    assert.deepEqual(await fs.readdir(directory),['existing.mp4']);
    await assert.rejects(exporter.writeFrame({jobId:second.jobId,index:0,bytes:pngHeader()}),/不存在/);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

let integrationFFmpeg=process.env.FREECUT_TEST_FFMPEG;
if(!integrationFFmpeg)try { integrationFFmpeg=require('ffmpeg-static'); } catch {}
test('real FFmpeg parses 1000 volume keyframes and samples every easing, binary split and held endpoints',{skip:!integrationFFmpeg,timeout:60000},async() => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-volume-test-'));
  const run=promisify(execFile);
  try {
    const easings=['linear','ease-in','ease-out','ease-in-out','hold'];
    const frames=Array.from({length:1000},(_,index) => ({time:Number((0.125+index*0.002).toFixed(3)),value:index%2?0.8:0.2,easing:easings[index%5]}));
    const expression=volumeExpression(frames,1),filterFile=path.join(directory,'volume-filters.txt');
    // A constant, lossless signal and 0.5 ms audio frames make the expected gain
    // directly observable, without AAC quantization or a duplicated evaluator.
    await fs.writeFile(filterFile,`[0:a]asetnsamples=n=24:p=0,volume='${expression}':eval=frame[test]`);
    const args=option => ['-hide_banner','-nostdin','-f','lavfi','-i','aevalsrc=0.25:s=48000:d=2.25',option,filterFile,'-map','[test]','-f','f32le','pipe:1'];
    const execOptions={windowsHide:true,maxBuffer:8*1024*1024,encoding:'buffer'};
    let output;
    try { output=await run(integrationFFmpeg,args('-filter_complex_script'),execOptions); }
    catch(error) {
      if(!String(error.stderr).includes("Unrecognized option 'filter_complex_script'"))throw error;
      output=await run(integrationFFmpeg,args('-/filter_complex'),execOptions);
    }
    assert.equal(output.stdout.length,Math.round(2.25*48000)*4);
    const checkpoints=[
      [0.05,0.05,'before first keyframe'],
      [0.126,0.125,'linear midpoint'],
      [0.128,0.1625,'ease-in midpoint'],
      [0.130,0.1625,'ease-out midpoint'],
      [0.1315,0.18125,'ease-in-out first quarter'],
      [0.1325,0.06875,'ease-in-out last quarter'],
      [0.134,0.05,'hold interval'],
      // Binary-exact times avoid comparing opposite sides of a discontinuity
      // because decimal keyframe times and rational audio PTS round differently.
      [0.375,0.2,'exact keyframe boundary'],
      [1.124,0.2,'left of central binary split'],
      [1.125,0.05,'central binary split boundary'],
      [2.2,0.2,'after final keyframe'],
    ];
    for(const [time,expected,label] of checkpoints){
      const actual=output.stdout.readFloatLE(Math.round(time*48000)*4);
      assert.ok(Math.abs(actual-expected)<0.0001,`${label}: expected ${expected}, got ${actual}`);
    }
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});

test('real FFmpeg export renders H264/AAC with trimmed, delayed and faded audio and authorized range streaming',{skip:!integrationFFmpeg,timeout:60000},async() => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-render-test-'));
  const run=promisify(execFile);
  const command=(args,extra={}) => run(integrationFFmpeg,['-hide_banner','-nostdin','-y',...args],{windowsHide:true,maxBuffer:8*1024*1024,...extra});
  try {
    const audioPath=path.join(directory,'中文 音频.wav'),framePath=path.join(directory,'frame.png'),destination=path.join(directory,'成片 output.mp4');
    await command(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:a','pcm_s16le',audioPath]);
    await command(['-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1',framePath]);
    const library=createMediaLibrary(integrationFFmpeg),asset=await library.importPath(audioPath);
    const response=await library.handleRequest(new Request(asset.url,{headers:{Range:'bytes=0-15'}}));
    assert.equal(response.status,206); assert.equal(response.headers.get('content-length'),'16'); assert.equal((await response.arrayBuffer()).byteLength,16);
    const project=fixture(); project.assets=[asset]; project.clips[0]={...project.clips[0],kind:'audio',assetId:asset.id,start:0.2,duration:0.6,inPoint:0.3,speed:2,fadeIn:0.05,fadeOut:0.05,keyframes:{volume:[{id:'v0',time:0,value:0.3,easing:'ease-in-out'},{id:'v1',time:0.6,value:0.7,easing:'linear'}]}};
    const exporter=createExporter({ffmpegPath:integrationFFmpeg,temporaryRoot:directory,resolveAsset:library.resolveAsset,emitProgress:() => {}});
    const job=await exporter.begin({...options(project),fps:10},destination),bytes=await fs.readFile(framePath);
    for(let index=0;index<10;index++)await exporter.writeFrame({jobId:job.jobId,index,bytes});
    const result=await exporter.finish(job.jobId); assert.equal(result.path,destination);
    const inspected=await library.importPath(destination); assert.equal(inspected.kind,'video'); assert.ok(Math.abs(inspected.duration-1)<0.06);
    const {stdout}=await command(['-i',destination,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer'});
    function rms(begin,end) { const start=Math.floor(begin*48000),stop=Math.min(Math.floor(end*48000),stdout.length/4); let sum=0; for(let i=start;i<stop;i++)sum+=stdout.readFloatLE(i*4)**2; return Math.sqrt(sum/(stop-start)); }
    assert.ok(rms(0.02,0.14)<0.001,'silence before clip starts');
    assert.ok(rms(0.35,0.6)>0.01,'audible trimmed and speed-adjusted clip');
    assert.ok(rms(0.86,0.98)<0.001,'silence after clip ends');
    assert.equal((await fs.readdir(directory)).some((name) => name.startsWith('freecut-export-')),false);
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
