'use strict';
// Real ChatTTS inference. No downloads unless --download is explicitly present.
// node scripts/smoke-chattts.cjs --data-dir PATH [--asr-data-dir PATH]
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/smoke-chattts.cjs --data-dir DIR [--download] [--text TEXT] [--seed NUMBER] [--speed 1..9] [--asr-data-dir DIR]\nDefaults to offline mode. --download explicitly prepares Python, dependencies and models.\nOptional ASR uses an already installed SenseVoice model; it never downloads one.\nWAV checks alone do not verify naturalness or correct spoken content.');
} else if (!process.versions.electron) {
  const child = spawn(require('electron'),[__filename,...process.argv.slice(2)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',windowsHide:true,shell:false});
  child.on('error',error => {console.error(error);process.exitCode=1;});
  child.on('close',code => {process.exitCode=code === 0 ? 0 : 1;});
} else {
  main().catch(error => {console.error(error);process.exitCode=1;});
}

function inspectWave(bytes) {
  assert.equal(bytes.toString('ascii',0,4),'RIFF'); assert.equal(bytes.toString('ascii',8,12),'WAVE');
  let format, samples;
  for (let offset=12; offset+8<=bytes.length;) {
    const name=bytes.toString('ascii',offset,offset+4), size=bytes.readUInt32LE(offset+4), start=offset+8;
    assert(start+size<=bytes.length,'Truncated WAV chunk');
    if (name==='fmt ') {assert(size>=16);format={codec:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),sampleRate:bytes.readUInt32LE(start+4),bits:bytes.readUInt16LE(start+14)};}
    if (name==='data') samples=bytes.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  assert(format && samples && samples.length>=4800,'Missing or empty WAV audio');
  assert.deepEqual(format,{codec:1,channels:1,sampleRate:24000,bits:16}); assert.equal(samples.length%2,0);
  let peak=0,sum=0,clippedSamples=0;
  for (let offset=0;offset<samples.length;offset+=2) {const value=samples.readInt16LE(offset)/32768;peak=Math.max(peak,Math.abs(value));sum+=value*value;if(Math.abs(value)>.999)clippedSamples++;}
  const count=samples.length/2,rms=Math.sqrt(sum/count);
  assert(peak>.00001 && rms>.00001,'Generated WAV is silent');
  return {...format,samples:count,duration:count/format.sampleRate,peak,rms,clippedSamples};
}

async function main() {
  const args=process.argv.slice(2);
  const value=name => {const index=args.indexOf(name);return index<0 ? undefined : args[index+1];};
  const allowDownload=args.includes('--download');
  const userData=path.resolve(value('--data-dir') || path.join(os.tmpdir(),'freecut-chattts-smoke'));
  const text=value('--text') || '你好，这是自由剪辑的真实语音测试。';
  const seed=Number(value('--seed') ?? 42),speed=Number(value('--speed') ?? 5);
  const ffmpeg=path.resolve(__dirname,'../resources/ffmpeg',process.platform==='win32' ? 'ffmpeg.exe' : 'ffmpeg');
  await fs.access(ffmpeg).catch(() => {throw Error('内置 FFmpeg 尚未准备好，请先执行 npm run prepare:ffmpeg。');});
  const {createMediaLibrary}=require('../electron/media.cjs');
  const {createChatTTS,VERSION,REVISION}=require('../electron/chattts.cjs');
  const media=createMediaLibrary(ffmpeg);
  let previous='',asrService;
  const engine=createChatTTS({userData,importPath:media.importPath,emitProgress:state => {const key=`${state.phase}:${Math.floor(state.progress*10)}`;if(key!==previous){previous=key;console.log(JSON.stringify(state));}}});
  process.once('SIGINT',() => void engine.cancel());
  try {
    if (allowDownload) await engine.install();
    const status=await engine.status();
    if (!status.ready) throw Error('指定目录没有已验证的 ChatTTS 安装。默认模式禁止下载；请用 --data-dir 指向已有缓存，或显式传入 --download 准备模型。');
    const started=Date.now();
    const asset=await engine.generate({text,seed,speed});
    assert.equal(asset.kind,'audio');assert(asset.duration>0 && asset.path && asset.url.startsWith('freecut-media://'));
    const bytes=await fs.readFile(asset.path),wave=inspectWave(bytes);
    assert(Math.abs(asset.duration-wave.duration)<.03,'FFmpeg duration differs from PCM duration');
    const report={testedAt:new Date().toISOString(),platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,version:VERSION,modelRevision:REVISION,networkAllowed:allowDownload,text,seed,speed,asset,wave,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),inferenceAndImportMs:Date.now()-started,speechContentVerified:false,contentVerification:'WAV 技术检查不代表自然度或朗读内容正确；请试听，或使用可选的已缓存 ASR。'};
    const asrData=value('--asr-data-dir');
    if (asrData) {
      const {createAIService}=require('../electron/ai.cjs');
      const canonical=await fs.realpath(asset.path);
      asrService=createAIService({app:{getPath:()=>path.resolve(asrData)},ffmpegPath:ffmpeg,validateMediaPath:async file => {const resolved=await fs.realpath(file);assert.equal(resolved,canonical,'Unauthorized ASR path');return resolved;},importPath:media.importPath});
      const transcription=await asrService.transcribe({modelId:'asr-sensevoice',path:asset.path,inPoint:0,duration:asset.duration,language:/[\u3400-\u9fff]/.test(text) ? 'zh' : 'en'},()=>{});
      const normalize=content => content.toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
      report.transcription=transcription;
      report.speechContentVerified=normalize(transcription.items.map(item=>item.text).join(''))===normalize(text);
      report.contentVerification=report.speechContentVerified ? '已缓存 SenseVoice 转写与输入匹配（忽略标点与空白）；不等同于主观自然度评价。' : 'ASR 转写未与输入匹配，请试听检查；不能据此宣称朗读内容验证通过。';
    }
    const reportFile=path.join(userData,'chattts-smoke-result.json');
    await fs.writeFile(reportFile,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if (asrData) assert(report.speechContentVerified,'ASR did not match the requested speech; review the saved report and audio');
    console.log(`PASS: actual ChatTTS inference + FFmpeg import + PCM WAV checks${asrData ? ' + optional ASR content match' : ' (spoken content still requires listening)'}\nReport: ${reportFile}`);
  } finally {await engine.dispose();if(asrService)await asrService.cancel();}
}
