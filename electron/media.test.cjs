'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {parseRange,parseProbe,createMediaLibrary,MEDIA_EXTENSIONS,assertTrustedSender}=require('./media.cjs');

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
