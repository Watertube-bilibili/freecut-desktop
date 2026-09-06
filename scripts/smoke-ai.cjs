'use strict';
// Real inference smoke test. Network is OFF unless --download is explicitly set.
// node scripts/smoke-ai.cjs --data-dir <directory containing ai/> --english <wav> --chinese <wav>
// node scripts/smoke-ai.cjs --download [--data-dir <cache directory>]
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

if (!process.versions.electron) {
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('close', code => { process.exitCode = code === 0 ? 0 : 1; });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const args = process.argv.slice(2);
  const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--help')) { console.log('Usage: node scripts/smoke-ai.cjs [--download] [--data-dir DIR] [--english WAV] [--chinese WAV]\nNo network without --download. Uses the actual installed Electron runtime and project FFmpeg.'); return; }
  const allowDownload = args.includes('--download');
  const dataDir = path.resolve(arg('--data-dir') || path.join(os.tmpdir(), 'freecut-ai-smoke'));
  const fixtureDir = path.join(dataDir, 'smoke-fixtures');
  await fs.mkdir(fixtureDir, { recursive: true });
  const { createAIService, verifyFile } = require('../electron/ai.cjs');
  const engine = path.join(dataDir, 'ai', `runtime-1.13.7-${process.platform}-${process.arch}`, 'sherpa-onnx-node');
  const ffmpegPath = path.resolve(__dirname, '../resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  await fs.access(ffmpegPath).catch(() => { throw Error('Run npm run prepare:ffmpeg before this test.'); });
  const authorized = new Set();
  const service = createAIService({
    app: { getPath: () => dataDir }, ffmpegPath,
    validateMediaPath: filename => { if (!authorized.has(filename)) throw Error('Input is not authorized by this test'); return filename; },
    importPath: async filename => {
      const sherpa = require(engine); const wave = sherpa.readWave(filename, false);
      authorized.add(filename);
      return { id: crypto.randomUUID(), name: path.basename(filename), kind: 'audio', url: filename, path: filename, duration: wave.samples.length / wave.sampleRate };
    },
  });
  let previous = '';
  const progress = info => { const key = `${info.phase}:${info.message}:${Math.floor(info.progress * 10)}`; if (key !== previous) { previous = key; console.log(JSON.stringify(info)); } };
  if (allowDownload) for (const modelId of ['tts-zh', 'asr-sensevoice', 'asr-zh-en']) await service.install(modelId, progress);
  const status = await service.status();
  if (!status.runtimeReady || status.models.some(model => !model.installed)) throw Error('Required models are missing. Supply a complete --data-dir, or explicitly use --download (about 375 MB model downloads plus native engine).');
  const fixtures = [
    { key: '--english', name: 'english.wav', url: 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny/resolve/65176e2deb88badc814a94058666cadccc29b61c/test_wavs/0.wav', size: 212044, sha256: '6bc58a4efdf20daac252b6b1502632601a71efe0308f6757dc1eda34891a7e4f', language: 'en' },
    { key: '--chinese', name: 'chinese.wav', url: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/test_wavs/zh.wav', size: 178988, sha256: 'b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373', language: 'zh' },
  ];
  for (const fixture of fixtures) {
    fixture.path = path.resolve(arg(fixture.key) || path.join(fixtureDir, fixture.name));
    if (!await verifyFile(fixture.path, fixture)) {
      if (!allowDownload || arg(fixture.key)) throw Error(`Missing or incorrect pinned fixture ${fixture.name}. Supply ${fixture.key} PATH, or explicitly enable --download.`);
      await fetchFixture(fixture);
    }
    authorized.add(fixture.path);
  }
  const start = Date.now();
  const tts = await service.speak({ text: '今天是星期天。我们正在测试自动字幕和语音朗读功能。', speakerId: 88, speed: 1 }, progress);
  assert(tts.duration > 1 && (await fs.stat(tts.path)).size > 10000);
  const results = {};
  for (const modelId of ['asr-sensevoice', 'asr-zh-en']) for (const fixture of fixtures) {
    const result = await service.transcribe({ modelId, path: fixture.path, inPoint: 0, duration: fixture.language === 'en' ? 7 : 6, language: fixture.language }, progress);
    assert(result.items.length > 0);
    assert(result.items.every(item => Number.isFinite(item.start) && item.duration > 0 && item.text.trim()));
    if (fixture.language === 'en') assert(result.items.some(item => item.text.toLowerCase().includes('yellow lamps')));
    results[`${modelId}-${fixture.language}`] = result;
  }
  const cancellation = service.speak({ text: '正在测试取消处理。'.repeat(80), speakerId: 88, speed: 1 }, info => { if (info.message === '加载中文语音模型') setTimeout(() => service.cancel(), 100); });
  await assert.rejects(cancellation, /已取消/); assert.equal((await service.status()).busy, false);
  const report = { testedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, electron: process.versions.electron, node: process.versions.node, elapsedMs: Date.now() - start, networkAllowed: allowDownload, tts, results, nativeCancellation: true };
  const output = path.join(dataDir, 'smoke-ai-result.json'); await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(`PASS: real Electron TTS + SenseVoice/Whisper Chinese/English + cancellation\nReport: ${output}`);
}

async function fetchFixture(spec) {
  let url = spec.url;
  const allowed = new Set(['huggingface.co', 'us.aws.cdn.hf.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co']);
  for (let redirects = 0; redirects < 7; redirects++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !allowed.has(parsed.hostname)) throw Error('Unexpected test fixture download host');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get('location'), url).href; continue; }
    if (!response.ok) throw Error(`Fixture HTTP ${response.status}`);
    let size = 0; const chunks = [];
    for await (const chunk of response.body) { size += chunk.length; if (size > spec.size) throw Error('Fixture size limit exceeded'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, spec.size); assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), spec.sha256);
    await fs.writeFile(spec.path, bytes); return;
  }
  throw Error('Too many fixture redirects');
}
