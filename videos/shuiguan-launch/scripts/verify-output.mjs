import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(project, 'renders');
const file = path.join(output, 'shuiguan-launch-1080p.mp4');
const srt = fs.readFileSync(path.join(output, 'shuiguan-launch.zh-CN.srt'), 'utf8');
const seconds = stamp => {
  const values = stamp.split(/[:,]/).map(Number);
  return values[0] * 3600 + values[1] * 60 + values[2] + values[3] / 1000;
};
let subtitleCount = 0;
let lastSubtitleEnd = 0;
for (const block of srt.trim().split(/\r?\n\s*\r?\n/)) {
  const lines = block.split(/\r?\n/);
  const timing = lines[1]?.match(/(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)/);
  if (!timing) throw new Error('Malformed subtitle timestamp');
  const start = seconds(timing[1]);
  const end = seconds(timing[2]);
  if (start < lastSubtitleEnd || end <= start || end > 55 || Number(lines[0]) !== ++subtitleCount) {
    throw new Error('Overlapping, unordered, or out-of-bounds subtitle');
  }
  lastSubtitleEnd = end;
}
if (subtitleCount !== 14 || !srt.includes('全部功能永久免费') ||
    !srt.includes('关注我叫水管同学') || !srt.includes('自愿赞助，不影响任何功能')) {
  throw new Error('Subtitle copy does not reflect the final creator and free-use brief');
}
function run(bin, args) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.error || bin);
  return result;
}
const probe = JSON.parse(run('ffprobe', [
  '-v', 'error', '-show_streams', '-show_format', '-of', 'json', file,
]).stdout);
const video = probe.streams.find(stream => stream.codec_type === 'video');
const audio = probe.streams.find(stream => stream.codec_type === 'audio');
if (video?.width !== 1920 || video?.height !== 1080 ||
    video?.codec_name !== 'h264' || video?.avg_frame_rate !== '30/1' ||
    Number(video?.nb_frames) !== 1650 || audio?.codec_name !== 'aac' ||
    audio?.channels !== 2 || Math.abs(Number(probe.format.duration) - 55) > 0.1) {
  throw new Error('Unexpected final media dimensions, codecs, frames or duration');
}
fs.writeFileSync(path.join(output, 'media-probe.json'), JSON.stringify(probe, null, 2) + '\n');
const decoded = run('ffmpeg', [
  '-hide_banner', '-v', 'info', '-xerror', '-i', file,
  '-vf', 'blackdetect=d=0.05:pix_th=0.05', '-af', 'ebur128=peak=true', '-f', 'null', '-',
]);
fs.writeFileSync(path.join(output, 'decode-audio-check.log'), decoded.stderr);
const black = decoded.stderr.split(/\r?\n/).filter(line => /black_start:/.test(line));
if (black.length) throw new Error('Unexpected black segment: ' + black.join('\n'));
run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf',
  'fps=1/7,scale=480:270,tile=4x2', '-frames:v', '1', path.join(output, 'decoded-contact-sheet.png')]);
for (const [index, time] of [5.5, 18, 35, 43, 52, 54.96, 13.9, 27, 6.9].entries()) {
  run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
    '-frames:v', '1', path.join(output, `decoded-${index + 1}-${time}s.png`)]);
}
const summary = {
  duration: probe.format.duration, width: video.width, height: video.height,
  fps: video.avg_frame_rate, frames: video.nb_frames, video: video.codec_name,
  audio: audio.codec_name, audioChannels: audio.channels, sampleRate: audio.sample_rate,
  bytes: fs.statSync(file).size, fullDecode: 'pass', blackSegments: 0,
  subtitles: { count: subtitleCount, lastEnd: lastSubtitleEnd, overlap: false, correctedCopy: true },
  audioSummary: decoded.stderr.slice(decoded.stderr.lastIndexOf('Summary:')),
};
fs.writeFileSync(path.join(output, 'verification-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
