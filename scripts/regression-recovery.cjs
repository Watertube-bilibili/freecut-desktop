'use strict';
// Run after npm run build. Real Electron, isolated profile, fixture-only project.
// Abrupt termination models loss of the process without a successful close/save.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');

main().catch(error => { console.error(error); process.exitCode = 1; });

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'freecut-recovery-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const projectFile = path.join(directory, 'original.freecut');
  const mediaFile = path.join(directory, 'fixture.mp4');
  const savedFile = path.join(directory, 'recovered.freecut');
  const outputFile = path.join(directory, 'recovered.mp4');
  const ffmpeg = path.join(root, 'resources', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mediaFile], { windowsHide: true, stdio: 'pipe' });
  const canonicalMedia = await fs.realpath(mediaFile);
  const project = {
    version: 1, id: crypto.randomUUID(), name: '恢复测试原稿', width: 320, height: 180, fps: 24, background: '#101014',
    assets: [{ id: 'video-fixture', name: 'fixture.mp4', kind: 'video', path: canonicalMedia, duration: 2, width: 320, height: 180, url: '' }],
    tracks: [{ id: 'video', name: '画面', kind: 'video', muted: false, hidden: false, locked: false }],
    clips: [{ id: crypto.randomUUID(), name: '测试素材', kind: 'video', assetId: 'video-fixture', trackId: 'video', start: 0, duration: 2, inPoint: 0, speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 }, keyframes: {}, fadeIn: 0, fadeOut: 0,
      effects: { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, grayscale: 0, sepia: 0, vignette: 0, pixelate: 0, chroma: false, chromaColor: '#00ff00', chromaThreshold: 80, flipX: false, flipY: false, mask: 'none', maskSize: 1 } }],
  };
  const original = JSON.stringify(project, null, 2);
  await fs.writeFile(projectFile, original);
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(bootstrap, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`);
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  const report = { directory, checks: [], errors: [], screenshots: [], passed: false };
  let app, page;
  async function launch() {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 950 });
    await app.evaluate(({ app, dialog }, data) => {
      if (app.getPath('userData') !== data.profile) throw Error('Test profile mismatch');
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [data.projectFile] });
      dialog.showSaveDialog = async () => ({ canceled: true });
      dialog.showMessageBox = async () => ({ response: 2 });
    }, { profile, projectFile });
    await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
  }
  async function terminate() {
    if (!app) return;
    const current = app;
    app = null;
    await current.evaluate(() => process.exit(0)).catch(() => {});
    await current.close().catch(() => {});
  }
  async function check(name, work) {
    console.log(`RUN: ${name}`);
    await work();
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  }
  const list = () => page.evaluate(() => window.freecut.recovery.list());
  const dirty = () => expect(page.locator('.local-badge')).toHaveText('未保存');
  const dialog = () => page.getByRole('dialog', { name: '保存未完成的修改', exact: true });
  try {
    await launch();
    await check('autosave creates revisions without marking edits manually saved', async () => {
      await page.getByRole('button', { name: '打开项目', exact: true }).click();
      await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue(project.name);
      const skip = page.getByRole('button', { name: '跳过引导', exact: true });
      if (await skip.isVisible()) await skip.click();
      await page.getByLabel('工程名称', { exact: true }).fill('恢复测试版本一');
      await expect.poll(async () => (await list()).entries.some(entry => entry.name === '恢复测试版本一'), { timeout: 18000 }).toBe(true);
      await dirty();
      await page.getByLabel('工程名称', { exact: true }).fill('恢复测试版本二');
      await expect.poll(async () => (await list()).entries.some(entry => entry.name === '恢复测试版本二'), { timeout: 18000 }).toBe(true);
      await dirty();
      assert.equal(await fs.readFile(projectFile, 'utf8'), original);
    });
    await terminate();
    await launch();
    await check('a new process lists older versions and restores the selected draft', async () => {
      const panel = page.getByRole('region', { name: '恢复记录', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.locator('.recovery-entry')).toHaveCount(2);
      const first = panel.locator('.recovery-entry').filter({ hasText: '恢复测试版本一' });
      await first.getByRole('button', { name: '恢复', exact: true }).click();
      await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue('恢复测试版本一');
      await dirty();
      assert.equal((await list()).entries.length, 2);
    });
    await check('restoring another revision respects Cancel and Save-dialog cancellation', async () => {
      await page.getByRole('button', { name: '历史备份', exact: true }).click();
      const history = page.getByRole('dialog', { name: '历史备份', exact: true });
      for (const viewport of [{ width: 1440, height: 950 }, { width: 1100, height: 620 }]) {
        await page.setViewportSize(viewport);
        await expect(history).toBeVisible();
        const image = path.join(directory, `recovery-modal-${viewport.width}.png`);
        await page.screenshot({ path: image, fullPage: true });
        report.screenshots.push(image);
      }
      await page.setViewportSize({ width: 1440, height: 950 });
      const second = history.locator('.recovery-entry').filter({ hasText: '恢复测试版本二' });
      await second.getByRole('button', { name: '恢复', exact: true }).click();
      await expect(dialog()).toBeVisible();
      await dialog().getByRole('button', { name: '取消', exact: true }).click();
      await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue('恢复测试版本一');
      await second.getByRole('button', { name: '恢复', exact: true }).click();
      await dialog().getByRole('button', { name: '保存并继续', exact: true }).click();
      await expect(dialog()).toBeVisible();
      await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue('恢复测试版本一');
      await dialog().getByRole('button', { name: '取消', exact: true }).click();
      await history.getByRole('button', { name: '关闭历史备份', exact: true }).click();
      assert.equal(await fs.readFile(projectFile, 'utf8'), original);
    });
    await check('restored media is authorized, exports to MP4, and saves with the existing project format', async () => {
      const before = (await list()).entries.map(entry => entry.id);
      const restored = await page.evaluate(async () => {
        const { entries } = await window.freecut.recovery.list();
        const project = await window.freecut.recovery.restore(entries.find(entry => entry.name === '恢复测试版本一').id);
        const response = await fetch(project.assets[0].url, { headers: { Range: 'bytes=0-43' } });
        return { project, status: response.status, bytes: (await response.arrayBuffer()).byteLength };
      });
      assert.equal(restored.status, 206);
      assert.equal(restored.bytes, 44);
      assert.equal(restored.project.assets[0].missing, false);
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, outputFile);
      const exported = await page.evaluate(async project => {
        const api = window.freecut;
        const job = await api.beginExport({ project, width: 320, height: 180, fps: 24, duration: 2, quality: 'high', format: 'mp4', pipeline: 'auto' });
        if (!job || job.pipeline !== 'native') throw Error('Expected native export for the fixture');
        return api.finishExport(job.jobId);
      }, restored.project);
      assert.equal(exported.path, outputFile);
      assert.ok((await fs.stat(outputFile)).size > 1000);
      execFileSync(ffmpeg, ['-v', 'error', '-i', outputFile, '-f', 'null', '-'], { windowsHide: true, stdio: 'pipe' });
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, savedFile);
      await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
      await expect(page.locator('.local-badge')).toHaveText('已保存');
      const saved = JSON.parse(await fs.readFile(savedFile, 'utf8'));
      assert.equal(saved.version, 1);
      assert.equal(saved.assets[0].path, canonicalMedia);
      assert.equal(saved.assets[0].url, '');
      assert.equal(saved.name, '恢复测试版本一');
      const after = (await list()).entries.map(entry => entry.id);
      for (const id of before) assert.ok(after.includes(id), 'manual save removed an older recovery copy');
      assert.equal(await fs.readFile(projectFile, 'utf8'), original);
      await page.getByLabel('工程名称', { exact: true }).fill('恢复测试放弃编辑');
    });
    await check('explicit deletion removes only the selected revision; normal discard retains history', async () => {
      await page.getByTitle('返回首页', { exact: true }).click();
      await dialog().getByRole('button', { name: '不保存并继续', exact: true }).click();
      await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
      const before = await list();
      assert.ok(before.entries.length >= 2);
      const panel = page.getByRole('region', { name: '恢复记录', exact: true });
      const entry = panel.locator('.recovery-entry').filter({ hasText: '恢复测试版本二' });
      await entry.getByRole('button', { name: '删除 恢复测试版本二 的此恢复副本', exact: true }).click();
      await entry.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal((await list()).entries.length, before.entries.length);
      await entry.getByRole('button', { name: '删除 恢复测试版本二 的此恢复副本', exact: true }).click();
      await entry.getByRole('button', { name: '删除副本', exact: true }).click();
      await expect.poll(async () => (await list()).entries.length).toBe(before.entries.length - 1);
      assert.equal(await fs.readFile(projectFile, 'utf8'), original);
      const image = path.join(directory, 'recovery-home.png');
      await page.screenshot({ path: image, fullPage: true });
      report.screenshots.push(image);
    });
    await check('cache panel cancellation, keyboard access and persisted preview preference', async () => {
      await page.getByRole('button', { name: '打开项目', exact: true }).click();
      await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue(project.name);
      await page.getByTitle('流畅预览与缓存', { exact: true }).click();
      const cache = page.getByRole('dialog', { name: '代理与媒体缓存', exact: true });
      await expect(cache).toBeVisible();
      const toggle = cache.getByRole('checkbox', { name: /流畅预览/ });
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      const close = cache.getByRole('button', { name: '关闭', exact: true });
      const clear = cache.getByRole('button', { name: '清理媒体缓存', exact: true });
      await expect(clear).toBeEnabled();
      await close.focus(); await page.keyboard.press('Shift+Tab'); await expect(clear).toBeFocused();
      await page.keyboard.press('Tab'); await expect(close).toBeFocused();
      await page.keyboard.press('Tab'); await expect(toggle).toBeFocused();
      const before = await cache.locator('.media-cache-storage code').innerText();
      await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
      const choose = cache.getByRole('button', { name: '更换缓存位置', exact: true });
      await choose.click();
      await expect(choose).toBeEnabled();
      await expect(cache.locator('.media-cache-storage code')).toHaveText(before);
      await expect(cache.getByRole('alert')).toHaveCount(0);
      await page.setViewportSize({ width: 1100, height: 620 });
      await clear.scrollIntoViewIfNeeded();
      const bounds = await clear.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 620, 'cache actions cannot be reached at a short viewport');
      const image = path.join(directory, 'media-cache-1100.png');
      await page.screenshot({ path: image, fullPage: true });
      report.screenshots.push(image);
      await page.keyboard.press('Escape');
      await expect(cache).toBeHidden();
      await page.reload();
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, projectFile);
      await page.getByRole('button', { name: '打开项目', exact: true }).click();
      await page.getByTitle('流畅预览与缓存', { exact: true }).click();
      await expect(cache.getByRole('checkbox', { name: /流畅预览/ })).not.toBeChecked();
      await page.keyboard.press('Escape');
      await page.getByTitle('返回首页', { exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 950 });
      assert.equal(await fs.readFile(projectFile, 'utf8'), original);
    });
    await check('recovery history uses the saved English interface language', async () => {
      await page.evaluate(() => localStorage.setItem('freecut-language', 'en'));
      await page.reload();
      const panel = page.getByRole('region', { name: 'Recovery history', exact: true });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Restore', exact: true }).first()).toBeVisible();
      await expect(panel).toContainText('Edits are copied automatically.');
      const image = path.join(directory, 'recovery-home-en.png');
      await page.screenshot({ path: image, fullPage: true });
      report.screenshots.push(image);
    });
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } finally {
    await terminate();
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    const artifacts = path.join(root, 'artifacts', 'recovery');
    await fs.mkdir(artifacts, { recursive: true });
    report.artifactScreenshots = [];
    for (const source of report.screenshots) {
      const destination = path.join(artifacts, path.basename(source));
      await fs.copyFile(source, destination);
      report.artifactScreenshots.push(destination);
    }
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
