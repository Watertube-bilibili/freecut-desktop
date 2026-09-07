'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { planNativeVideo } = require('./native-export.cjs');
const { INPUT_SECURITY, createMediaLibrary } = require('./media.cjs');
const run = promisify(execFile);
let ffmpeg = process.env.FREECUT_TEST_FFMPEG;
if (!ffmpeg) try { ffmpeg = require('ffmpeg-static'); } catch {}

function clip(id, partial = {}) {
  return { id, kind: 'video', trackId: 'v', assetId: 'a', start: 0, duration: 1, inPoint: 0, speed: 1,
    fadeIn: 0, fadeOut: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 },
    effects: { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, grayscale: 0, sepia: 0, vignette: 0, pixelate: 0, chroma: false, mask: 'none', flipX: false, flipY: false }, keyframes: {}, ...partial };
}
function options(clips = [clip('c')]) {
  return { width: 64, height: 64, fps: 10, duration: 1, project: {
    width: 64, height: 64, fps: 10, background: '#102030',
    tracks: [{ id: 'v', kind: 'video', hidden: false }],
    assets: [{ id: 'a', kind: 'video', path: path.resolve('asset.mp4'), duration: 5 }], clips,
  } };
}
const resolve = asset => ({ kind: asset.kind, path: asset.path });

test('native planner declines visual changes, overlap, fractional cuts and unsafe background without losing features', () => {
  for (const mutate of [
    c => c.kind = 'text', c => c.kind = 'shape', c => c.fadeIn = 0.1,
    c => c.transform.x = 1, c => c.transform.opacity = 0.9,
    c => c.keyframes.rotation = [{ time: 0, value: 0 }],
    c => c.effects.mask = 'circle', c => c.effects.brightness = 1.1,
    c => c.effects.futureEffect = 1, c => c.start = 0.05,
    c => c.duration = 0.55, c => c.inPoint = 5, c => c.inPoint = 0.05,
  ]) {
    const value = options(); mutate(value.project.clips[0]);
    assert.equal(planNativeVideo(value, resolve), null);
  }
  assert.equal(planNativeVideo(options([clip('a'), clip('b', { start: 0.5 })]), resolve), null);
  const value = options(); value.project.background = 'red;movie=secret';
  assert.equal(planNativeVideo(value, resolve), null);
  value.project.background = '#102030';
  assert.throws(() => planNativeVideo(value, () => { throw Error('Unauthorized'); }), /Unauthorized/);
});

test('hidden visuals and audio-only projects plan background without resolving ignored media', () => {
  const value = options([clip('hidden', { kind: 'text' }), clip('audio', { kind: 'audio' })]);
  value.project.tracks[0].hidden = true;
  const result = planNativeVideo(value, () => { throw Error('must not resolve hidden media'); });
  assert.equal(result.inputCount, 0); assert.equal(result.frames, 10);
  assert.match(result.filterGraph, /color=c=0x102030/);
});

test('volume automation remains for audio mixing and ordered native input indexes remain separate', () => {
  const value = options([clip('a', { duration: 0.5, keyframes: { volume: [{ time: 0, value: 0 }] } }), clip('b', { start: 0.5, duration: 0.5 })]);
  const result = planNativeVideo(value, resolve);
  assert.equal(result.inputCount, 2); assert.equal(result.videoLabel, 'nativevideo');
  assert.match(result.filterGraph, /\[0:v:0\]/); assert.match(result.filterGraph, /\[1:v:0\]/);
  assert.match(result.filterGraph, /concat=n=2:v=1:a=0/);
});

test('fractional total durations keep the final visible frame instead of inserting background', () => {
  const value = options([clip('last', { duration: 0.100000001 })]);
  value.duration = 0.100000001;
  const plan = planNativeVideo(value, resolve);
  assert.equal(plan.frames, 2);
  assert.doesNotMatch(plan.filterGraph, /nativepart1/);
});

test('real native FFmpeg export preserves cuts, gaps, contain background, still alpha, speed and exact frame count', { skip: !ffmpeg, timeout: 60000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-native-test-'));
  const command = (args, extra = {}) => run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...extra });
  try {
    const source = path.join(directory, '红 蓝 视频.mp4'), still = path.join(directory, 'green.png');
    await command(['-f', 'lavfi', '-i', 'color=red:s=64x32:r=10:d=1', '-f', 'lavfi', '-i', 'color=blue:s=64x32:r=10:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
    await command(['-f', 'lavfi', '-i', 'color=lime@0.5:s=32x32,format=rgba', '-frames:v', '1', still]);
    const library = createMediaLibrary(ffmpeg), video = await library.importPath(source), image = await library.importPath(still);
    const value = options([
      clip('red', { assetId: video.id, start: 0.2, duration: 0.4, inPoint: 0.2 }),
      clip('blue', { assetId: video.id, start: 0.6, duration: 0.4, inPoint: 1.2, speed: 2 }),
      clip('image', { kind: 'image', assetId: image.id, start: 1.2, duration: 0.4 }),
      clip('hidden-text', { kind: 'text', trackId: 'hidden', start: 0, duration: 1.8 }),
    ]);
    value.duration = 1.8; value.project.assets = [video, image];
    value.project.tracks.push({ id: 'hidden', kind: 'overlay', hidden: true });
    const plan = planNativeVideo(value, library.resolveAsset); assert.ok(plan);
    const args = plan.inputs.flatMap(input => [...INPUT_SECURITY, ...(input.kind === 'image' ? ['-loop', '1'] : []), '-i', input.path]);
    const output = path.join(directory, 'native.mp4'), start = performance.now();
    await command([...args, '-filter_complex', plan.filterGraph, '-map', `[${plan.videoLabel}]`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-t', String(value.duration), output]);
    const ms = performance.now() - start;
    const { stdout: pixels } = await command(['-i', output, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' });
    const frameBytes = 64 * 64 * 3;
    assert.equal(pixels.length / frameBytes, 18);
    const colorAt = (frame, x = 32, y = 32) => [...pixels.subarray(frame * frameBytes + (y * 64 + x) * 3, frame * frameBytes + (y * 64 + x) * 3 + 3)];
    const near = (actual, expected, label, tolerance = 8) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${label}: ${actual} expected ${expected}`));
    for (const index of [0, 1, 10, 11, 16, 17]) near(colorAt(index), [16, 32, 48], `background frame ${index}`);
    for (const index of [2, 3, 4, 5]) near(colorAt(index), [255, 0, 0], `red frame ${index}`);
    for (const index of [6, 7, 8, 9]) near(colorAt(index), [0, 0, 255], `blue frame ${index}`);
    near(colorAt(3, 32, 4), [16, 32, 48], 'contain padding');
    for (const index of [12, 13, 14, 15]) near(colorAt(index), [8, 143, 24], `alpha image frame ${index}`, 10);
    const info = await library.importPath(output); assert.ok(Math.abs(info.duration - 1.8) < 0.02);
    t.diagnostic(`Native fixture: 18 frames, 1.8 s, exact cuts/gaps, alpha and contain verified; encode ${ms.toFixed(1)} ms.`);

    for (const [speed, outputDuration, boundary] of [[2, 1, 5], [0.5, 4, 20]]) {
      const changed = options([clip('changing-speed', { assetId: video.id, speed, duration: outputDuration })]);
      changed.duration = outputDuration; changed.project.assets = [video];
      const speedPlan = planNativeVideo(changed, library.resolveAsset); assert.ok(speedPlan);
      const { stdout: raw } = await command([...INPUT_SECURITY, '-i', source, '-filter_complex', speedPlan.filterGraph, '-map', '[nativevideo]', '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' });
      assert.equal(raw.length / frameBytes, outputDuration * 10);
      for (const index of [boundary - 1, boundary]) {
        const offset = index * frameBytes + (32 * 64 + 32) * 3;
        near([...raw.subarray(offset, offset + 3)], index < boundary ? [255, 0, 0] : [0, 0, 255], `${speed}x speed boundary frame ${index}`);
      }
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
