'use strict';
// End-to-end test against the actual Electron app. All media are generated locally.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
async function run() {
  const root = path.resolve(__dirname, '..'),
    dir = path.join(root, 'artifacts', 'smoke');
  await fs.mkdir(dir, { recursive: true });
  const sample = path.join(dir, '测试素材.mp4'),
    output = path.join(dir, '成片.mp4'),
    project = path.join(dir, '测试工程.freecut');
  const ffmpeg = path.join(
    root,
    'resources',
    'ffmpeg',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
  execFileSync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      sample,
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.env.FREECUT_TEST_EXE;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-desktop-smoke-'));
  delete env.PORTABLE_EXECUTABLE_DIR;
  const args = [...(executablePath ? [] : [root]), `--user-data-dir=${profile}`];
  const app = await electron.launch({ executablePath, args, env });
  try {
    await app.evaluate(({ dialog }) => {
      globalThis.__smokeWarnings = [];
      // Let the product's close guard request/approve shutdown normally. The
      // temporary smoke project may be discarded if a failed test leaves edits.
      dialog.showMessageBox = async (_window, options) => {
        if (options.title !== '保存更改') globalThis.__smokeWarnings.push(options.message);
        return { response: 1, checkboxChecked: false };
      };
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.app');
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('button', { name: /^新建项目/ }).click();
    if (await page.getByRole('button', { name: '跳过引导', exact: true }).count())
      await page.getByRole('button', { name: '跳过引导', exact: true }).click();
    const mode = page.getByTitle('切换关键帧操作模式', { exact: true });
    await expect(mode).toContainText('普通');
    await mode.click();
    await expect(mode).toContainText('专业模式');
    await page.screenshot({ path: path.join(dir, 'desktop-empty.png') });
    await page.getByRole('button', { name: /先试试示例工程/ }).click();
    await page.getByRole('button', { name: '片段 主标题', exact: true }).click();
    await page.getByRole('button', { name: '关键帧', exact: true }).first().click();
    await page.screenshot({ path: path.join(dir, 'desktop-demo.png') });
    await page.getByTitle('切换专业布局 / 手机风格').click();
    assert(await page.locator('.mobile-mode').count());
    await page.screenshot({ path: path.join(dir, 'mobile-layout.png') });
    await page.getByTitle('切换专业布局 / 手机风格').click();
    await page.getByLabel('工程名称', { exact: true }).fill('示例 · 验证未保存修改');
    await page.getByTitle('新建工程').click();
    const unsaved = page.getByRole('dialog', { name: '保存未完成的修改', exact: true });
    await expect(unsaved).toBeVisible();
    await unsaved.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('.timeline-clip')).toHaveCount(4);
    await page.getByTitle('新建工程').click();
    await unsaved.getByRole('button', { name: '不保存并继续', exact: true }).click();
    await expect(page.locator('.timeline-clip')).toHaveCount(0);
    await app.evaluate(({ dialog }, sample) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sample] });
    }, sample);
    await page.locator('.import-button').click();
    await page.waitForSelector('.asset-card');
    const mediaRange = await page.evaluate(async () => {
      const [asset] = await window.freecut.importMedia();
      const response = await fetch(asset.url, { headers: { Range: 'bytes=0-43' } });
      return { status: response.status, size: (await response.arrayBuffer()).byteLength };
    });
    assert.deepEqual(mediaRange, { status: 206, size: 44 });
    await page.locator('.asset-card').dblclick();
    await page.getByRole('button', { name: '基础', exact: true }).click();
    await page.getByTitle('添加缩放关键帧').click();
    await page.getByRole('spinbutton', { name: '缩放', exact: true }).fill('1.1');
    await page.getByRole('button', { name: '文字', exact: true }).click();
    await page.getByRole('button', { name: '添加文字', exact: true }).click();
    await page.getByRole('textbox', { name: '文字内容' }).fill('自由剪辑实测');
    await page.getByRole('spinbutton', { name: '片段时长', exact: true }).fill('2');
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, project);
    await page.getByTitle('保存工程 Ctrl+S').click();
    await page.getByText('工程已保存。', { exact: true }).waitFor();
    assert((await fs.stat(project)).size > 1000);
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, project);
    await page.getByTitle('打开工程 Ctrl+O').click();
    await page.getByRole('button', { name: '片段 在这里输入文字', exact: true }).waitFor();
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, output);
    await page.locator('.export-trigger').click();
    await page.locator('.export-dialog').getByRole('combobox').nth(0).selectOption('720');
    await page.locator('.export-dialog').getByRole('combobox').nth(1).selectOption('24');
    await page.getByRole('button', { name: '选择保存位置并导出', exact: true }).click();
    await page.getByText('视频已保存', { exact: true }).waitFor({ timeout: 180000 });
    assert((await fs.stat(output)).size > 1000);
    const info = execFileSync(ffmpeg, ['-i', output, '-f', 'null', '-'], {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(await app.evaluate(() => globalThis.__smokeWarnings), []);
    await page.screenshot({ path: path.join(dir, 'export-complete.png') });
    console.log(
      JSON.stringify({ passed: true, screenshots: dir, output, project, rendererErrors: errors }),
    );
  } finally {
    await app.close();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
