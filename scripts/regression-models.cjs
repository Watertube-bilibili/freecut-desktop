'use strict';

// Real packaged-app SenseVoice regression. No downloads. Reuses a verified QA
// model cache through file hard links in an isolated profile; never changes the
// supplied cache. Native media selection is redirected to the supplied fixture.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (args.includes('--help')) {
  console.log('node scripts/regression-models.cjs --exe APP --data-dir EXISTING_QA_DATA --chinese CHINESE_WAV [--cached-install] [--expect-failure]\nNo downloads. --cached-install verifies the full installation using cached official archives. Alternatively use FREECUT_MODEL_EXE, FREECUT_MODEL_DATA_DIR and FREECUT_MODEL_CHINESE. Report is written below .cache/.');
} else main().catch(error => { console.error(error); process.exitCode = 1; });

async function main() {
  const executable = option('--exe') || process.env.FREECUT_MODEL_EXE;
  const data = option('--data-dir') || process.env.FREECUT_MODEL_DATA_DIR;
  const fixture = option('--chinese') || process.env.FREECUT_MODEL_CHINESE;
  if (!executable || !data || !fixture) throw Error('Supply --exe, --data-dir and --chinese; this test never downloads missing models.');
  const appExe = path.resolve(executable), source = path.resolve(data), chinese = path.resolve(fixture);
  const directory = await fs.mkdtemp(path.join(root, '.cache', 'models-packaged-中文-'));
  const profile = path.join(directory, process.platform === 'win32' ? 'FreeCutData' : 'profile');
  const cache = path.join(profile, 'ai');
  const report = { startedAt: new Date().toISOString(), executable: appExe, directory, profile, networkAllowed: false, passed: false };
  let app;
  async function copyTree(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      const input = path.join(from, entry.name), output = path.join(to, entry.name);
      if (entry.isDirectory()) await copyTree(input, output);
      else if (entry.isFile()) await fs.link(input, output).catch(async error => {
        if (error.code !== 'EXDEV') throw error;
        await fs.copyFile(input, output);
      });
      else throw Error('QA cache contains an unexpected link or special file.');
    }
  }
  try {
    if (args.includes('--cached-install')) {
      const { MODELS, NATIVE } = require('../electron/ai.cjs');
      const nativeName = NATIVE[`${process.platform}-${process.arch}`]?.name;
      if (!nativeName) throw Error('Unsupported test platform');
      const specs = [...MODELS['asr-sensevoice'].files, ...['sherpa-onnx-node', nativeName].map(name => ({ name: `${name}.tgz`, url: `https://registry.npmjs.org/${name}/-/${name}-1.13.7.tgz` }))];
      await fs.mkdir(path.join(cache, 'downloads'), { recursive: true });
      for (const spec of specs) {
        const name = `${crypto.createHash('sha256').update(spec.url).digest('hex').slice(0, 20)}-${spec.name}`;
        const from = path.join(source, 'ai', 'downloads', name), to = path.join(cache, 'downloads', name);
        await fs.link(from, to).catch(async error => { if (error.code !== 'EXDEV') throw error; await fs.copyFile(from, to); });
      }
    } else for (const folder of [`runtime-1.13.7-${process.platform}-${process.arch}`, 'asr-sensevoice-v1']) await copyTree(path.join(source, 'ai', folder), path.join(cache, folder));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_DIR;
    if (process.platform === 'win32') env.PORTABLE_EXECUTABLE_DIR = directory;
    app = await _electron.launch({ executablePath: appExe, args: [`--user-data-dir=${profile}`], env, timeout: 30000 });
    report.runtime = await app.evaluate(({ app }) => ({ electron: process.versions.electron, node: process.versions.node, packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData') }));
    assert.equal(report.runtime.packaged, true, 'This regression must exercise a packaged application');
    assert(report.runtime.appPath.includes('.asar'), 'The application code must run from ASAR');
    assert.equal(await fs.realpath(report.runtime.userData), await fs.realpath(profile));
    await app.evaluate(({ dialog }, fixturePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] }); }, chinese);
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.freecut));
    if (args.includes('--cached-install')) {
      await app.evaluate(() => { globalThis.fetch = async () => { throw Error('Network disabled by offline model installation regression'); }; });
      report.beforeInstall = await page.evaluate(() => window.freecut.aiStatus());
      assert.equal(report.beforeInstall.runtimeReady, false);
      assert.equal(report.beforeInstall.models.find(model => model.id === 'asr-sensevoice').installed, false);
      report.installation = await page.evaluate(async () => {
        const progress = [], unsubscribe = window.freecut.onAIProgress(info => progress.push(info));
        try { const status = await window.freecut.aiInstall({ modelId: 'asr-sensevoice' }); return { ok: true, status, progress }; }
        catch (error) { return { ok: false, error: error.message, progress }; }
        finally { unsubscribe(); }
      });
      console.log(JSON.stringify({ installation: report.installation }, null, 2));
      assert.equal(report.installation.ok, true, report.installation.error);
    }
    report.status = await page.evaluate(() => window.freecut.aiStatus());
    assert.equal(report.status.runtimeReady, true);
    assert.equal(report.status.models.find(model => model.id === 'asr-sensevoice').installed, true);
    report.result = await page.evaluate(async () => {
      const progress = [];
      const unsubscribe = window.freecut.onAIProgress(info => progress.push(info));
      const started = Date.now();
      try {
        const [asset] = await window.freecut.importMedia();
        if (!asset) throw Error('Fixture import failed');
        const value = await window.freecut.aiTranscribe({ assetId: asset.id, path: asset.path, inPoint: 0, duration: asset.duration, language: 'zh', modelId: 'asr-sensevoice' });
        return { ok: true, value, progress, elapsedMs: Date.now() - started };
      } catch (error) { return { ok: false, error: error.message, progress, elapsedMs: Date.now() - started }; }
      finally { unsubscribe(); }
    });
    console.log(JSON.stringify(report.result, null, 2));
    if (args.includes('--expect-failure')) assert.equal(report.result.ok, false, 'Original packaged app should reproduce the reported failure');
    else {
      assert.equal(report.result.ok, true, report.result.error);
      const text = report.result.value.items.map(item => item.text).join('');
      assert.match(text, /开放时间.*早上.*下午/);
      assert(report.result.value.items.every(item => Number.isFinite(item.start) && item.duration > 0));
    }
    report.passed = true;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    report.finishedAt = new Date().toISOString();
    const file = path.join(directory, 'model-regression-result.json');
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    console.log(`REPORT: ${file}`);
  }
}
