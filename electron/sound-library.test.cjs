'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {CATALOG,generateSound,createSoundLibrary,registerSoundLibrary}=require('./sound-library.cjs');
const {createMediaLibrary}=require('./media.cjs');
async function folder(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-sounds-'));t.after(async()=>{assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true,force:true});});return directory;}
test('all sixteen original sounds are deterministic valid PCM with distinct non-silent bounded samples',()=>{
 assert.equal(CATALOG.length,16);const hashes=new Set();
 for(const sound of CATALOG){const bytes=generateSound(sound.id);assert.equal(sound.license,'CC0-1.0');assert.deepEqual(bytes,generateSound(sound.id));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,16),'WAVEfmt ');assert.equal(bytes.readUInt32LE(24),48000);assert.equal(bytes.readUInt16LE(22),1);assert.equal(bytes.length,44+Math.round(sound.duration*48000)*2);let peak=0,sum=0;for(let i=44;i<bytes.length;i+=2){const value=bytes.readInt16LE(i);peak=Math.max(peak,Math.abs(value));sum+=value*value;}assert(peak<=21300&&peak>20000);assert(sum>100000);assert.equal(bytes.readInt16LE(44),0);hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));}
 assert.equal(hashes.size,16);
});
test('sound creation authorizes IDs only, coalesces requests and restores a changed generated cache',async t=>{
 const directory=await folder(t);let imports=0;const library=createSoundLibrary({userData:directory,importPath:async file=>{imports++;return {path:file};}});
 await assert.rejects(library.create('../escape'),/内置列表/);assert.deepEqual(await fs.readdir(directory),[]);
 const [a,b]=await Promise.all([library.create('click'),library.create('click')]);assert.equal(a.path,b.path);assert.equal(imports,1);
 const original=generateSound('click');await fs.writeFile(a.path,Buffer.alloc(original.length));await library.create('click');assert.deepEqual(await fs.readFile(a.path),original);assert.deepEqual(await fs.readdir(path.join(directory,'sounds-v1')),['click.wav']);
});
test('sound IPC validates the app sender before reading IDs or generating files',async t=>{
 const directory=await folder(t),handlers=new Map();registerSoundLibrary({ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},app:{getPath:()=>directory},validateSender:()=>{throw Error('untrusted');}});
 for(const handler of handlers.values())await assert.rejects(handler({},'click'),/untrusted/);assert.deepEqual(await fs.readdir(directory),[]);
});
test('real bundled FFmpeg imports every generated sound as mono audio of the advertised duration',async t=>{
 const directory=await folder(t),ffmpeg=path.join(__dirname,'../resources/ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
 if(!await fs.stat(ffmpeg).catch(()=>null)){t.skip('Prepared FFmpeg is unavailable');return;}
 const media=createMediaLibrary(ffmpeg),library=createSoundLibrary({userData:directory,importPath:media.importPath});
 for(const sound of CATALOG){const asset=await library.create(sound.id);assert.equal(asset.kind,'audio');assert.equal(asset.name,sound.name);assert(Math.abs(asset.duration-sound.duration)<.011);assert.equal(media.resolveAsset(asset).audioChannels,1);assert.match(asset.url,/^freecut-media:\/\/asset\//);}
});
