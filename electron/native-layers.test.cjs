'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createExporter, validateOptions } = require('./export.cjs');
const { planNativeVideo, inspectNativeVideo } = require('./native-export.cjs');
const { layerPlacement } = require('./concat-placement.cjs');
const { isRasterPng, LIMITS } = require('./native-export-raster.cjs');
const { createMediaLibrary, INPUT_SECURITY } = require('./media.cjs');
const { bezierYAtX } = require('../shared/concat-bezier.mjs');
const ffmpeg = process.env.FREECUT_TEST_FFMPEG || path.resolve('resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const enabled = require('node:fs').existsSync(ffmpeg), run = promisify(execFile);
const command = (args, extra = {}) => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...extra });
const transform = partial => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, ...partial });
const clip = (id, asset, partial = {}) => ({ id, name: id, kind: asset?.kind || 'text', assetId: asset?.id, trackId: 'top', start: 0, duration: 1, inPoint: 0, speed: 1, fadeIn: 0, fadeOut: 0, effects: {}, keyframes: {}, transform: transform(), ...partial });
function options(assets = [], clips = [], partial = {}) {
  return { width: 64, height: 64, fps: 10, duration: 1, quality: 'high', format: 'mp4', pipeline: 'auto',
    project: { version: 1, id: 'p', name: 'layer regression', width: 64, height: 64, fps: 10, background: '#000000', assets, clips,
      tracks: [{ id: 'top', kind: 'overlay', hidden: false, muted: false }, { id: 'bottom', kind: 'video', hidden: false, muted: false }] }, ...partial };
}
async function fixture(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-native-layers-'));
  try { await fn(directory); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function still(directory, name, color, dimensions = '64x64') {
  const file = path.join(directory, name + '.png');
  await command(['-f', 'lavfi', '-i', `color=c=${color}:s=${dimensions},format=rgba`, '-frames:v', '1', file]);
  return file;
}
async function pixels(plan, fps) {
  const args = plan.inputs.flatMap(input => [...INPUT_SECURITY, ...(input.kind === 'image' ? ['-loop', '1', '-framerate', String(fps)] : input.seek ? ['-ss', String(input.seek)] : []), '-i', input.path]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-native-graph-'));
  try {
    const file = path.join(directory, 'graph.txt'); await fs.writeFile(file, plan.filterGraph);
    const version = (await command(['-version'])).stdout.match(/ffmpeg version\s+(?:n)?(\d+)/);
    return (await command([...args, '-filter_complex_threads', '2', version && Number(version[1]) >= 9 ? '-/filter_complex' : '-filter_complex_script', file, '-map', '[nativevideo]', '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' })).stdout;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
function color(data, frame, x, y, expected, width = 64, height = 64, tolerance = 6) {
  const offset = (frame * width * height + y * width + x) * 3;
  const actual = [...data.subarray(offset, offset + 3)];
  actual.forEach((value, i) => assert(Math.abs(value - expected[i]) <= tolerance, `frame ${frame} (${x},${y}) ${actual} expected ${expected}`));
}

test('ported Concat placement centres, translates and bounds quarter-turns without an extra float pixel', () => {
  const value = layerPlacement(64, 64, 64, 32, transform({ x: 16, y: -8, scale: .5, rotation: 90 }), 1);
  assert.deepEqual([value.scaledWidth, value.scaledHeight, value.rotatedWidth, value.rotatedHeight, value.x, value.y], [32, 16, 16, 32, 40, 8]);
});

test('unsupported masks, transform animation and overlapping fades explicitly select the exact fallback', () => {
  const image = { id: 'a', kind: 'image', path: path.resolve('x.png'), width: 64, height: 64 };
  const resolve = asset => asset;
  for (const [partial, reason] of [
    [{ effects: { mask: 'heart' } }, 'effect'],
    [{ keyframes: { scale: [{ time: 0, value: 1, easing: 'linear' }] } }, 'animated-transform'],
    [{ fadeIn: .8, fadeOut: .8 }, 'overlapping-fades'],
    [{ start: .01 }, 'fractional-cut'],
  ]) assert.equal(inspectNativeVideo(options([image], [clip('c', image, partial)]), resolve).reason, reason);
});

test('real layered output preserves stack order, static rotation/scale/translation/alpha and non-overlapping visual fades', { skip: !enabled, timeout: 60000 }, () => fixture(async directory => {
  const media = createMediaLibrary(ffmpeg);
  const [red, blue] = await Promise.all([still(directory, 'red', 'red'), still(directory, 'blue-wide', 'blue', '64x32')].map(async promise => media.importPath(await promise)));
  const p = options([red, blue], [clip('top', blue, { transform: transform({ scale: .5, rotation: 90, x: 16, opacity: .5 }) }), clip('base', red, { trackId: 'bottom' })]);
  const data = await pixels(planNativeVideo(p, media.resolveAsset), p.fps);
  assert.equal(data.length, 10 * 64 * 64 * 3);
  color(data, 4, 48, 32, [128, 0, 128]);
  color(data, 4, 32, 32, [255, 0, 0]);
  color(data, 4, 48, 10, [255, 0, 0]);
  color(data, 4, 48, 45, [128, 0, 128]);
  // Track order is authoritative, even if the array lists foreground first.
  p.project.clips[0] = clip('fading', blue, { fadeIn: .4, fadeOut: .4, transform: transform({ opacity: .5 }) });
  const faded = await pixels(planNativeVideo(p, media.resolveAsset), p.fps);
  for (const [frame, rgb] of [[0, [255, 0, 0]], [2, [191, 0, 64]], [4, [128, 0, 128]], [8, [191, 0, 64]]]) color(faded, frame, 32, 32, rgb);
}));

test('real x/y motion matches all original easing modes and Concat Bezier at two output aspect ratios', { skip: !enabled, timeout: 60000 }, () => fixture(async directory => {
  const media = createMediaLibrary(ffmpeg), green = await media.importPath(await still(directory, 'green', 'lime'));
  const easings = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'bezier'];
  const eased = (name, x) => name === 'hold' ? 0 : name === 'ease-in' ? x*x : name === 'ease-out' ? 1-(1-x)*(1-x) : name === 'ease-in-out' ? (x < .5 ? 2*x*x : 1-(-2*x+2)**2/2) : name === 'bezier' ? bezierYAtX(.42, 0, .58, 1, x) : x;
  for (const easing of easings) {
    const keys = [{ time: 0, value: -16, easing, ...(easing === 'bezier' ? { curve: [.42, 0, .58, 1] } : {}) }, { time: .8, value: 16, easing: 'linear' }];
    const width = 64, height = easing === 'bezier' ? 96 : 64;
    const value = options([green], [clip('moving', green, { transform: transform({ scale: .25 }), keyframes: { x: keys, y: keys } })], { width, height });
    const data = await pixels(planNativeVideo(value, media.resolveAsset), value.fps);
    assert.equal(data.length, 10 * width * height * 3);
    for (const frame of [0, 2, 4, 6, 8, 9]) {
      let sx = 0, sy = 0, count = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (frame*width*height+y*width+x)*3;
        if (data[offset+1] > 220 && data[offset] < 20 && data[offset+2] < 20) { sx += x+.5; sy += y+.5; count++; }
      }
      assert(count > 100, `${easing} frame ${frame} vanished`);
      const offset = frame >= 8 ? 16 : -16 + 32 * eased(easing, frame / 8);
      assert(Math.abs(sx/count - (width/2+offset)) < 1.2, `${easing} x frame ${frame}: ${sx/count}`);
      assert(Math.abs(sy/count - (height/2+offset*height/64)) < 1.2, `${easing} y frame ${frame}: ${sy/count}`);
    }
  }
}));

test('raster payload rejects forged references, duplicates, wrong dimensions, animation, trailing bytes and quotas', { skip: !enabled }, () => fixture(async directory => {
  const bytes = await fs.readFile(await still(directory, 'raster', 'blue'));
  const value = options([], [clip('text')]);
  const good = { clipId: 'text', bytes };
  assert(isRasterPng(bytes, 64, 64));
  for (const layers of [[{ ...good, clipId: '../outside' }], [good, good], [{ ...good, bytes: bytes.subarray(0, 30) }], [{ ...good, bytes: Buffer.concat([bytes, Buffer.from('payload')]) }], Array(65).fill(good), [{ ...good, bytes: new Uint8Array(LIMITS.each + 1) }]])
    assert.throws(() => validateOptions({ ...value, rasterLayers: layers }), /文字图片/);
  assert.throws(() => validateOptions({ ...value, width: 32, rasterLayers: [good] }), /文字图片/);
  // Reuse a 32 MiB structurally valid buffer across distinct layers to exercise
  // the aggregate bound without reserving 160 MiB of unique test memory.
  const large = Buffer.alloc(LIMITS.each);
  bytes.copy(large, 0, 0, 33);
  large.writeUInt32BE(large.length-57, 33); large.write('IDAT', 37);
  bytes.copy(large, large.length-12, bytes.length-12);
  const many = options([], Array.from({length:5}, (_,i)=>clip('text'+i)));
  assert.throws(() => validateOptions({ ...many, rasterLayers: many.project.clips.map(c=>({clipId:c.id,bytes:large})) }), /总大小/);
}));

test('production export rasterises once, preserves original project and cleans cancellation or failure', { skip: !enabled, timeout: 60000 }, () => fixture(async directory => {
  const source = await still(directory, 'title', 'blue');
  const bytes = await fs.readFile(source), p = options([], [clip('title', undefined, { effects: { mask: 'heart' }, transform: transform({ opacity: .5 }) })]);
  p.rasterLayers = [{ clipId: 'title', bytes }];
  const original = JSON.stringify(p.project), output = path.join(directory, 'finished.mp4');
  const exporter = createExporter({ ffmpegPath: ffmpeg, temporaryRoot: directory, resolveAsset: () => { throw Error('raster should use internal grant'); }, emitProgress: () => {} });
  const first = await exporter.begin(p, output);
  assert.equal(first.pipeline, 'native');
  const folders = (await fs.readdir(directory)).filter(name => name.startsWith('freecut-export-'));
  assert.equal(folders.length, 1);
  assert.equal((await fs.readdir(path.join(directory, folders[0]))).filter(name=>name.endsWith('.png')).length, 1);
  await exporter.finish(first.jobId);
  const raw = (await command(['-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {encoding:'buffer'})).stdout;
  color(raw, 3, 32, 32, [0, 0, 128], 64, 64, 10);
  assert.equal(JSON.stringify(p.project), original);
  const before = await fs.readFile(output);
  const cancelled = await exporter.begin(p, output); await exporter.cancel(cancelled.jobId);
  assert.deepEqual(await fs.readFile(output), before);
  const invalid = Buffer.from(bytes);
  for (let position = 8; position + 12 <= invalid.length;) {
    const size = invalid.readUInt32BE(position);
    if (invalid.toString('ascii', position+4, position+8) === 'IDAT') invalid.fill(0, position+8, position+8+size);
    position += size + 12;
  }
  const broken = await exporter.begin({ ...p, rasterLayers: [{ clipId: 'title', bytes: invalid }] }, output);
  await assert.rejects(exporter.finish(broken.jobId), /编码失败/);
  assert.deepEqual(await fs.readFile(output), before);
  assert(!(await fs.readdir(directory)).some(name=>name.startsWith('freecut-export-')||name.startsWith('.freecut-')));
}));

test('production native export applies resolution and quality to actual output files', { skip: !enabled, timeout: 60000 }, () => fixture(async directory => {
  const source = path.join(directory, 'detail.mp4');
  await command(['-f','lavfi','-i','testsrc2=s=320x240:r=10:d=2','-c:v','libx264','-crf','16',source]);
  const media = createMediaLibrary(ffmpeg), video = await media.importPath(source);
  const base = options([video], [clip('moving', video, { duration: 2, transform: transform({ rotation: 8 }) })], { duration: 2 });
  const exporter = createExporter({ ffmpegPath: ffmpeg, temporaryRoot: directory, resolveAsset: media.resolveAsset, emitProgress: () => {} });
  const sizes = {};
  for (const [name,width,height,quality] of [['high',320,240,'high'], ['medium',320,240,'medium'], ['small',160,120,'medium']]) {
    const output = path.join(directory, name+'.mp4');
    const job = await exporter.begin({...base,width,height,quality},output);
    assert.equal(job.pipeline,'native'); await exporter.finish(job.jobId);
    const info = await media.importPath(output);
    assert.equal(info.width,width); assert.equal(info.height,height);
    assert(Math.abs(info.duration-2)<.05);
    sizes[name] = (await fs.stat(output)).size;
  }
  assert(sizes.high > sizes.medium, `high quality ${sizes.high} should preserve more detail than medium ${sizes.medium}`);
  assert(sizes.medium > sizes.small, `full ${sizes.medium} should carry more samples than half-size ${sizes.small}`);
}));

test('concurrent raster preparation reserves export slots and disposal waits for owned files', { skip: !enabled }, () => fixture(async directory => {
  const bytes = await fs.readFile(await still(directory, 'title', 'blue'));
  const p = {...options([], [clip('title')]), rasterLayers:[{clipId:'title',bytes}]};
  const exporter = createExporter({ ffmpegPath: ffmpeg, temporaryRoot: directory, resolveAsset: () => null, emitProgress: () => {} });
  const one = exporter.begin(p, path.join(directory,'one.mp4'));
  const two = exporter.begin(p, path.join(directory,'two.mp4'));
  await assert.rejects(exporter.begin(p,path.join(directory,'three.mp4')), /先完成/);
  const closing = exporter.dispose();
  await Promise.all([one,two,closing]);
  await assert.rejects(exporter.begin(p,path.join(directory,'after-close.mp4')), /已关闭/);
  assert(!(await fs.readdir(directory)).some(name=>name.startsWith('freecut-export-')||name.startsWith('.freecut-')));
}));

test('unsafe pre-flattened text backgrounds and screen-space effects retain the full frame fallback', { skip: !enabled }, () => fixture(async directory => {
  const bytes = await fs.readFile(await still(directory, 'title', 'blue'));
  const exporter = createExporter({ ffmpegPath: ffmpeg, temporaryRoot: directory, resolveAsset: () => null, emitProgress: () => {} });
  for (const partial of [
    { effects: { blur: 2 } }, { effects: { maskFeather: .2 } }, { effects: { vignette: .5 } },
    { text: { background: '#000000' }, fadeIn: .2 },
    { text: { background: '#000000' }, transform: transform({opacity:.5}) },
    { text: { background: 'transparent', stroke: true }, fadeOut: .2 },
    { text: { background: 'transparent', stroke: true }, keyframes: { opacity: [{time:0,value:1,easing:'linear'}] } },
  ]) {
    const p = {...options([], [clip('title',undefined,partial)]), rasterLayers:[{clipId:'title',bytes}]};
    const job = await exporter.begin(p,path.join(directory,'fallback.mp4'));
    assert.equal(job.pipeline,'frames'); assert.equal(job.fallbackReason,'raster-required');
    await exporter.cancel(job.jobId);
  }
  assert(!(await fs.readdir(directory)).some(name=>name.startsWith('freecut-export-')));
}));
