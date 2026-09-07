'use strict';
// Windows only: execute the actual generated Setup, install to a fresh workspace
// cache, launch the installed product normally, then use its real uninstaller.
// Existing user installations and same-name shortcuts are never replaced.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium, _electron, expect } = require('@playwright/test');
const backend = require('./backend.cjs');
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function main() {
  if (process.platform !== 'win32') throw Error('Actual Setup regression requires Windows');
  const root = path.resolve(__dirname, '..'),
    { version } = require('../package.json');
  const setup = path.join(root, 'release', `FreeCut-${version}-win-x64-Setup.exe`),
    source = path.join(root, 'release', 'win-unpacked');
  await fs.access(setup);
  const directory = await fs.mkdtemp(path.join(root, '.cache', 'setup-runtime-test-')),
    target = path.join(directory, '中文 安装位置', 'FreeCut'),
    profile = path.join(directory, 'profile');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, '个人工程.freecut'), 'KEEP ORIGINAL PROJECT');
  const report = { directory, setup, checks: [], passed: false },
    env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  let child, browser, application, page;
  const check = async (name, action) => {
    console.log(`RUN: ${name}`);
    await action();
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  };
  const absent = async (file) =>
    fs.stat(file).then(
      () => false,
      (error) => {
        if (error.code === 'ENOENT') return true;
        throw error;
      },
    );
  try {
    const port = await freePort();
    child = spawn(
      setup,
      [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--install-dir', target],
      { cwd: directory, env, windowsHide: true, stdio: 'ignore', shell: false },
    );
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await check(
      'Actual Setup opens only the custom Electron installer with forwarded Unicode target',
      async () => {
        await expect
          .poll(
            async () => {
              try {
                const r = await fetch(`http://127.0.0.1:${port}/json/version`);
                return r.ok;
              } catch {
                return false;
              }
            },
            { timeout: 120000 },
          )
          .toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        page = browser.contexts()[0].pages()[0];
        page.setDefaultTimeout(120000);
        await expect(page.locator('#heading')).toBeVisible();
        await expect(page.locator('#target')).toHaveText(target);
        const state = await page.evaluate(() => window.freecutInstaller.state());
        assert.equal(state.version, version);
        assert.equal(state.ready, true);
        assert.equal(state.mode, 'install');
        report.initialState = state;
        assert(page.url().includes('/resources/freecut-installer/index.html'));
        await page.screenshot({ path: path.join(directory, 'actual-setup-ui.png') });
      },
    );
    await check(
      'Setup installs one verified runtime and the original app.asar, preserving user files',
      async () => {
        await page.locator('#primary').click();
        await expect(page.locator('#completeView')).toBeVisible();
        const installed = await backend.inspectTarget(target, { update: true }),
          manifest = await backend.readManifest(path.join(source, backend.EMBEDDED_MANIFEST));
        assert.deepEqual(installed.installed.files, manifest.files);
        for (const entry of manifest.files)
          assert.equal(
            await backend.sha256(path.join(target, entry.path)),
            entry.sha256,
            entry.path,
          );
        assert.equal(
          manifest.files.filter(
            (entry) => path.basename(entry.path).toLowerCase() === 'freecut.exe',
          ).length,
          1,
        );
        assert(!manifest.files.some((entry) => entry.path.startsWith('application/')));
        assert(await absent(path.join(target, backend.EMBEDDED_MANIFEST)));
        assert.equal(
          await fs.readFile(path.join(target, '个人工程.freecut'), 'utf8'),
          'KEEP ORIGINAL PROJECT',
        );
        report.installed = {
          files: manifest.files.length,
          bytes: manifest.totalBytes,
          appAsarSha256: await backend.sha256(path.join(target, 'resources', 'app.asar')),
          exeSha256: await backend.sha256(path.join(target, 'FreeCut.exe')),
          setupBytes: (await fs.stat(setup)).size,
        };
        await page.screenshot({ path: path.join(directory, 'actual-setup-complete.png') });
        await page.locator('#done').click();
        assert.deepEqual(await exit, { code: 0, signal: null });
        child = undefined;
        await browser.close().catch(() => {});
        browser = undefined;
      },
    );
    await check(
      'Installed FreeCut starts the real editor with no installer or portable flags',
      async () => {
        application = await _electron.launch({
          executablePath: path.join(target, 'FreeCut.exe'),
          args: [`--user-data-dir=${path.join(directory, 'product-profile')}`],
          cwd: target,
          env,
          timeout: 30000,
        });
        report.product = await application.evaluate(({ app }) => ({
          packaged: app.isPackaged,
          userData: app.getPath('userData'),
          execPath: process.execPath,
          argv: process.argv,
          portable: process.env.PORTABLE_EXECUTABLE_DIR ?? null,
        }));
        assert.equal(report.product.packaged, true);
        assert.equal(
          path.resolve(report.product.userData),
          path.join(directory, 'product-profile'),
        );
        assert(!report.product.argv.includes('--installer'));
        assert.equal(report.product.portable, null);
        page = await application.firstWindow();
        await expect(page.getByRole('button', { name: /^新建项目/ })).toBeVisible();
        await page.getByRole('button', { name: /^新建项目/ }).click();
        const skip = page.getByRole('button', { name: '跳过引导', exact: true });
        if (await skip.count()) await skip.click();
        await expect(page.getByLabel('视频预览', { exact: true })).toBeVisible();
        await page.screenshot({ path: path.join(directory, 'installed-product.png') });
        await application.evaluate(({ app }) => app.exit(0));
        await application.close();
        application = undefined;
      },
    );
    await check(
      'Installed product uninstaller removes its runtime and leaves the personal project',
      async () => {
        // Launch normally: the Electron debugger launcher keeps a debugger
        // connection and owns a process tree, unlike the actual uninstall entry.
        const uninstallPort = await freePort();
        child = spawn(
          path.join(target, 'FreeCut.exe'),
          [
            '--uninstall',
            '--install-dir',
            target,
            `--remote-debugging-port=${uninstallPort}`,
            `--user-data-dir=${path.join(directory, 'uninstall-profile')}`,
          ],
          { cwd: directory, env, windowsHide: true, stdio: 'ignore', shell: false },
        );
        const uninstallExit = new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => resolve({ code, signal }));
        });
        await expect
          .poll(
            async () => {
              try {
                return (await fetch(`http://127.0.0.1:${uninstallPort}/json/version`)).ok;
              } catch {
                return false;
              }
            },
            { timeout: 30000 },
          )
          .toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${uninstallPort}`);
        page = browser.contexts()[0].pages()[0];
        await expect(page.locator('#heading')).toBeVisible();
        const state = await page.evaluate(() => window.freecutInstaller.state());
        assert.equal(state.mode, 'uninstall');
        await page.locator('#primary').click();
        await expect.poll(() => child.exitCode, { timeout: 30000 }).toBe(0);
        assert.deepEqual(await uninstallExit, { code: 0, signal: null });
        child = undefined;
        await browser.close().catch(() => {});
        browser = undefined;
        await expect
          .poll(() => absent(path.join(target, backend.OWNERSHIP)), { timeout: 45000 })
          .toBe(true);
        assert(await absent(path.join(target, 'FreeCut.exe')));
        assert.equal(
          await fs.readFile(path.join(target, '个人工程.freecut'), 'utf8'),
          'KEEP ORIGINAL PROJECT',
        );
        report.remaining = await fs.readdir(target);
        assert.deepEqual(report.remaining, ['个人工程.freecut']);
        for (const entry of await fs.readdir(os.tmpdir(), { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith('freecut-uninstall-')) continue;
          const helperDirectory = path.join(os.tmpdir(), entry.name);
          const plan = await fs
            .readFile(path.join(helperDirectory, 'plan.json'), 'utf8')
            .then(JSON.parse, () => null);
          if (plan?.target === target) {
            report.uninstallLog = helperDirectory;
            break;
          }
        }
        assert(report.uninstallLog, 'Real uninstaller must create a matching plan');
        await expect
          .poll(
            async () => {
              return fs.readFile(path.join(report.uninstallLog, 'result.json'), 'utf8').then(
                (text) => JSON.parse(text.replace(/^\uFEFF/, '')),
                () => null,
              );
            },
            { timeout: 15000 },
          )
          .toMatchObject({ success: true, removed: report.installed.files, error: '' });
        report.uninstall = JSON.parse(
          (await fs.readFile(path.join(report.uninstallLog, 'result.json'), 'utf8')).replace(
            /^\uFEFF/,
            '',
          ),
        );
      },
    );
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await application.close().catch(() => {});
    }
    if (browser) {
      if (page) await page.close().catch(() => {});
      await browser.close().catch(() => {});
    }
    if (child && child.exitCode === null) child.kill();
    await fs.writeFile(path.join(directory, 'setup-report.json'), JSON.stringify(report, null, 2));
    console.log(`Report: ${path.join(directory, 'setup-report.json')}`);
  }
}
