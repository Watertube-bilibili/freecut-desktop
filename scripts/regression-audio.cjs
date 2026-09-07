'use strict';
// Actual Web Audio rendering and bundled FFmpeg mixing must agree per channel.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {promisify}=require('node:util'),{execFile}=require('node:child_process'),{_electron}=require('playwright'),{build}=require('esbuild');
const {planAudio}=require('../electron/export.cjs'),{createMediaLibrary}=require('../electron/media.cjs');
const root=path.resolve(__dirname,'..'),run=promisify(execFile);
main().catch(error=>{console.error(error);process.exitCode=1;});
function wave(channels){const count=4800,buffer=Buffer.alloc(44+count*channels*2);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(channels,22);buffer.writeUInt32LE(48000,24);buffer.writeUInt32LE(48000*channels*2,28);buffer.writeUInt16LE(channels*2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(count*channels*2,40);for(let i=0;i<count;i++)for(let c=0;c<channels;c++)buffer.writeInt16LE(c===0?8192:-16384,44+(i*channels+c)*2);return buffer;}
async function main(){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-audio-regression-')),report={directory,passed:false,cases:[]};let app;
 try{
  const entry=path.join(directory,'entry.ts');await fs.writeFile(entry,`export {createAudioRouting} from ${JSON.stringify(path.join(root,'src/core/audio-routing.ts'))};`);await build({entryPoints:[entry],outfile:path.join(directory,'audio.js'),bundle:true,format:'iife',globalName:'AudioTest',platform:'browser'});
  await fs.writeFile(path.join(directory,'index.html'),'<script src="audio.js"></script>');const bootstrap=path.join(directory,'app.cjs');await fs.writeFile(bootstrap,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});app.whenReady().then(()=>{new BrowserWindow({show:false}).loadFile(${JSON.stringify(path.join(directory,'index.html'))});});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.PORTABLE_EXECUTABLE_DIR;app=await _electron.launch({args:[bootstrap],env,cwd:root});const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.AudioTest));
  const defaults={pan:0,leftGain:1,rightGain:1,channelMode:'stereo'};
  const cases=[['stereo',{},[.25,-.5]],['left',{channelMode:'left'},[.25,.25]],['right',{channelMode:'right'},[-.5,-.5]],['mono',{channelMode:'mono'},[-.125,-.125]],['swap',{channelMode:'swap'},[-.5,.25]],['balance-right',{pan:1},[0,-.5]],['balance-left',{pan:-1},[.25,0]],['independent',{leftGain:.5,rightGain:1.5},[.125,-.75]]];
  const ffmpeg=path.join(root,'resources/ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg'),media=createMediaLibrary(ffmpeg);
  for(const channels of [1,2]){
   const file=path.join(directory,`source-${channels}.wav`);await fs.writeFile(file,wave(channels));const asset=await media.importPath(file);
   assert.equal(media.resolveAsset(asset).audioChannels,channels);
   for(const [name,patch,golden]of cases){const audio={...defaults,...patch};
    const preview=await page.evaluate(async({channels,audio})=>{const context=new OfflineAudioContext(2,4800,48000),buffer=context.createBuffer(channels,4800,48000);for(let c=0;c<channels;c++)buffer.getChannelData(c).fill(c===0?.25:-.5);const source=context.createBufferSource();source.buffer=buffer;const routing=window.AudioTest.createAudioRouting(context,source);routing.set(audio,1);routing.output.connect(context.destination);source.start();const result=await context.startRendering();return [result.getChannelData(0)[1000],result.getChannelData(1)[1000]];},{channels,audio});
    const project={tracks:[{id:'a',muted:false}],assets:[asset],clips:[{id:'c',assetId:asset.id,trackId:'a',kind:'audio',start:0,duration:.1,inPoint:0,speed:1,fadeIn:0,fadeOut:0,transform:{volume:1},keyframes:{},audio}]};
    const plan=planAudio(project,.1,media.resolveAsset),{stdout}=await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-i',file,'-filter_complex',plan.filterGraph,'-map','[mix]','-t','0.1','-c:a','pcm_f32le','-f','f32le','pipe:1'],{windowsHide:true,encoding:'buffer'});
    const encoded=[stdout.readFloatLE(1000*8),stdout.readFloatLE(1000*8+4)];
    // FFmpeg's tempo filter can quantize an s16 input by one PCM step even at 1x.
    for(let c=0;c<2;c++){assert(Math.abs(preview[c]-encoded[c])<1e-4,`${name} ${channels}ch preview/export mismatch: ${preview} / ${encoded}`);if(channels===2)assert(Math.abs(preview[c]-golden[c])<1e-6,`${name} expected ${golden}, got ${preview}`);}
    if(channels===1&&['stereo','left','right','mono','swap'].includes(name))assert.deepEqual(preview,[.25,.25]);
    report.cases.push({channels,name,preview,export:encoded});console.log(`PASS ${channels}ch ${name}: ${encoded}`);
   }
  }report.passed=true;
 }finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});const file=path.join(directory,'audio-regression-result.json');await fs.writeFile(file,JSON.stringify(report,null,2));console.log(`REPORT: ${file}`);}
}
