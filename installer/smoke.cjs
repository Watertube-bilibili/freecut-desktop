'use strict';
// Windows integration: actual installer UI, native shortcut creation, cancellation
// while waiting for a test-owned process, update, and the real uninstall helper.
// The executable payload is a fixture: this does not claim to launch FreeCut.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');
const backend = require('./backend.cjs');

async function main() {
  if (process.platform !== 'win32')
    throw Error(
      'Installer UI integration runs on Windows. Use backend.test.cjs on other platforms.',
    );
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-installer-ui-'));
  const payloadRoot = path.join(directory, 'payload');
  const target = path.join(directory, '中文 安装目录', 'FreeCut');
  const integrationHome = path.join(directory, 'integration');
  await fs.mkdir(path.join(payloadRoot, 'application', 'resources'), { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, '我的工程.freecut'), 'KEEP PERSONAL PROJECT');
  const entries = {
    'FreeCut.exe': 'TEST FIXTURE EXECUTABLE',
    'resources/app.asar': 'TEST FIXTURE APPLICATION',
    'LICENSE.txt': 'TEST FIXTURE NOTICE',
  };
  async function writePayload(version) {
    const files = [];
    for (const [relative, content] of Object.entries(entries)) {
      const file = path.join(payloadRoot, 'application', relative);
      await fs.writeFile(file, content);
      files.push({
        path: relative,
        size: Buffer.byteLength(content),
        sha256: await backend.sha256(file),
      });
    }
    await fs.writeFile(
      path.join(payloadRoot, 'manifest.json'),
      JSON.stringify({
        format: 1,
        product: backend.PRODUCT,
        version,
        entryPoint: 'FreeCut.exe',
        files,
      }),
    );
  }
  await writePayload('0.3.0');
  const report = { directory, checks: [], rendererErrors: [], passed: false };
  let application, page, oldProcess;
  const check = async (name, action) => {
    console.log(`RUN: ${name}`);
    await action();
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  };
  const launch = async (args = []) => {
    const env = {
      ...process.env,
      FREECUT_INSTALLER_PAYLOAD_DIR: payloadRoot,
      FREECUT_INSTALLER_TEST_HOME: integrationHome,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    delete env.PORTABLE_EXECUTABLE_FILE;
    application = await _electron.launch({
      args: [__dirname, ...args],
      cwd: root,
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await expect(page.locator('#heading')).toBeVisible();
  };
  const closeCompleted = async () => {
    const closed = application.waitForEvent('close');
    await page.locator('#done').click();
    await closed;
    application = undefined;
  };
  try {
    await check(
      'Custom installer starts with no selected disk and normalizes native root selection',
      async () => {
        await launch();
        await expect(page.locator('#target')).toHaveText('尚未选择');
        await expect(page.locator('#primary')).toBeDisabled();
        await expect(page.locator('#driveC')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#driveD')).toHaveAttribute('aria-pressed', 'false');
        // Verify the one-click action without installing test files into real C/D locations.
        await application.evaluate(({ipcMain}) => {
          globalThis.__driveInstallCalls=[];
          ipcMain.removeHandler('freecut-installer:install');
          ipcMain.handle('freecut-installer:install',(_event,target)=>{globalThis.__driveInstallCalls.push(target);});
        });
        if (await page.locator('#driveC').isEnabled()) {
          await page.locator('#driveC').click();
          await expect(page.locator('#target')).toHaveText(
            path.join(process.env.LOCALAPPDATA, 'Programs', 'FreeCut'),
          );
        }
        const driveState = await page.evaluate(() => window.freecutInstaller.state());
        const driveD = driveState.drives.find((drive) => drive.letter === 'D');
        if (driveD.available) {
          await page.locator('#driveD').click();
          await expect(page.locator('#target')).toHaveText('D:\\FreeCut');
        } else {
          await expect(page.locator('#driveD')).toBeDisabled();
          await expect(page.locator('#driveNote')).toContainText('D 盘');
        }
        const calls=await application.evaluate(()=>globalThis.__driveInstallCalls);
        assert.equal(calls.length,driveState.drives.filter(drive=>drive.available).length);
        await application.close();application=undefined;
        // A fresh process restores the actual backend for the isolated custom installation.
        await launch();
        await application.evaluate(
          ({ dialog }, values) => {
            globalThis.__installerOpenChoices = values;
            dialog.showOpenDialog = async () => ({
              canceled: false,
              filePaths: [globalThis.__installerOpenChoices.shift()],
            });
          },
          [path.parse(target).root, target],
        );
        await page.locator('#choose').click();
        await expect(page.locator('#target')).toHaveText(
          path.join(path.parse(target).root, 'FreeCut'),
        );
        await page.locator('#choose').click();
        await expect(page.locator('#target')).toHaveText(target);
        await page.screenshot({ path: path.join(directory, 'installer-location.png') });
      },
    );
    await check(
      'Install button copies verified payload, preserves user data, and creates real isolated shortcuts',
      async () => {
        await page.locator('#primary').click();
        await expect(page.locator('#completeView')).toBeVisible();
        const installed = await backend.inspectTarget(target, { update: true });
        assert.equal(installed.installed.version, '0.3.0');
        assert.equal(
          await fs.readFile(path.join(target, 'resources/app.asar'), 'utf8'),
          entries['resources/app.asar'],
        );
        assert.equal(
          await fs.readFile(path.join(target, '我的工程.freecut'), 'utf8'),
          'KEEP PERSONAL PROJECT',
        );
        for (const kind of ['Desktop', 'StartMenu']) {
          const shortcut = await application.evaluate(
            ({ shell }, file) => shell.readShortcutLink(file),
            path.join(integrationHome, kind, 'FreeCut.lnk'),
          );
          assert.equal(
            shortcut.target.toLowerCase(),
            path.join(target, 'FreeCut.exe').toLowerCase(),
          );
        }
        await expect(page.locator('#primary')).toHaveText('启动水管剪辑 →');
        await page.screenshot({ path: path.join(directory, 'installer-complete.png') });
        await closeCompleted();
      },
    );
    await check(
      'Update waits without killing the old process, cancellation preserves install, and retry succeeds',
      async () => {
        const before = await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8');
        entries['resources/app.asar'] = 'UPDATED FIXTURE APPLICATION';
        await writePayload('0.3.1');
        oldProcess = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        await new Promise((resolve, reject) => {
          oldProcess.once('spawn', resolve);
          oldProcess.once('error', reject);
        });
        await launch(['--update', '--install-dir', target, '--wait-pid', String(oldProcess.pid)]);
        await expect(page.locator('#progressLabel')).toContainText('等待 FreeCut');
        assert.doesNotThrow(
          () => process.kill(oldProcess.pid, 0),
          'Installer must not kill the waiting process',
        );
        await page.locator('#cancel').click();
        await expect(page.locator('#error')).toContainText('取消');
        assert.equal(await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8'), before);
        assert.doesNotThrow(
          () => process.kill(oldProcess.pid, 0),
          'Cancellation must not terminate another process',
        );
        const exited = new Promise((resolve) => oldProcess.once('exit', resolve));
        oldProcess.kill(); // Cleanup of the dummy process owned by this test, not by the installer.
        await exited;
        oldProcess = undefined;
        await page.locator('#primary').click();
        await expect(page.locator('#completeView')).toBeVisible();
        assert.equal(
          (await backend.inspectTarget(target, { update: true })).installed.version,
          '0.3.1',
        );
        assert.equal(
          await fs.readFile(path.join(target, 'resources/app.asar'), 'utf8'),
          entries['resources/app.asar'],
        );
        await closeCompleted();
      },
    );
    await check(
      'The actual PowerShell uninstaller removes only owned unchanged files and preserves personal data',
      async () => {
        const installed = (await backend.inspectTarget(target, { update: true })).installed;
        await fs.writeFile(path.join(target, 'LICENSE.txt'), 'USER MODIFICATION');
        const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{},100)'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        await new Promise((resolve, reject) => {
          sleeper.once('spawn', resolve);
          sleeper.once('error', reject);
        });
        const planFile = path.join(directory, 'uninstall-plan.json'),
          logFile = path.join(directory, 'uninstall-result.json');
        await fs.writeFile(
          planFile,
          JSON.stringify({
            target,
            product: backend.PRODUCT,
            installId: installed.installId,
            ownershipHash: await backend.sha256(path.join(target, backend.OWNERSHIP)),
            files: installed.files,
            executable: path.join(target, 'FreeCut.exe'),
            pid: sleeper.pid,
            registryKey: null,
            shortcuts: ['Desktop', 'StartMenu'].map((kind) =>
              path.join(integrationHome, kind, 'FreeCut.lnk'),
            ),
            silent: true,
            logFile,
          }),
        );
        const powershell = path.join(
          process.env.SystemRoot,
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        );
        const helper = spawn(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, 'uninstall.ps1'),
            '-PlanPath',
            planFile,
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let errors = '';
        helper.stderr.on('data', (chunk) => (errors += chunk));
        const code = await new Promise((resolve, reject) => {
          helper.once('error', reject);
          helper.once('exit', resolve);
        });
        assert.equal(code, 0, errors);
        const result = JSON.parse((await fs.readFile(logFile, 'utf8')).replace(/^\uFEFF/, ''));
        assert.equal(result.success, true, result.error);
        assert.deepEqual(result.preserved, ['LICENSE.txt']);
        await assert.rejects(fs.stat(path.join(target, 'FreeCut.exe')), { code: 'ENOENT' });
        await assert.rejects(fs.stat(path.join(target, backend.OWNERSHIP)), { code: 'ENOENT' });
        assert.equal(
          await fs.readFile(path.join(target, '我的工程.freecut'), 'utf8'),
          'KEEP PERSONAL PROJECT',
        );
        assert.equal(
          await fs.readFile(path.join(target, 'LICENSE.txt'), 'utf8'),
          'USER MODIFICATION',
        );
        for (const kind of ['Desktop', 'StartMenu'])
          await assert.rejects(fs.stat(path.join(integrationHome, kind, 'FreeCut.lnk')), {
            code: 'ENOENT',
          });
      },
    );
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (oldProcess) oldProcess.kill();
    if (application) await application.close().catch(() => {});
    await fs.writeFile(
      path.join(directory, 'installer-ui-result.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.length} installer integration groups\nReport: ${path.join(directory, 'installer-ui-result.json')}`,
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
