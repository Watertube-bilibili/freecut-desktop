const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const project=path.resolve(__dirname,'..'),repo=path.resolve(project,'../..');
if(!process.versions.electron){const child=spawn(require(path.join(repo,'node_modules/electron')),[__filename,...process.argv.slice(2)],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exitCode=code);}
else main().catch(e=>{console.error(e);process.exitCode=1;});
async function main(){
 const dataDir=process.env.FREECUT_AI_QA_CACHE;
 if(!dataDir)throw Error('Set FREECUT_AI_QA_CACHE to an existing verified userData model cache; no download is performed.');
 const {createAIService}=require(path.join(repo,'electron/ai.cjs'));
 const finalVideo=path.join(project,'renders/shuiguan-launch-1080p.mp4');
 const final=process.argv.includes('--final');
 const service=createAIService({app:{getPath:()=>dataDir},ffmpegPath:process.env.FFMPEG_PATH||'ffmpeg',validateMediaPath:p=>{if(!p.startsWith(path.join(project,'assets/voice')+path.sep)&&p!==finalVideo)throw Error('Outside narration');return p;},importPath:async()=>{throw Error('Read only QA');}});
 const frames=JSON.parse(fs.readFileSync(path.join(project,'frames.json'),'utf8')),results=[];
 let time=0;
 for(const f of frames){const result=await service.transcribe({modelId:'asr-sensevoice',path:final?finalVideo:path.join(project,'assets/voice',f.id+'.wav'),inPoint:final?time:0,duration:f.duration,language:'zh'},()=>{});time+=f.duration;const item={frame:f.id,expected:f.phrases.join(''),heard:result.items.map(x=>x.text).join('')};results.push(item);console.log(JSON.stringify(item));}
 fs.writeFileSync(path.join(project,'renders',final?'final-audio-asr-qa.json':'narration-asr-qa.json'),JSON.stringify({engine:'Existing local SenseVoice ASR, not a human listening assessment',finalMixedAudio:final,results},null,2));
}
