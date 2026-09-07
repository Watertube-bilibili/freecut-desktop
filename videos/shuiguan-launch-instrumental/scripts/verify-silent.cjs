'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'renders');
const file = path.join(output, 'shuiguan-launch-silent-1080p.mp4');
const run = (bin, args) => {
  const result = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr || result.error || bin);
  return result;
};
const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
assert(!/<audio\b|el-captions|compositions\/captions\.html/.test(html));
assert(html.includes('@我叫水管同学'));
const frames = JSON.parse(fs.readFileSync(path.join(project, 'frames.json'), 'utf8'));
assert.equal(frames.length, 7);
let end = 0;
for (const frame of frames) {
  assert.equal(frame.start, end);
  end += frame.duration;
  const source = fs.readFileSync(path.join(project, 'compositions/frames', frame.id + '.html'), 'utf8');
  assert(!/<audio\b|el-captions|assets\/voice\//.test(source));
}
assert.equal(end, 55);
const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).stdout);
const video = probe.streams.filter((stream) => stream.codec_type === 'video');
assert.equal(video.length, 1);
assert.equal(probe.streams.length, 1, 'The visual material must have no audio or subtitle stream');
assert.equal(video[0].codec_name, 'h264');
assert.equal(video[0].width, 1920);
assert.equal(video[0].height, 1080);
assert.equal(video[0].avg_frame_rate, '30/1');
assert.equal(Number(video[0].nb_frames), 1650);
assert.equal(Number(probe.format.duration), 55);
const decoded = run('ffmpeg', ['-hide_banner', '-v', 'info', '-xerror', '-i', file,
  '-vf', 'blackdetect=d=0.03:pix_th=0.05', '-f', 'null', '-']);
fs.writeFileSync(path.join(output, 'decode-check.log'), decoded.stderr);
assert(!/black_start:/.test(decoded.stderr), 'No full black frame may occur');
const samples = [3.5, 10.5, 18, 26, 35, 43.5, 51, 54.96];
for (const [index, time] of samples.entries())
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', path.join(output, `decoded-${index + 1}-${time}s.png`)]);
run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf',
  "select='eq(n,105)+eq(n,315)+eq(n,540)+eq(n,780)+eq(n,1050)+eq(n,1305)+eq(n,1530)+eq(n,1649)',scale=480:270,tile=4x2",
  '-frames:v', '1', path.join(output, 'decoded-contact-sheet.png')]);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const result = {
  file, duration: 55, width: 1920, height: 1080, fps: 30, frames: 1650,
  audioStreams: 0, subtitleStreams: 0, sourceAudioMounts: 0, sourceCaptionMounts: 0,
  bytes: fs.statSync(file).size, sha256, fullDecode: 'pass', blackSegments: 0, samples,
};
fs.writeFileSync(path.join(output, 'media-probe.json'), JSON.stringify(probe, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'verification-summary.json'), JSON.stringify(result, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), sha256 + '  ' + path.basename(file) + '\n');
console.log(JSON.stringify(result, null, 2));
