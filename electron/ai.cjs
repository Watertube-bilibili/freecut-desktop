'use strict';

// Models and native engines are optional, pinned downloads; never run npm or a shell.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, fork } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');

const VERSION = '1.13.7';
const HF = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/65176e2deb88badc814a94058666cadccc29b61c/';
const SENSE = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/';
const RUNTIME = {
  name: 'sherpa-onnx-node', size: 11954,
  integrity: 'sha512-0XGV7arGngBCnol0m8OLyqlnaUm19Q1KmetVj1DDBdymXa1upmAHZDwNdN47gjsEhqE5hXUEyc1vRQoXrNhNVg=='
};
const NATIVE = {
  'win32-x64': { name: 'sherpa-onnx-win-x64', size: 8705089, integrity: 'sha512-wBV1o+/zgsMrOjfCFIgGrH6S28xq6CqRCLSavCOjTZ6cqr80yGc07DUHxqsHFPZvfoJU+2JF5L2l3gyWFWoWdQ==' },
  'darwin-x64': { name: 'sherpa-onnx-darwin-x64', size: 11151181, integrity: 'sha512-N3o+T+wn9WaQmsKV5DD8bTHdo+WN2+sXwmZcGJZiDjtOMR2zFz7uVCZnYCmEAMgvChC+oHcF5RvEEKcRCAu6Pw==' },
  'darwin-arm64': { name: 'sherpa-onnx-darwin-arm64', size: 10015211, integrity: 'sha512-5NCE50hAvr3n2pdett0SgfPBJXaFZE0bqHwbHyiq+IKZ8Ids0l4M0VrG+ImGYIafCwie+oC3uAJ+pKj9xg/k+w==' },
};
const MODELS = {
  'asr-sensevoice': { name: 'SenseVoice Small · 中文优先', bytes: 239549806, diskBytes: 239549806, license: 'FunASR 模型许可（见说明）', files: [
    { name: 'model.int8.onnx', url: SENSE + 'model.int8.onnx', size: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' },
    { name: 'tokens.txt', url: SENSE + 'tokens.txt', size: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' },
    { name: 'LICENSE', url: SENSE + 'LICENSE', size: 71, sha256: '221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17' },
  ] },
  'asr-zh-en': { name: 'Whisper tiny · 中英识别', bytes: 103609903, diskBytes: 103609903, license: 'MIT', files: [
    { name: 'tiny-encoder.int8.onnx', url: HF + 'tiny-encoder.int8.onnx', size: 12937772, sha256: 'd24fb083ae3b1041fc24e97971d60e280c9342201fbb67b0ab428a8b4a51a434' },
    { name: 'tiny-decoder.int8.onnx', url: HF + 'tiny-decoder.int8.onnx', size: 89855401, sha256: 'd2fece8dd42771f1df975c6c0445770d0c292bf7547c2cae04a6c0cc57540925' },
    { name: 'tiny-tokens.txt', url: HF + 'tiny-tokens.txt', size: 816730, sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126' },
  ] },
  'tts-zh': { name: 'AISHELL-3 · 中文 174 音色', bytes: 31559701, diskBytes: 213479522, license: 'Apache-2.0（引擎/训练数据；权重见说明）', files: [
    { name: 'tts.tar.bz2', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-zh-aishell3.tar.bz2', size: 31559701, sha256: 'ab468db3a3308cdd861495e0db2f25d79418a0c00639f74944c7cdf5dd8c6ec1' },
  ] },
};
const HOSTS = new Set(['registry.npmjs.org', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co']);
const packageFile = info => ({ ...info, name: info.name + '.tgz', url: `https://registry.npmjs.org/${info.name}/-/${info.name}-${VERSION}.tgz` });
const exists = async p => !!(await fsp.stat(p).catch(() => null));
const inside = (base, target) => { const rel = path.relative(base, target); return !!rel && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };

async function digest(filename, algorithm = 'sha256', encoding = 'hex') {
  const hash = crypto.createHash(algorithm);
  for await (const part of fs.createReadStream(filename)) hash.update(part);
  return hash.digest(encoding);
}
async function verifyFile(filename, spec) {
  const stat = await fsp.stat(filename).catch(() => null);
  if (!stat?.isFile() || (spec.size && stat.size !== spec.size)) return false;
  const expected = spec.sha256 || spec.integrity.split('-')[1];
  return await digest(filename, spec.sha256 ? 'sha256' : 'sha512', spec.sha256 ? 'hex' : 'base64') === expected;
}
async function request(url, signal, redirects = 0) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443') || !HOSTS.has(parsed.hostname)) throw Error('下载源不在允许列表');
  if (redirects > 6) throw Error('下载重定向过多');
  const response = await fetch(url, { signal, redirect: 'manual' });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    return request(new URL(response.headers.get('location'), url).href, signal, redirects + 1);
  }
  if (!response.ok || !response.body) throw Error(`下载失败（HTTP ${response.status}），请重试`);
  return response;
}
async function download(spec, cache, progress, signal) {
  await fsp.mkdir(cache, { recursive: true });
  const key = crypto.createHash('sha256').update(spec.url).digest('hex').slice(0, 20);
  const final = path.join(cache, key + '-' + spec.name);
  if (await verifyFile(final, spec)) return final;
  const partial = final + '.part';
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    let timeout;
    try {
      const transfer = new AbortController();
      const stop = () => transfer.abort();
      signal.addEventListener('abort', stop, { once: true });
      const refresh = () => { clearTimeout(timeout); timeout = setTimeout(() => transfer.abort(), 60000); };
      refresh();
      try {
        const response = await request(spec.url, transfer.signal);
        let received = 0; let reportedAt = 0;
        const total = spec.size || Number(response.headers.get('content-length')) || 0;
        const meter = new Transform({ transform(chunk, enc, cb) {
          received += chunk.length; refresh();
          if (received > (spec.size || 120000000)) return cb(Error('下载文件超过预定大小'));
          if (Date.now() - reportedAt > 120 || received === total) { reportedAt = Date.now(); progress({ phase: 'downloading', message: `下载 ${spec.name}（第 ${attempt} 次）`, received, total, progress: total ? received / total : 0 }); } cb(null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial, { flags: 'w', mode: 0o600 }), { signal: transfer.signal });
      } finally { clearTimeout(timeout); signal.removeEventListener('abort', stop); }
      progress({ phase: 'verifying', message: `校验 ${spec.name}`, progress: 1 });
      if (!await verifyFile(partial, spec)) throw Error('下载文件散列校验失败，未安装');
      await fsp.rm(final, { force: true });
      await fsp.rename(partial, final);
      return final;
    } catch (error) {
      clearTimeout(timeout); await fsp.rm(partial, { force: true });
      if (signal.aborted) throw Error('已取消');
      if (attempt === 3) throw error;
    }
  }
}

async function extract(archive, destination, bzip, signal) {
  await fsp.mkdir(destination, { recursive: true });
  signal.throwIfAborted();
  // tar Unpack is an EventEmitter sink, not a Node Writable. Do not put it in
  // stream.pipeline(), whose error path assumes destination.destroy() exists.
  await new Promise((resolve, reject) => {
    let total = 0; let count = 0; let settled = false; let invalid;
    const source = fs.createReadStream(archive);
    const decompressor = bzip ? require('unbzip2-stream')() : null;
    const output = require('tar').x({ cwd: destination, strip: 1, strict: true, preservePaths: false,
      filter(name, entry) {
        const normalized = name.replaceAll('\\', '/');
        if (normalized.startsWith('/') || normalized.includes(':') || normalized.split('/').some(x => x === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)) || normalized.includes('\0')) invalid = Error('压缩包包含不安全路径');
        if (!['File', 'Directory'].includes(entry.type)) invalid = Error('压缩包包含链接或不支持的文件类型');
        total += entry.size || 0; count++;
        if (total > 600000000 || count > 10000) invalid = Error('压缩包超出安全解压限额');
        if (invalid) { queueMicrotask(() => finish(invalid)); return false; }
        return true;
      },
    });
    const cancel = () => finish(Error('已取消'));
    function finish(error) {
      if (settled) return; settled = true; signal.removeEventListener('abort', cancel);
      if (error) { source.unpipe(); decompressor?.unpipe(); source.destroy(); decompressor?.destroy(); output.abort(error); reject(error); }
      else resolve();
    }
    source.on('error', finish); decompressor?.on('error', finish); output.on('error', finish);
    output.on('close', () => finish(invalid)); signal.addEventListener('abort', cancel, { once: true });
    if (decompressor) source.pipe(decompressor).pipe(output); else source.pipe(output);
  });
}
async function manifest(directory) {
  const files = [];
  async function visit(folder) {
    for (const file of await fsp.readdir(folder, { withFileTypes: true })) {
      const filename = path.join(folder, file.name);
      if (file.isDirectory()) await visit(filename);
      else if (file.isFile() && file.name !== 'installed.json') files.push({ name: path.relative(directory, filename), size: (await fsp.stat(filename)).size, sha256: await digest(filename) });
      else throw Error('安装目录包含不支持的条目');
    }
  }
  await visit(directory);
  await fsp.writeFile(path.join(directory, 'installed.json'), JSON.stringify({ version: VERSION, files }, null, 2));
}
async function installed(directory, full = false) {
  try {
    const receipt = JSON.parse(await fsp.readFile(path.join(directory, 'installed.json'), 'utf8'));
    if (receipt.version !== VERSION || !Array.isArray(receipt.files) || !receipt.files.length) return false;
    for (const file of receipt.files) {
      const filename = path.resolve(directory, file.name);
      if (!inside(directory, filename)) return false;
      if (full ? !await verifyFile(filename, file) : (await fsp.stat(filename)).size !== file.size) return false;
    }
    return true;
  } catch { return false; }
}

function createAIService({ app, ffmpegPath, importPath, validateMediaPath }) {
  const base = path.join(app.getPath('userData'), 'ai');
  const runtime = path.join(base, `runtime-${VERSION}-${process.platform}-${process.arch}`);
  const native = NATIVE[`${process.platform}-${process.arch}`];
  const modelPath = id => path.join(base, id + '-v1');
  let active;
  const status = async () => ({ supported: !!native, platform: `${process.platform}-${process.arch}`, runtimeReady: await installed(runtime), busy: !!active,
    models: await Promise.all(Object.entries(MODELS).map(async ([id, m]) => ({ id, name: m.name, bytes: m.bytes, diskBytes: m.diskBytes, license: m.license, installed: await installed(modelPath(id)) }))) });
  async function operation(progress, fn) {
    if (active) throw Error('已有 AI 任务运行中，请等待或取消');
    if (!native) throw Error('当前仅支持 Windows x64 和 macOS x64 / arm64');
    const controller = new AbortController(); active = controller;
    const emit = data => { if (!controller.signal.aborted) progress(data); };
    try { const result = await fn(controller.signal, emit); controller.signal.throwIfAborted(); emit({ phase: 'done', message: '已完成', progress: 1 }); return result; }
    catch (error) { progress({ phase: 'error', message: controller.signal.aborted ? '已取消' : error.message, progress: 0 }); throw Error(controller.signal.aborted ? '已取消' : error.message); }
    finally { active = undefined; }
  }
  async function installOne(target, build, signal) {
    if (await installed(target, true)) return;
    const stage = target + '-staging-' + crypto.randomUUID();
    try {
      await fsp.mkdir(stage, { recursive: true }); await build(stage); signal.throwIfAborted(); await manifest(stage);
      // Only app-owned, validated siblings can be replaced.
      if (!inside(base, target) || !inside(base, stage)) throw Error('无效安装目录');
      if (await exists(target)) await fsp.rm(target, { recursive: true, force: true });
      await fsp.rename(stage, target);
    } finally { if (inside(base, stage)) await fsp.rm(stage, { recursive: true, force: true }); }
  }
  const install = (id, progress) => operation(progress, async (signal, emit) => {
    if (!Object.hasOwn(MODELS, id)) throw Error('未知模型');
    await installOne(runtime, async stage => {
      for (const pkg of [RUNTIME, native]) {
        const archive = await download(packageFile(pkg), path.join(base, 'downloads'), emit, signal);
        emit({ phase: 'installing', message: `安装 ${pkg.name}`, progress: 0 });
        await extract(archive, path.join(stage, pkg.name), false, signal);
      }
    }, signal);
    await installOne(modelPath(id), async stage => {
      for (const spec of MODELS[id].files) {
        const source = await download(spec, path.join(base, 'downloads'), emit, signal);
        emit({ phase: 'installing', message: '安装模型到本机', progress: 0 });
        if (id === 'tts-zh') await extract(source, stage, true, signal);
        else await fsp.copyFile(source, path.join(stage, spec.name));
      }
    }, signal);
    return status();
  });
  async function ready(id) {
    if (!await installed(runtime, true) || !await installed(modelPath(id), true)) throw Error('组件未安装或完整性检查失败，请点击下载安装/修复');
  }
  function childJob(data, signal, emit) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = fork(__filename, ['--freecut-ai-worker'], { silent: true, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DYLD_LIBRARY_PATH: native ? path.join(runtime, native.name) : '' } });
      let stderr = ''; let result; let workerError;
      const stop = () => child.kill();
      signal.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(() => { workerError = 'AI 处理超过 30 分钟，请缩短片段后重试'; child.kill(); }, 1800000);
      child.stderr.on('data', part => { stderr = (stderr + part).slice(-3000); });
      child.stdout.resume();
      child.on('message', msg => { if (msg.type === 'progress') emit(msg.value); if (msg.type === 'result') result = msg.value; if (msg.type === 'error') workerError = msg.message; });
      child.on('error', error => { workerError = error.message; });
      child.on('close', code => { clearTimeout(timer); signal.removeEventListener('abort', stop); if (signal.aborted) reject(Error('已取消')); else if (code === 0 && result !== undefined) resolve(result); else reject(Error(workerError || `AI 引擎退出（${code}）：${stderr.slice(-500)}`)); });
      child.send({ ...data, runtime: path.join(runtime, RUNTIME.name), modelDir: modelPath(data.modelId) });
    });
  }
  function convert(input, output, start, duration, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(start), '-i', input, '-t', String(duration), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], { windowsHide: true, shell: false });
      let error = ''; const stop = () => proc.kill(); signal.addEventListener('abort', stop, { once: true });
      proc.stderr.on('data', x => { error = (error + x).slice(-2000); });
      proc.on('error', reject); proc.on('close', code => { signal.removeEventListener('abort', stop); code === 0 ? resolve() : reject(Error(signal.aborted ? '已取消' : '无法读取音轨：' + error)); });
    });
  }
  const transcribe = (request, progress) => operation(progress, async (signal, emit) => {
    const { inPoint, duration, language } = request || {};
    const modelId = request?.modelId || 'asr-zh-en';
    if (!['asr-sensevoice', 'asr-zh-en'].includes(modelId)) throw Error('未知识别模型');
    if (typeof request?.path !== 'string' || !Number.isFinite(inPoint) || inPoint < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 3600 || !['auto', 'zh', 'en'].includes(language)) throw Error('请选择 1 小时以内且含音轨的片段');
    const source = await validateMediaPath(request.path);
    await ready(modelId);
    const work = path.join(base, 'jobs', crypto.randomUUID()); await fsp.mkdir(work, { recursive: true });
    try {
      const wav = path.join(work, 'input.wav'); emit({ phase: 'processing', message: '提取片段音轨', progress: 0 });
      await convert(source, wav, inPoint, duration, signal);
      return await childJob({ type: 'asr', modelId, wav, language }, signal, emit);
    } finally { if (inside(base, work)) await fsp.rm(work, { recursive: true, force: true }); }
  });
  const speak = (request, progress) => operation(progress, async (signal, emit) => {
    const { text, speakerId, speed } = request || {};
    if (typeof text !== 'string' || !text.trim() || text.length > 3000 || !Number.isInteger(speakerId) || speakerId < 0 || speakerId > 173 || !Number.isFinite(speed) || speed < 0.5 || speed > 2) throw Error('请输入 1 至 3000 字，音色 0 至 173，速度 0.5 至 2 倍');
    await ready('tts-zh'); const folder = path.join(base, 'speech'); await fsp.mkdir(folder, { recursive: true });
    const output = path.join(folder, '朗读-' + crypto.randomUUID() + '.wav');
    try { await childJob({ type: 'tts', modelId: 'tts-zh', text: text.trim(), speakerId, speed, output }, signal, emit); signal.throwIfAborted(); return await importPath(output); }
    catch (error) { await fsp.rm(output, { force: true }); throw error; }
  });
  return { status, install, transcribe, speak, cancel: () => { active?.abort(); } };
}

function registerAI({ ipcMain, validateSender, ...options }) {
  const service = createAIService(options);
  options.app.on?.('before-quit', () => service.cancel());
  const handler = (channel, fn) => ipcMain.handle(channel, async (event, data) => {
    if (typeof validateSender !== 'function') throw Error('AI IPC 发送方校验未配置');
    validateSender(event);
    return fn(data, progress => { if (!event.sender.isDestroyed()) event.sender.send('freecut:ai-progress', progress); });
  });
  handler('freecut:ai-status', () => service.status());
  handler('freecut:ai-install', (r, emit) => service.install(r?.modelId, emit));
  handler('freecut:ai-transcribe', (r, emit) => service.transcribe(r, emit));
  handler('freecut:ai-speak', (r, emit) => service.speak(r, emit));
  handler('freecut:ai-cancel', () => service.cancel());
  return service;
}

async function worker(request) {
  const sherpa = require(request.runtime);
  const p = name => path.join(request.modelDir, name);
  const progress = (message, value) => process.send({ type: 'progress', value: { phase: 'processing', message, progress: value } });
  if (request.type === 'tts') {
    progress('加载中文语音模型', 0);
    const tts = new sherpa.OfflineTts({ model: { vits: { model: p('model.onnx'), tokens: p('tokens.txt'), lexicon: p('lexicon.txt') }, numThreads: 2, provider: 'cpu', debug: false }, maxNumSentences: 1,
      ruleFsts: ['date.fst', 'phone.fst', 'number.fst', 'new_heteronym.fst'].map(p).join(','), ruleFars: p('rule.far') });
    // Electron's V8 memory cage cannot accept native external ArrayBuffers.
    const audio = await tts.generateAsync({ text: request.text, sid: request.speakerId, speed: request.speed, enableExternalBuffer: false, onProgress: info => progress('正在生成朗读音频', info.progress) });
    if (!audio.samples.length) throw Error('模型没有生成音频，请检查输入文本');
    sherpa.writeWave(request.output, { samples: audio.samples, sampleRate: audio.sampleRate });
    return { duration: audio.samples.length / audio.sampleRate };
  }
  progress('加载中英字幕模型', 0);
  const modelConfig = request.modelId === 'asr-sensevoice'
    ? { senseVoice: { model: p('model.int8.onnx'), language: request.language, useInverseTextNormalization: 1 }, tokens: p('tokens.txt') }
    : { whisper: { encoder: p('tiny-encoder.int8.onnx'), decoder: p('tiny-decoder.int8.onnx'), language: request.language === 'auto' ? '' : request.language, task: 'transcribe' }, tokens: p('tiny-tokens.txt') };
  const recognizer = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { ...modelConfig, numThreads: 2, provider: 'cpu', debug: false } });
  const wave = sherpa.readWave(request.wav, false); const rate = wave.sampleRate; const items = [];
  // Energy-based utterance windows; honest coarse sentence timing, no fabricated word timestamps.
  const spans = speechSpans(wave.samples, rate);
  for (let i = 0; i < spans.length; i++) {
    const { start, end } = spans[i]; const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: rate, samples: wave.samples.slice(start, end) }); recognizer.decode(stream);
    const result = recognizer.getResult(stream); const text = (result.text || '').replace(/<\|.*?\|>/g, '').trim();
    if (text) items.push({ start: start / rate, duration: (end - start) / rate, text });
    progress(`识别语句 ${i + 1} / ${spans.length}`, (i + 1) / spans.length);
  }
  return { items, timing: 'energy-segments' };
}
function speechSpans(samples, rate) {
  const frame = Math.floor(rate * 0.02); const energies = [];
  for (let start = 0; start < samples.length; start += frame) { let sum = 0; const end = Math.min(samples.length, start + frame); for (let j = start; j < end; j++) sum += samples[j] * samples[j]; energies.push(Math.sqrt(sum / (end - start))); }
  let max = 0; for (const v of energies) max = Math.max(max, v);
  const threshold = Math.max(0.003, max * 0.035); const spans = []; let begin = -1; let last = -1; let previousEnd = 0;
  for (let i = 0; i <= energies.length; i++) {
    const voiced = i < energies.length && energies[i] > threshold;
    if (voiced) { if (begin < 0) begin = Math.max(Math.ceil(previousEnd / frame), i - 8); last = i; }
    const capped = begin >= 0 && i - begin >= 600;
    if (begin >= 0 && (i === energies.length || i - last > 25 || capped)) {
      const end = Math.min(samples.length, capped ? i * frame : (last + 10) * frame);
      if (end - begin * frame > rate * 0.2) spans.push({ start: begin * frame, end });
      previousEnd = end;
      begin = capped && voiced ? i : -1;
      if (begin < 0) last = -1;
    }
  }
  return spans;
}

module.exports = { registerAI, createAIService, MODELS, NATIVE, verifyFile, extract, speechSpans };
if (process.argv.includes('--freecut-ai-worker') && process.send) process.once('message', request => worker(request).then(value => { process.send({ type: 'result', value }, () => process.exit(0)); }).catch(error => { process.send({ type: 'error', message: error.message }, () => process.exit(1)); }));
