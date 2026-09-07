'use strict';

// node scripts/regression-entry-url.cjs
// Optional Windows packaged verification: --exe release/win-unpacked/FreeCut.exe
// Copy the actual product into a real directory containing ~, spaces and Unicode.
// Keep production preload, sender validation, file IPC and normal close enabled.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--exe'))
    throw Error('Usage: node scripts/regression-entry-url.cjs [--exe Windows/FreeCut.exe]');
  if (args.length && process.platform !== 'win32')
    throw Error(
      '--exe currently verifies Windows unpacked/installed products; use the source test on macOS.',
    );
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-entry~url-')),
  );
  const application = path.join(directory, 'application~1 空格');
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  let executablePath;
  if (args.length) {
    const originalExe = await fs.realpath(path.resolve(args[1]));
    assert((await fs.stat(originalExe)).isFile(), 'The packaged executable must be a file');
    await fs.cp(path.dirname(originalExe), application, { recursive: true });
    executablePath = path.join(application, path.basename(originalExe));
  } else {
    await fs.mkdir(application);
    for (const item of ['electron', 'dist', 'package.json'])
      await fs.cp(path.join(root, item), path.join(application, item), { recursive: true });
  }
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  const launchArgs = [...(executablePath ? [] : [application]), `--user-data-dir=${profile}`];
  const report = {
    platform: process.platform,
    arch: process.arch,
    directory,
    packaged: !!executablePath,
    checks: [],
    passed: false,
  };
  let app;
  try {
    app = await _electron.launch({ executablePath, args: launchArgs, env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.waitForSelector('.app');
    const runtime = await app.evaluate(({ app }) => {
      const path = process.mainModule.require('node:path');
      const { pathToFileURL } = process.mainModule.require('node:url');
      const entry = path.join(app.getAppPath(), 'dist', 'index.html');
      return {
        packaged: app.isPackaged,
        expectedURL: pathToFileURL(entry).href,
        preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
        userData: app.getPath('userData'),
        updatesDisabled: process.env.FREECUT_DISABLE_UPDATES === '1',
      };
    });
    assert.equal(
      await fs.realpath(runtime.userData),
      profile,
      'The original user profile must never be used',
    );
    assert.equal(runtime.packaged, !!executablePath);
    assert(runtime.updatesDisabled);
    report.actualURL = page.url();
    report.expectedURL = runtime.expectedURL;
    assert.equal(
      page.url(),
      runtime.expectedURL,
      'Loaded URL must exactly match the authenticated URL',
    );
    const ipc = await page.evaluate(async () => ({
      info: await window.freecut.getInfo(),
      projects: await window.freecut.listProjects(),
      update: await window.freecut.updateState(),
    }));
    assert.equal(await fs.realpath(ipc.info.userData), profile);
    assert.deepEqual(ipc.projects, []);
    assert.equal(ipc.update.phase, 'disabled');
    report.checks.push(
      'Actual product starts from ~ / Unicode / space path and authenticates real desktop IPC',
    );

    // A second real WebContents loading the exact same URL must still be denied.
    // This proves that fixing URL encoding did not relax the window identity check.
    const otherWindow = await app.evaluate(async ({ BrowserWindow }, runtime) => {
      const other = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: runtime.preload,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        await other.loadURL(runtime.expectedURL);
        return await other.webContents.executeJavaScript(`(async () => {
          try { await window.freecut.getInfo(); return { allowed: true }; }
          catch (error) { return { allowed: false, error: error.message }; }
        })()`);
      } finally {
        other.destroy();
      }
    }, runtime);
    assert.equal(otherWindow.allowed, false);
    assert.match(otherWindow.error, /此窗口没有调用桌面功能的权限/);
    report.checks.push('A different real window with the same URL remains rejected');

    await page.getByRole('button', { name: /^新建项目/ }).click();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    await page.getByLabel('工程名称', { exact: true }).fill('路径编码真实回归');
    const saved = path.join(directory, '路径~工程.freecut');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, saved);
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect.poll(() => fs.readFile(saved, 'utf8').catch(() => '')).not.toBe('');
    await expect(page.getByText('正在处理工程文件…', { exact: true })).toBeHidden({
      timeout: 15000,
    });
    assert.equal(JSON.parse(await fs.readFile(saved, 'utf8')).name, '路径编码真实回归');
    const recents = await page.evaluate(() => window.freecut.listProjects());
    assert.equal(recents.length, 1);
    report.checks.push(
      'Real save IPC and recent-project persistence succeed from the encoded application URL',
    );
    await page.screenshot({ path: path.join(directory, 'entry-url.png') });
    await app.close();
    app = null;
    report.checks.push('Normal product close handshake completes with sender validation active');
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    throw error;
  } finally {
    // A deliberately regressed sender check can also reject the close handshake.
    // On failure only, stop this script-owned process without touching user windows.
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    const output = path.join(
      root,
      'artifacts',
      'smoke',
      `entry-url-${process.platform}-${process.arch}.json`,
    );
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
