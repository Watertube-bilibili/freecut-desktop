'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createMediaLibrary, parseProbe } = require('./media.cjs');
const { createMediaCache, MAX_BINS, MAX_THUMBNAILS } = require('./media-cache.cjs');
const run = promisify(execFile);
const ffmpeg = path.resolve(__dirname, '../resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function finish(cache) {
  for (let tries = 0; tries < 600; tries++) {
    const state = await cache.status();
    if (!state.jobs.some(job => ['queued', 'running'].includes(job.state))) { await wait(50); return cache.status(); }
    await wait(30);
  }
  throw Error('Cache job timed out');
}
async function fixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'freecut-cache-test-'));
  const media = createMediaLibrary(ffmpeg), output = path.join(directory, 'original.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', output], { windowsHide: true });
  const asset = await media.importPath(output), userData = path.join(directory, 'profile');
  const options = { userData, ffmpegPath: ffmpeg, resolveAsset: media.resolveAsset, importPath: media.importPath };
  const cache = createMediaCache(options);
  t.after(async () => { cache.dispose(); await wait(100); assert(path.resolve(directory).startsWith(temporaryRoot + path.sep)); await fs.rm(directory, { recursive: true, force: true }); });
  await cache.status();
  return { directory, asset, cache, options, media };
}
test('actual FFmpeg proxy preserves duration, omits audio and bounds thumbnail/waveform artifacts', async t => {
  const { asset, cache, directory } = await fixture(t);
  let maxRunning = 0;
  cache.onProgress(state => { maxRunning = Math.max(maxRunning, state.jobs.filter(job => job.state === 'running').length); });
  await Promise.all(['proxy', 'waveform', 'thumbnails'].map(type => cache.request({ asset, type, height: 540 })));
  const state = await finish(cache);
  assert.equal(maxRunning, 1); assert(state.jobs.every(job => job.state === 'complete'), JSON.stringify(state.jobs));
  const entry = state.entries[0];
  assert(entry.proxy); assert(entry.waveform.bins.length <= MAX_BINS); assert(entry.waveform.bins.some(value => value > 0));
  assert(entry.thumbnails.length > 0 && entry.thumbnails.length <= MAX_THUMBNAILS);
  assert(state.usedBytes > 0);
  const proxyPath = path.join(state.directory, entry.sourceKey, 'proxy-540.mp4');
  const probe = await run(ffmpeg, ['-hide_banner', '-i', proxyPath], { windowsHide: true }).catch(error => error);
  const info = parseProbe(probe.stderr, proxyPath);
  assert.equal(info.hasAudio, false); assert.equal(info.kind, 'video');
  assert.equal(info.width / info.height, asset.width / asset.height); assert(info.height <= 540);
  assert(Math.abs(info.duration - asset.duration) < .1);
  const raw = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', proxyPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 ** 2 });
  assert.equal(raw.stdout.length, info.width * info.height * 3); assert(raw.stdout.some(byte => byte > 64));
  assert(!JSON.stringify(asset).includes('proxy-')); // Project assets stay unchanged.
  const restart = createMediaCache({ ...(await fixtureOptions(cache, directory)), resolveAsset: () => ({ path: asset.path, kind: 'video', hasAudio: true }), importPath: async file => ({ url: `file:${file}`, width:640, height:360, duration:2 }) });
  try { const restored = await restart.request({ asset, type:'waveform' }); assert(restored.entries[0].proxy); assert.equal(restored.jobs.length, 0); } finally { restart.dispose(); }
});
async function fixtureOptions(cache, directory) { await cache.status(); return { userData: path.join(directory, 'profile'), ffmpegPath: ffmpeg }; }
test('unauthorized media, malformed requests and cache-derived originals are rejected', async t => {
  const { asset, cache, directory, media } = await fixture(t);
  const unauthorized = path.join(directory, 'not-imported.mp4'); await fs.copyFile(asset.path, unauthorized);
  await assert.rejects(cache.request({ asset: { ...asset, path: unauthorized }, type: 'proxy' }), /授权/);
  await assert.rejects(cache.request({ asset, type: 'proxy', height: 1080 }), /无效/);
  await assert.rejects(cache.request({ asset, type: 'delete' }), /无效/);
  await cache.request({ asset, type:'proxy' }); const state = await finish(cache);
  const cached = await media.importPath(path.join(state.directory, state.entries[0].sourceKey, 'proxy-540.mp4'));
  await assert.rejects(cache.request({ asset: cached, type:'proxy' }), /原始素材/);
});
test('cancellation protects running work and clear deletes only owned generated files', async t => {
  const { asset, cache, directory } = await fixture(t);
  const requested = await cache.request({ asset, type:'proxy' });
  await assert.rejects(cache.clear(), /取消/);
  await assert.rejects(cache.setDirectory(directory), /取消/);
  await cache.cancel(requested.jobs[0].id); const cancelled = await finish(cache);
  assert.equal(cancelled.jobs[0].state, 'cancelled');
  await cache.request({ asset, type:'waveform' }); const complete = await finish(cache);
  assert(complete.entries[0].waveform);
  const marker = path.join(complete.directory, 'keep-user-file.txt'); await fs.writeFile(marker, 'keep');
  const nested = path.join(complete.directory, complete.entries[0].sourceKey, 'keep-user-file.txt'); await fs.writeFile(nested, 'keep');
  await cache.clear();
  assert.equal(await fs.readFile(marker, 'utf8'), 'keep'); assert.equal(await fs.readFile(nested, 'utf8'), 'keep');
  assert((await fs.stat(asset.path)).size > 0); assert.equal((await cache.status()).entries.length, 0);
});
test('source stat replacement invalidates runtime entry; chosen cache parent survives restart', async t => {
  const { asset, cache, options, directory } = await fixture(t);
  await cache.request({ asset, type:'waveform' }); const first = await finish(cache);
  const stat = await fs.stat(asset.path); await fs.utimes(asset.path, stat.atime, new Date(stat.mtimeMs + 2000));
  assert.equal((await cache.status()).entries.length, 0);
  await cache.request({ asset, type:'waveform' }); const second = await finish(cache);
  assert.notEqual(first.entries[0].sourceKey, second.entries[0].sourceKey);
  const parent = path.join(directory, 'chosen'); await fs.mkdir(parent);
  const moved = await cache.setDirectory(parent);
  assert.equal(moved.directory, path.join(parent, 'FreeCut-MediaCache'));
  const restarted = createMediaCache(options);
  try { assert.equal((await restarted.status()).directory, moved.directory); } finally { restarted.dispose(); }
  assert((await fs.stat(path.join(first.directory, first.entries[0].sourceKey))).isDirectory());
});
test('long audio waveform stays bounded without retaining decoded PCM', async t => {
  const { cache, directory, media } = await fixture(t), audio = path.join(directory, 'long.wav');
  await run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=300:duration=90','-ar','8000',audio], { windowsHide:true });
  await cache.request({ asset: await media.importPath(audio), type:'waveform' });
  const state = await finish(cache); assert.equal(state.entries[0].waveform.bins.length, MAX_BINS);
  const saved = await fs.stat(path.join(state.directory, state.entries[0].sourceKey, 'waveform.json')); assert(saved.size < 65536);
});

test('closing a window cancels queued work while reopening can generate new cache', async t => {
  const { cache, asset } = await fixture(t);
  await cache.request({ asset, type: 'proxy' });
  await cache.request({ asset, type: 'waveform' });
  cache.cancelAll();
  await finish(cache);
  assert((await cache.status()).jobs.every(job => !['queued', 'running'].includes(job.state)));
  await cache.request({ asset, type: 'thumbnails' });
  const resumed = await finish(cache);
  assert(resumed.entries[0].thumbnails.length > 0);
  assert.equal(resumed.jobs.at(-1).state, 'complete');
});
