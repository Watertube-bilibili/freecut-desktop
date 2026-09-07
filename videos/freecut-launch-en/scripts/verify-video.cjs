'use strict';

// The HyperFrames result is a visual input, not the final FreeCut export.
require('./verify-source.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

const project = path.resolve(__dirname, '..');
const output = path.join(project, 'renders');
const filename = 'freecut-launch-en-visual-1080p.mp4';
const file = path.join(output, filename);
const run = (bin, args) => {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw Error(result.stderr || result.error || bin);
  return result;
};

const probe = JSON.parse(run('ffprobe', [
  '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file,
]).stdout);
const video = probe.streams.filter((stream) => stream.codec_type === 'video');
assert.equal(video.length, 1);
assert.equal(probe.streams.length, 1, 'The visual input must have no audio or subtitle stream');
assert.equal(video[0].codec_name, 'h264');
assert.equal(video[0].width, 1920);
assert.equal(video[0].height, 1080);
assert.equal(video[0].avg_frame_rate, '30/1');
assert.equal(Number(video[0].nb_frames), 1650);
assert.equal(Number(probe.format.duration), 55);

const decoded = run('ffmpeg', [
  '-hide_banner', '-v', 'info', '-xerror', '-i', file,
  '-vf', 'blackdetect=d=0.03:pix_th=0.05', '-f', 'null', '-',
]);
fs.writeFileSync(path.join(output, 'decode-check.log'), decoded.stderr);
assert(!/black_start:/.test(decoded.stderr), 'No full black frame may occur');

const samples = [6.5, 13.5, 21.5, 29.5, 39.5, 46.5, 51, 54.96];
for (const [index, time] of samples.entries()) {
  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', path.join(output, `decoded-${index + 1}-${time}s.png`),
  ]);
}
run('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf',
  "select='eq(n,195)+eq(n,405)+eq(n,645)+eq(n,885)+eq(n,1185)+eq(n,1395)+eq(n,1530)+eq(n,1649)',scale=480:270,tile=4x2",
  '-frames:v', '1', path.join(output, 'decoded-contact-sheet.png'),
]);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Public reports use paths relative to this source project.
probe.format.filename = `renders/${filename}`;
const result = {
  passed: true,
  role: 'silent visual input for a subsequent real FreeCut export',
  file: `renders/${filename}`,
  duration: 55, width: 1920, height: 1080, fps: 30, frames: 1650,
  audioStreams: 0, subtitleStreams: 0, sourceAudioMounts: 0, sourceCaptionMounts: 0,
  bytes: fs.statSync(file).size, sha256, fullDecode: 'pass', blackSegments: 0, samples,
};
fs.writeFileSync(path.join(output, 'media-probe.json'), JSON.stringify(probe, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'verification-summary.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${sha256}  ${filename}\n`);
console.log(JSON.stringify(result, null, 2));
