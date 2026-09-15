'use strict';
// Offline integration with an existing, isolated ChatTTS QA installation.
// node scripts/smoke-voice-storage.cjs --data-dir QA_PROFILE --out-dir NEW_FOLDER
// Models are copied and verified, never downloaded. The default location is
// restored in finally. Do not point this at a running application's profile.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

if (!process.versions.electron) {
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('close', code => { process.exitCode = code === 0 ? 0 : 1; });
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

async function main() {
  const args = process.argv.slice(2);
  const value = key => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  assert(value('--data-dir') && value('--out-dir'), 'Explicit QA profile and new output folder are required');
  const userData = await fs.realpath(path.resolve(value('--data-dir')));
  const output = path.resolve(value('--out-dir'));
  assert.equal(await fs.lstat(output).catch(() => null), null, 'Output must be a new directory');
  const { createVoiceModelStorage } = require('../electron/voice-storage.cjs');
  const { createChatTTS, VERSION } = require('../electron/chattts.cjs');
  const { createMediaLibrary } = require('../electron/media.cjs');
  const storage = createVoiceModelStorage({ userData });
  assert.equal(storage.status().custom, false, 'Use a QA profile with the default model location');
  const ffmpeg = path.resolve(__dirname, '../resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const media = createMediaLibrary(ffmpeg);
  const engine = createChatTTS({ userData, voiceStorage: storage, importPath: media.importPath });
  assert.equal((await engine.status()).ready, true, 'Existing verified ChatTTS models and runtime required; this test never downloads');
  const legacy = path.resolve(userData, 'ai', VERSION, 'models');
  assert.equal(storage.modelPath('chattts'), legacy);
  const retained = legacy + '.qa-retained-' + crypto.randomUUID();
  // Verify both absolute rename targets are direct children of this QA runtime.
  assert.equal(path.dirname(legacy), path.resolve(userData, 'ai', VERSION));
  assert.equal(path.dirname(retained), path.dirname(legacy));
  const marker = await fs.readFile(path.join(userData, 'ai', VERSION, 'ready.json'));
  const oldOutputs = await fs.readdir(path.join(userData, 'ai', VERSION, 'outputs'));
  const oldWav = oldOutputs.find(name => name.endsWith('.wav'));
  const oldBytes = oldWav ? await fs.readFile(path.join(userData, 'ai', VERSION, 'outputs', oldWav)) : null;
  const report = { version: require('../package.json').version, testedAt: new Date().toISOString(), platform: process.platform,
    electron: process.versions.electron, networkAllowed: false, checks: [], passed: false };
  let moved = false, restartedStorage, restartedEngine;
  await fs.mkdir(output, { recursive: false });
  try {
    await fs.mkdir(path.join(output, '朗读 Models'));
    const started = Date.now();
    await storage.choose(path.join(output, '朗读 Models'));
    report.migrationMs = Date.now() - started;
    assert.equal(storage.status().custom, true);
    report.checks.push('Existing model files copied and verified into a Unicode/space path');
    restartedStorage = createVoiceModelStorage({ userData });
    assert.equal(restartedStorage.status().path, storage.status().path);
    report.checks.push('A new storage instance restores the selected path from disk');
    // Make the old model path unavailable temporarily, proving synthesis uses
    // the selected folder. This is an explicit QA installation, not user data.
    await fs.rename(legacy, retained); moved = true;
    restartedEngine = createChatTTS({ userData, voiceStorage: restartedStorage, importPath: media.importPath });
    assert.equal((await restartedEngine.status()).ready, true);
    const inferenceStart = Date.now();
    const asset = await restartedEngine.generate({ text: '你好，模型目录切换成功。', seed: 42, speed: 5 });
    assert.equal(asset.kind, 'audio'); assert(asset.duration > .1 && asset.duration < 30);
    assert.equal(path.dirname(asset.path), path.join(userData, 'ai', VERSION, 'outputs'));
    const bytes = await fs.readFile(asset.path);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert(bytes.length > 4844);
    let peak = 0, samples = 0;
    for (let cursor = 12; cursor + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(cursor + 4), start = cursor + 8;
      assert(start + size <= bytes.length, 'WAV chunk is truncated');
      if (bytes.toString('ascii', cursor, cursor + 4) === 'data') {
        for (let offset = start; offset + 1 < start + size; offset += 2) {
          peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset) / 32768)); samples++;
        }
      }
      cursor = start + size + size % 2;
    }
    assert(samples > 2400 && peak > .001, 'Generated PCM audio must not be silent');
    report.inferenceMs = Date.now() - inferenceStart;
    report.audio = { duration: asset.duration, bytes: bytes.length, peak, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    report.checks.push('Real ChatTTS synthesis and FFmpeg import succeed while the former model path is unavailable');
    assert.deepEqual(await fs.readFile(path.join(userData, 'ai', VERSION, 'ready.json')), marker);
    if (oldWav) assert.deepEqual(await fs.readFile(path.join(userData, 'ai', VERSION, 'outputs', oldWav)), oldBytes);
    report.checks.push('Existing runtime marker and previously generated audio are unchanged');
    report.speechContentVerified = false;
  } finally {
    await restartedEngine?.dispose(); await engine.dispose();
    if (moved) await fs.rename(retained, legacy);
    await (restartedStorage || storage).reset();
    assert.equal(createVoiceModelStorage({ userData }).status().custom, false);
    report.checks.push('Default location restored, original models retained');
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
  report.passed = true;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
