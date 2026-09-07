'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { INPUT_SECURITY } = require('./media.cjs');
const { planNativeVideo } = require('./native-export.cjs');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const finite = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const identifier = (value) => typeof value === 'string' && value.length > 0 && value.length < 256;
const text = (value, max = 4096) => typeof value === 'string' && value.length <= max;
const properties = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
function validateProject(project) {
  assert(
    project && project.version === 1 && identifier(project.id) && text(project.name, 256),
    '工程格式无效。',
  );
  assert(
    finite(project.width, 16, 8192) &&
      finite(project.height, 16, 8192) &&
      finite(project.fps, 1, 120),
    '工程画幅或帧率无效。',
  );
  assert(
    Array.isArray(project.assets) &&
      project.assets.length <= 10000 &&
      Array.isArray(project.clips) &&
      project.clips.length <= 20000 &&
      Array.isArray(project.tracks) &&
      project.tracks.length <= 128,
    '工程过大或缺少时间线。',
  );
  const assetIds = new Set(),
    trackIds = new Set(),
    clipIds = new Set();
  for (const asset of project.assets) {
    assert(
      asset &&
        identifier(asset.id) &&
        !assetIds.has(asset.id) &&
        text(asset.name, 4096) &&
        ['video', 'audio', 'image'].includes(asset.kind),
      '素材数据无效。',
    );
    assert(
      !asset.path || (text(asset.path, 32768) && path.isAbsolute(asset.path)),
      '素材路径无效。',
    );
    assert(!asset.url || text(asset.url, 65536), '素材地址无效。');
    assetIds.add(asset.id);
  }
  for (const track of project.tracks) {
    assert(
      track &&
        identifier(track.id) &&
        !trackIds.has(track.id) &&
        ['video', 'audio', 'overlay'].includes(track.kind) &&
        typeof track.muted === 'boolean' &&
        typeof track.hidden === 'boolean',
      '轨道数据无效。',
    );
    trackIds.add(track.id);
  }
  for (const clip of project.clips) {
    assert(
      clip &&
        identifier(clip.id) &&
        !clipIds.has(clip.id) &&
        trackIds.has(clip.trackId) &&
        ['video', 'audio', 'image', 'text', 'shape'].includes(clip.kind),
      '片段数据无效。',
    );
    assert(
      finite(clip.start, 0, 14400) &&
        finite(clip.duration, 0.001, 14400) &&
        finite(clip.inPoint, 0, 86400) &&
        finite(clip.speed, 0.05, 20),
      '片段时长或变速参数无效。',
    );
    assert(!clip.assetId || assetIds.has(clip.assetId), '片段引用了不存在的素材。');
    assert(
      clip.transform &&
        properties.every((key) =>
          finite(
            clip.transform[key],
            key === 'volume' ? 0 : -100000,
            key === 'volume' ? 10 : 100000,
          ),
        ),
      '关键帧基础参数无效。',
    );
    assert(
      finite(clip.fadeIn, 0, 14400) &&
        finite(clip.fadeOut, 0, 14400) &&
        clip.keyframes &&
        typeof clip.keyframes === 'object',
      '片段淡入淡出参数无效。',
    );
    if (clip.audio !== undefined)
      assert(
        clip.audio &&
          finite(clip.audio.pan, -1, 1) &&
          finite(clip.audio.leftGain, 0, 2) &&
          finite(clip.audio.rightGain, 0, 2) &&
          ['stereo', 'left', 'right', 'mono', 'swap'].includes(clip.audio.channelMode),
        '左右声道参数无效。',
      );
    for (const key of properties) {
      const values = clip.keyframes[key];
      if (values === undefined) continue;
      assert(Array.isArray(values) && values.length <= 10000, '关键帧数量无效。');
      for (const frame of values)
        assert(
          frame &&
            finite(frame.time, 0, 14400) &&
            finite(frame.value, key === 'volume' ? 0 : -100000, key === 'volume' ? 10 : 100000) &&
            ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'].includes(frame.easing),
          '关键帧数据无效。',
        );
    }
    clipIds.add(clip.id);
  }
  assert(JSON.stringify(project).length <= 64 * 1024 * 1024, '工程文件过大。');
  return project;
}
function validateOptions(options) {
  assert(
    options && options.format === 'mp4' && ['high', 'medium'].includes(options.quality),
    '不支持的导出格式。',
  );
  validateProject(options.project);
  assert(
    Number.isInteger(options.width) &&
      Number.isInteger(options.height) &&
      finite(options.width, 16, 3840) &&
      finite(options.height, 16, 3840) &&
      options.width % 2 === 0 &&
      options.height % 2 === 0,
    '导出尺寸必须为偶数，且不超过 3840 像素。',
  );
  assert(
    finite(options.fps, 1, 60) && finite(options.duration, 0.01, 14400),
    '导出帧率或时长无效。',
  );
  assert(
    options.frameFormat === undefined || ['png', 'rgba'].includes(options.frameFormat),
    '导出帧格式无效。',
  );
  assert(
    options.pipeline === undefined || ['auto', 'frames'].includes(options.pipeline),
    '导出模式无效。',
  );
  return options;
}
function numeric(value) {
  return String(Number(value.toFixed(8)));
}
function volumeExpression(frames, fallback) {
  if (!frames?.length) return numeric(fallback);
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const points = sorted.filter(
    (frame, index) => index === sorted.length - 1 || frame.time !== sorted[index + 1].time,
  );
  function interval(i) {
    if (i === points.length - 1) return numeric(points[i].value);
    const a = points[i],
      b = points[i + 1];
    const p = `((t-${numeric(a.time)})/${numeric(b.time - a.time)})`;
    const easing =
      a.easing === 'hold'
        ? '0'
        : a.easing === 'ease-in'
          ? `(${p}*${p})`
          : a.easing === 'ease-out'
            ? `(1-(1-${p})*(1-${p}))`
            : a.easing === 'ease-in-out'
              ? `if(lt(${p},0.5),2*${p}*${p},1-pow(-2*${p}+2,2)/2)`
              : p;
    return `(${numeric(a.value)}+${numeric(b.value - a.value)}*${easing})`;
  }
  // FFmpeg limits expression parser nesting. A binary search tree keeps both
  // parser depth and interval lookup logarithmic, even for thousands of points.
  function select(begin, end) {
    if (end - begin === 1) return interval(begin);
    const middle = Math.floor((begin + end) / 2);
    return `if(lt(t,${numeric(points[middle].time)}),${select(begin, middle)},${select(middle, end)})`;
  }
  return `if(lt(t,${numeric(points[0].time)}),${numeric(points[0].value)},${select(0, points.length)})`;
}
function atempoChain(speed) {
  const factors = [];
  let remaining = speed;
  while (remaining > 2) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors.map((factor) => `atempo=${numeric(factor)}`);
}
function channelMatrix(audio) {
  const { pan = 0, leftGain = 1, rightGain = 1, channelMode = 'stereo' } = audio || {};
  const left = leftGain * (pan > 0 ? 1 - pan : 1),
    right = rightGain * (pan < 0 ? 1 + pan : 1);
  if (channelMode === 'left') return [left, 0, right, 0];
  if (channelMode === 'right') return [0, left, 0, right];
  if (channelMode === 'mono') return [left / 2, left / 2, right / 2, right / 2];
  if (channelMode === 'swap') return [0, left, right, 0];
  return [left, 0, 0, right];
}
function planAudio(project, duration, resolveAsset, inputOffset = 1) {
  const tracks = new Map(project.tracks.map((track) => [track.id, track]));
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const inputs = [];
  const filters = [];
  const labels = [];
  for (const clip of project.clips) {
    if (
      !['video', 'audio'].includes(clip.kind) ||
      !clip.assetId ||
      tracks.get(clip.trackId)?.muted ||
      clip.start >= duration
    )
      continue;
    const asset = assets.get(clip.assetId);
    if (!asset) continue;
    const media = resolveAsset(asset);
    if (!media?.hasAudio) continue;
    const length = Math.min(clip.duration, duration - clip.start);
    const index = inputs.length + inputOffset,
      label = `audio${inputs.length}`;
    inputs.push(media.path);
    const chain = [
      `atrim=start=${numeric(clip.inPoint)}:end=${numeric(clip.inPoint + length * clip.speed)}`,
      'asetpts=PTS-STARTPTS',
      ...atempoChain(clip.speed),
      `aresample=48000`,
      `volume='${volumeExpression(clip.keyframes.volume, clip.transform.volume)}':eval=frame`,
    ];
    // Web Audio duplicates mono at unity; FFmpeg's default mono-to-stereo
    // rematrix attenuates it, so explicitly duplicate before channel controls.
    chain.push(
      media.audioChannels === 1 ? 'pan=stereo|c0=c0|c1=c0' : 'aformat=channel_layouts=stereo',
    );
    const [ll, lr, rl, rr] = channelMatrix(clip.audio);
    chain.push(
      `pan=stereo|c0=${numeric(ll)}*c0+${numeric(lr)}*c1|c1=${numeric(rl)}*c0+${numeric(rr)}*c1`,
    );
    if (clip.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${numeric(clip.fadeIn)}`);
    if (clip.fadeOut > 0)
      chain.push(
        `afade=t=out:st=${numeric(Math.max(0, clip.duration - clip.fadeOut))}:d=${numeric(Math.min(clip.duration, clip.fadeOut))}`,
      );
    chain.push(
      `atrim=duration=${numeric(length)}`,
      `adelay=${Math.round(clip.start * 48000)}S:all=1`,
    );
    filters.push(`[${index}:a:0]${chain.join(',')}[${label}]`);
    labels.push(`[${label}]`);
  }
  filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${numeric(duration)}[silence]`);
  filters.push(
    `[silence]${labels.join('')}amix=inputs=${labels.length + 1}:duration=longest:dropout_transition=0:normalize=0,atrim=duration=${numeric(duration)}[mix]`,
  );
  return { inputs, filterGraph: filters.join(';') };
}
function validFrame(bytes, width, height) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 33 ||
    bytes.byteLength > 128 * 1024 * 1024
  )
    return false;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.readUInt32BE(16) === width &&
    buffer.readUInt32BE(20) === height
  );
}
function createExporter({ ffmpegPath, resolveAsset, emitProgress, temporaryRoot }) {
  const jobs = new Map();
  let filterOptionPromise;
  const progress = (job, phase, value) => {
    const now = Date.now();
    if (phase === job.lastPhase && value < 1 && now - job.lastProgress < 100) return;
    job.lastProgress = now;
    job.lastPhase = phase;
    emitProgress({ jobId: job.id, phase, progress: Math.max(0, Math.min(1, value)) });
  };
  const get = (id) => {
    assert(typeof id === 'string' && jobs.has(id), '导出任务不存在或已结束。');
    return jobs.get(id);
  };
  async function cleanup(job) {
    await Promise.allSettled([
      fs.rm(job.directory, { recursive: true, force: true }),
      fs.rm(job.staging, { force: true }),
    ]);
  }
  function filterOption() {
    // A pipe cannot be replayed after an option error. Determine the bundled
    // encoder syntax before sending frames (FFmpeg 9 removed the old spelling).
    if (!filterOptionPromise)
      filterOptionPromise = new Promise((resolve, reject) => {
        const { execFile } = require('node:child_process');
        execFile(
          ffmpegPath,
          ['-hide_banner', '-version'],
          { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              reject(new Error('无法启动内置编码器，请检查应用安装是否完整。'));
              return;
            }
            const version = /ffmpeg version (?:n)?(\d+)/i.exec(stdout);
            resolve(
              version && Number(version[1]) >= 9 ? '-/filter_complex' : '-filter_complex_script',
            );
          },
        );
      }).catch((error) => {
        filterOptionPromise = undefined;
        throw error;
      });
    return filterOptionPromise;
  }
  async function begin(options, outputPath) {
    validateOptions(options);
    assert(jobs.size < 2, '请先完成或取消当前导出。');
    const native = options.pipeline === 'auto' ? planNativeVideo(options, resolveAsset) : null;
    const audio = planAudio(
      options.project,
      options.duration,
      resolveAsset,
      native ? native.inputs.length : 1,
    );
    const id = crypto.randomUUID();
    const directory = await fs.mkdtemp(path.join(temporaryRoot, 'freecut-export-'));
    const staging = path.join(path.dirname(outputPath), `.freecut-${id}.mp4`);
    const job = {
      id,
      options,
      audio,
      native,
      frameFormat: options.frameFormat ?? 'png',
      directory,
      staging,
      outputPath,
      nextFrame: 0,
      frames: Math.ceil(options.duration * options.fps),
      state: native ? 'native' : 'frames',
      child: null,
      writing: null,
      starting: null,
      encoding: null,
      error: null,
      completion: null,
    };
    jobs.set(id, job);
    progress(job, native ? 'encoding' : 'frames', 0);
    return {
      jobId: id,
      path: outputPath,
      pipeline: native ? 'native' : 'frames',
      frameFormat: job.frameFormat,
    };
  }
  async function writeFrame(data) {
    assert(data && typeof data === 'object', '帧数据无效。');
    const job = get(data.jobId);
    assert(job.state === 'frames' && !job.writing, '导出当前无法接收帧。');
    assert(
      Number.isInteger(data.index) && data.index === job.nextFrame && data.index < job.frames,
      '帧序号不连续。',
    );
    assert(
      job.frameFormat === 'rgba'
        ? data.bytes instanceof Uint8Array &&
            data.bytes.byteLength === job.options.width * job.options.height * 4
        : validFrame(data.bytes, job.options.width, job.options.height),
      '导出帧尺寸或格式无效。',
    );
    job.writing = (async () => {
      await start(job);
      if (job.error) throw job.error;
      assert(job.state !== 'cancelled', '导出已取消。');
      // Await the write callback: at most one IPC frame is pending. Slow CPUs
      // apply backpressure instead of accumulating a movie's worth of pixels.
      await new Promise((resolve, reject) =>
        job.child.stdin.write(data.bytes, (error) =>
          error ? reject(job.error ?? error) : resolve(),
        ),
      );
    })();
    try {
      await job.writing;
      job.nextFrame++;
      if (job.state !== 'cancelled') progress(job, 'frames', job.nextFrame / job.frames);
    } catch (error) {
      if (job.state !== 'cancelled') job.state = 'failed';
      if (job.child) job.child.kill();
      await job.encoding?.catch(() => {});
      await cleanup(job);
      jobs.delete(job.id);
      throw new Error(`导出画面失败：${error.message}`);
    } finally {
      job.writing = null;
    }
  }
  function start(job) {
    if (job.starting) return job.starting;
    job.starting = (async () => {
      const option = await filterOption();
      assert(job.state !== 'cancelled', '导出已取消。');
      const graph = [job.native?.filterGraph, job.audio.filterGraph].filter(Boolean).join(';');
      const filterFile = path.join(job.directory, 'filters.txt');
      await fs.writeFile(filterFile, graph, 'utf8');
      assert(job.state !== 'cancelled', '导出已取消。');
      const args = ['-hide_banner', '-nostdin', '-y', '-filter_complex_threads', '2'];
      if (job.native) {
        for (const input of job.native.inputs) {
          args.push(...INPUT_SECURITY);
          if (input.kind === 'image')
            args.push('-loop', '1', '-framerate', numeric(job.options.fps));
          args.push('-threads', '2', '-i', input.path);
        }
      } else {
        args.push('-f', job.frameFormat === 'rgba' ? 'rawvideo' : 'image2pipe');
        if (job.frameFormat === 'rgba')
          args.push(
            '-pixel_format',
            'rgba',
            '-video_size',
            `${job.options.width}x${job.options.height}`,
          );
        else args.push('-vcodec', 'png');
        args.push('-framerate', numeric(job.options.fps), '-i', 'pipe:0');
      }
      for (const input of job.audio.inputs) args.push(...INPUT_SECURITY, '-i', input);
      args.push(
        option,
        filterFile,
        '-map',
        job.native ? `[${job.native.videoLabel}]` : '0:v:0',
        '-map',
        '[mix]',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-threads',
        '4',
        '-crf',
        job.options.quality === 'high' ? '18' : '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-t',
        numeric(job.options.duration),
        '-movflags',
        '+faststart',
        '-progress',
        'pipe:1',
        '-nostats',
        job.staging,
      );
      const child = spawn(ffmpegPath, args, {
        windowsHide: true,
        stdio: [job.native ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
      job.child = child;
      let stderr = '',
        pending = '';
      child.stderr.on('data', (data) => {
        stderr = (stderr + data.toString()).slice(-16384);
      });
      child.stdout.on('data', (data) => {
        pending += data.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (match) progress(job, 'encoding', Number(match[1]) / 1000000 / job.options.duration);
        }
      });
      child.stdin?.on('error', () => {});
      job.encoding = new Promise((resolve, reject) => {
        child.once('error', () =>
          reject(new Error('无法启动内置编码器，请检查应用安装是否完整。')),
        );
        child.once('close', (code) => {
          job.child = null;
          if (job.state === 'cancelled') reject(new Error('导出已取消。'));
          else if (code !== 0) reject(new Error(`编码失败：${stderr.slice(-2500)}`));
          else resolve();
        });
      });
      job.encoding.catch((error) => {
        job.error = error;
      });
    })();
    return job.starting;
  }
  async function finish(id) {
    const job = get(id);
    assert(['frames', 'native'].includes(job.state) && !job.writing, '导出任务状态无效。');
    if (!job.native)
      assert(
        job.nextFrame === job.frames,
        `帧不完整：需要 ${job.frames} 帧，已收到 ${job.nextFrame} 帧。`,
      );
    job.state = 'encoding';
    progress(job, 'encoding', 0);
    job.completion = (async () => {
      try {
        await start(job);
        if (job.error) throw job.error;
        assert(job.state !== 'cancelled', '导出已取消。');
        if (!job.native) job.child?.stdin.end();
        await job.encoding;
        assert(job.state !== 'cancelled', '导出已取消。');
        const stat = await fs.stat(job.staging);
        assert(stat.size > 0, '编码器未生成有效文件。');
        assert(job.state !== 'cancelled', '导出已取消。');
        job.state = 'committing';
        await fs.rename(job.staging, job.outputPath);
        job.state = 'done';
        progress(job, 'done', 1);
        return { path: job.outputPath };
      } finally {
        await cleanup(job);
        jobs.delete(id);
      }
    })();
    return job.completion;
  }
  async function cancel(id) {
    const job = jobs.get(id);
    if (!job) return;
    if (job.state === 'done' || job.state === 'committing') {
      await job.completion;
      return;
    }
    job.state = 'cancelled';
    if (job.child) job.child.kill();
    await Promise.allSettled(
      [job.starting, job.writing, job.encoding, job.completion].filter(Boolean),
    );
    await cleanup(job);
    jobs.delete(id);
    progress(job, 'cancelled', 0);
  }
  async function dispose() {
    await Promise.allSettled([...jobs.keys()].map(cancel));
  }
  return { begin, writeFrame, finish, cancel, dispose };
}
module.exports = {
  validateProject,
  validateOptions,
  volumeExpression,
  atempoChain,
  channelMatrix,
  planAudio,
  validFrame,
  createExporter,
};
