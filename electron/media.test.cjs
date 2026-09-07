'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {parseRange,parseProbe,createMediaLibrary,MEDIA_EXTENSIONS,assertTrustedSender,restoreMediaAsset}=require('./media.cjs');

test('IPC accepts only the trusted app main frame and denies injected frames or navigated documents',() => {
  const url='file:///app/dist/index.html', frame={url}, contents={mainFrame:frame};
  assert.equal(assertTrustedSender({sender:contents,senderFrame:frame},contents,url),true);
  assert.throws(() => assertTrustedSender({sender:{},senderFrame:frame},contents,url),/权限/);
  assert.throws(() => assertTrustedSender({sender:contents,senderFrame:{url}},contents,url),/权限/);
  frame.url='https://attacker.invalid';
  assert.throws(() => assertTrustedSender({sender:contents,senderFrame:frame},contents,url),/权限/);
  assert.throws(() => assertTrustedSender({},null,url),/权限/);
});

test('media byte ranges cover full, partial, suffix and invalid requests',() => {
  assert.equal(parseRange(null,100),null);
  assert.deepEqual(parseRange('bytes=10-29',100),{start:10,end:29});
  assert.deepEqual(parseRange('bytes=90-',100),{start:90,end:99});
  assert.deepEqual(parseRange('bytes=-12',100),{start:88,end:99});
  assert.deepEqual(parseRange('bytes=0-999',100),{start:0,end:99});
  for(const value of ['bytes=100-','bytes=30-20','bytes=-0','bytes=0-1,4-6','bytes=','bytes=a-2','bytes=9007199254740993-'])assert.equal(parseRange(value,100),false,value);
});
test('probe identifies video, audio, still image and rejects invalid media',() => {
  const info=parseProbe('Duration: 00:01:02.50, start: 0\n  Stream #0:0: Video: h264, yuv420p, 1920x1080 [SAR 1:1], 30 fps\n  Stream #0:1: Audio: aac, 48000 Hz',path.resolve('clip.mp4'));
  assert.deepEqual(info,{kind:'video',duration:62.5,width:1920,height:1080,hasAudio:true});
  assert.equal(parseProbe('Duration: 00:00:03.00\n Stream #0:0: Audio: mp3',path.resolve('audio.mp3')).kind,'audio');
  assert.equal(parseProbe('Stream #0:0: Video: png, rgba, 640x480',path.resolve('image.png')).kind,'image');
  assert.throws(() => parseProbe('Invalid data found',path.resolve('fake.mp4')),/无法读取/);
  assert.throws(() => parseProbe('Stream #0:0: Audio: aac',path.resolve('stream.aac')),/时长/);
});
test('album artwork is audio; a real video stream after the artwork still wins',() => {
  const cover=' Stream #0:1: Video: png, rgba, 320x320, 90k tbr (attached pic)';
  for (const extension of ['flac','mp3','m4a','ogg','opus','wma','mp4']) {
    const info=parseProbe(`Duration: 00:00:03.00\n Stream #0:0: Audio: flac, 44100 Hz, stereo\n${cover}`,path.resolve(`music.${extension}`));
    assert.equal(info.kind,'audio',extension);assert.equal(info.hasAudio,true);
    assert.equal(info.width,undefined);assert.equal(info.height,undefined);assert.equal(info.audioChannels,2);
  }
  const info=parseProbe(`Duration: 00:00:03.00\n${cover}\n Stream #0:2: Video: h264, yuv420p, 1920x1080, 30 fps\n Stream #0:0: Audio: aac`,path.resolve('movie.mp4'));
  assert.equal(info.kind,'video');assert.equal(info.width,1920);assert.equal(info.height,1080);
});
test('restoring old projects repairs artwork clips without moving or retiming audio',() => {
  const asset={id:'old',kind:'video',width:320,height:320,missing:true};
  const clip={assetId:'old',kind:'video',trackId:'muted-video',start:3,duration:8,inPoint:1,speed:1.25,keyframes:{volume:[{time:0,value:0.4}]}};
  const other={assetId:'other',kind:'video'}, project={clips:[clip,other]};
  const before=structuredClone(clip);
  restoreMediaAsset(project,asset,{id:'new',kind:'audio',duration:20,url:'freecut-media://asset/restored'});
  assert.deepEqual(clip,{...before,kind:'audio'});assert.equal(other.kind,'video');
  assert.equal(asset.id,'old');assert.equal(asset.kind,'audio');assert.equal(asset.missing,false);
  assert.equal('width' in asset,false);assert.equal('height' in asset,false);
});
const ffmpeg=process.env.FREECUT_TEST_FFMPEG||path.resolve('resources/ffmpeg',process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
test('real covered audio imports and decodes without treating album artwork as video',{skip:!require('node:fs').existsSync(ffmpeg),timeout:60000},async(t) => {
  const fs=require('node:fs/promises'),os=require('node:os');
  const run=require('node:util').promisify(require('node:child_process').execFile);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'freecut-artwork-'));
  try {
    const cover=path.join(directory,'cover.png');
    await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1','-y',cover],{windowsHide:true});
    const library=createMediaLibrary(ffmpeg);
    const {stdout:encoders}=await run(ffmpeg,['-hide_banner','-encoders'],{windowsHide:true});
    for (const [extension,codec] of [['flac','flac'],['mp3','libmp3lame'],['m4a','aac']]) {
      await t.test(extension,{skip:extension==='mp3'&&!/\blibmp3lame\b/.test(encoders)?'Bundled decoder supports MP3; optional libmp3lame fixture encoder is not included':false},async()=>{
      const file=path.join(directory,`covered.${extension}`);
      await run(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-i',cover,'-map','0:a','-map','1:v','-c:a',codec,'-c:v','copy','-disposition:v','attached_pic','-y',file],{windowsHide:true});
      const asset=await library.importPath(file);
      assert.equal(asset.kind,'audio',extension);assert.equal(asset.width,undefined);
      assert(asset.duration>=1 && asset.duration<1.2,extension);
      assert.equal(library.resolveAsset(asset).hasAudio,true);
      const response=await library.handleRequest(new Request(asset.url,{method:'HEAD'}));
      assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^audio\//);
      const {stdout}=await run(ffmpeg,['-hide_banner','-loglevel','error','-i',file,'-map','0:a:0','-t','0.1','-c:a','pcm_s16le','-f','s16le','pipe:1'],{windowsHide:true,encoding:'buffer'});
      assert(stdout.length>0);assert(stdout.some(value=>value!==0),`${extension} decodes non-silent audio`);
      });
    }
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
test('media protocol cannot read arbitrary local files, unsupported schemes or unknown tokens',async() => {
  const media=createMediaLibrary(path.resolve('not-a-real-ffmpeg'));
  assert.throws(() => media.validateMediaPath(path.resolve('secret.txt')),/尚未通过导入授权/);
  assert.throws(() => media.resolveAsset({path:path.resolve('secret.mp4')}),/尚未授权/);
  assert.equal(MEDIA_EXTENSIONS.has('.svg'),false);
  assert.equal(MEDIA_EXTENSIONS.has('.m3u8'),false);
  for(const url of ['freecut-media://asset/../../secret.txt','freecut-media://other/00000000-0000-0000-0000-000000000000','freecut-media://asset/00000000-0000-0000-0000-000000000000']) {
    const response=await media.handleRequest(new Request(url)); assert.equal(response.status,404);
  }
  assert.equal((await media.handleRequest(new Request('freecut-media://asset/abc',{method:'POST'}))).status,405);
  await assert.rejects(media.importPath('relative.mp4'),/路径无效/);
});
