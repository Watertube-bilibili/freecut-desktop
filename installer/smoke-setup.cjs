'use strict';
// Windows only: execute the actual generated Setup, install to a fresh workspace
// cache, launch the installed product normally, then use its real uninstaller.
// Existing user installations and same-name shortcuts are never replaced.
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const os = require('node:os');
const { fileURLToPath } = require('node:url');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
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
async function shortTemporaryPath(value, fixtureDirectory) {
  const script = path.join(fixtureDirectory, 'temporary-alias.ps1');
  await fs.writeFile(
    script,
    '\uFEFF' +
      `param([string]$InputPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FreeCutSetupTempAlias {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string path, StringBuilder buffer, uint size);
}
'@
$buffer = [Text.StringBuilder]::new(32768)
$length = [FreeCutSetupTempAlias]::GetShortPathName($InputPath, $buffer, 32768)
if ($length -eq 0 -or $length -ge 32768) { throw 'Cannot resolve the temporary directory alias.' }
[Console]::Write($buffer.ToString())
`,
  );
  const powershell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const { stdout } = await promisify(execFile)(
    powershell,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, value],
    { windowsHide: true, shell: false, encoding: 'utf8', timeout: 30000 },
  );
  const alias = stdout.trim();
  assert.equal(
    await fs.realpath(alias),
    await fs.realpath(value),
    'TEMP alias must identify the fixture directory',
  );
  return alias;
}
async function main() {
  if (process.platform !== 'win32') throw Error('Actual Setup regression requires Windows');
  const root = await fs.realpath(path.resolve(__dirname, '..')),
    { version } = require('../package.json');
  const setup = path.join(root, 'release', `FreeCut-${version}-win-x64-Setup.exe`),
    source = path.join(root, 'release', 'win-unpacked');
  await fs.access(setup);
  await fs.mkdir(path.join(root, '.cache'), { recursive: true });
  const fixtureRoot = await fs.realpath(path.join(root, '.cache'));
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'setup-runtime-test-')),
    target = path.join(directory, '中文 安装位置', 'FreeCut'),
    profile = path.join(directory, 'profile');
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, '个人工程.freecut'), 'KEEP ORIGINAL PROJECT');
  const report = { directory, setup, checks: [], passed: false },
    env = { ...process.env };
  // Actual NSIS extraction must exercise the same 8.3 TEMP spelling that hosted
  // Windows runners use. Keep all environment changes within child processes.
  const extractionTemporaryRoot = await fs.mkdtemp(
    path.join(temporaryRoot, 'freecut-setup-extraction-'),
  );
  const temporaryAlias = await shortTemporaryPath(extractionTemporaryRoot, directory);
  env.TEMP = temporaryAlias;
  env.TMP = temporaryAlias;
  report.temporaryDirectory = {
    canonical: extractionTemporaryRoot,
    alias: temporaryAlias,
    shortAliasAvailable: temporaryAlias.toLowerCase() !== extractionTemporaryRoot.toLowerCase(),
  };
  if (!report.temporaryDirectory.shortAliasAvailable)
    console.log(
      'NOTE: This volume does not provide an 8.3 alias; the actual Setup flow still runs in an isolated TEMP.',
    );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.PORTABLE_EXECUTABLE_APP_FILENAME;
  let child, browser, application, page;
  const rendererEvents = [];
  const watchPage = (currentPage) => {
    const record = (event) => {
      rendererEvents.push(event);
      if (rendererEvents.length > 80) rendererEvents.shift();
    };
    currentPage.on('pageerror', (error) => record({ type: 'pageerror', message: error.message }));
    currentPage.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        record({ type: message.type(), message: message.text().slice(0, 4000) });
    });
    currentPage.on('requestfailed', (request) =>
      record({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText }),
    );
  };
  const captureInstaller = async (label) => {
    const diagnostics = { label, rendererEvents: [...rendererEvents] };
    if (browser) {
      diagnostics.pages = browser
        .contexts()
        .flatMap((context) =>
          context
            .pages()
            .map((currentPage) => ({ url: currentPage.url(), closed: currentPage.isClosed() })),
        );
      const session = await browser.newBrowserCDPSession().catch(() => null);
      if (session) {
        diagnostics.commandLine = await session
          .send('Browser.getBrowserCommandLine')
          .catch((error) => ({ unavailable: error.message }));
        await session.detach().catch(() => {});
      }
    }
    if (page && !page.isClosed()) {
      diagnostics.ui = await page
        .evaluate(async () => {
          const info = {
            url: location.href,
            readyState: document.readyState,
            body: document.body?.innerText,
          };
          info.elements = Object.fromEntries(
            ['heading', 'target', 'error', 'primary', 'edition'].map((id) => {
              const element = document.getElementById(id);
              return [
                id,
                element
                  ? {
                      text: element.textContent,
                      hidden: element.hidden,
                      disabled: element.disabled,
                    }
                  : null,
              ];
            }),
          );
          info.apiPresent = !!window.freecutInstaller;
          info.state = window.freecutInstaller
            ? await Promise.race([
                window.freecutInstaller.state().catch((error) => ({ error: error.message })),
                new Promise((resolve) =>
                  setTimeout(() => resolve({ error: 'state IPC timed out after 5 seconds' }), 5000),
                ),
              ])
            : null;
          return info;
        })
        .catch((error) => ({ error: error.message }));
      const pageURL = page.url();
      if (
        pageURL.startsWith('file:') &&
        pageURL.endsWith('/resources/freecut-installer/index.html')
      ) {
        const extracted = path.dirname(fileURLToPath(pageURL));
        diagnostics.resources = await Promise.all(
          ['main.cjs', 'renderer.js', 'preload.cjs', 'index.html'].map(async (name) => {
            const extractedHash = await backend
              .sha256(path.join(extracted, name))
              .catch((error) => ({ error: error.message }));
            const sourceHash = await backend.sha256(path.join(__dirname, name));
            return { name, extractedHash, sourceHash, matches: extractedHash === sourceHash };
          }),
        );
      }
    }
    report.diagnostics ??= [];
    report.diagnostics.push(diagnostics);
    return diagnostics;
  };
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
  // CDP cannot call Electron's main-process app.getPath. Force actual session
  // storage and verify Chromium creates it beneath this launch's isolated profile.
  const assertProfileStorage = async (profilePath) => {
    await page.evaluate(() => localStorage.setItem('freecut-installer-profile-test', 'isolated'));
    await expect
      .poll(() => absent(path.join(profilePath, 'Local Storage', 'leveldb', 'CURRENT')))
      .toBe(false);
  };
  try {
    const port = await freePort();
    const setupArguments = [
      `--remote-debugging-port=${port}`,
      '--enable-automation',
      `--user-data-dir=${profile}`,
      '--install-dir',
      target,
    ];
    report.launch = { executable: setup, args: setupArguments, cwd: directory, target, profile };
    child = spawn(setup, setupArguments, {
      cwd: directory,
      env,
      windowsHide: true,
      stdio: 'ignore',
      shell: false,
    });
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
        watchPage(page);
        page.setDefaultTimeout(120000);
        await expect(page.locator('#heading')).toBeVisible();
        await captureInstaller('before-target-assertion');
        await expect(page.locator('#target')).toHaveText(target);
        const state = await page.evaluate(() => window.freecutInstaller.state());
        assert.equal(state.version, version);
        assert.equal(state.ready, true);
        assert.equal(state.mode, 'install');
        await assertProfileStorage(profile);
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
          sessionData: app.getPath('sessionData'),
          execPath: process.execPath,
          argv: process.argv,
          portable: process.env.PORTABLE_EXECUTABLE_DIR ?? null,
        }));
        assert.equal(report.product.packaged, true);
        assert.equal(
          await fs.realpath(report.product.userData),
          await fs.realpath(path.join(directory, 'product-profile')),
        );
        assert.equal(
          await fs.realpath(report.product.sessionData),
          await fs.realpath(path.join(directory, 'product-profile')),
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
        await assertProfileStorage(path.join(directory, 'uninstall-profile'));
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
        const canonicalTarget = await fs.realpath(target);
        for (const entry of await fs.readdir(extractionTemporaryRoot, { withFileTypes: true })) {
          if (!entry.isDirectory() || !entry.name.startsWith('freecut-uninstall-')) continue;
          const helperDirectory = path.join(extractionTemporaryRoot, entry.name);
          const plan = await fs
            .readFile(path.join(helperDirectory, 'plan.json'), 'utf8')
            .then(JSON.parse, () => null);
          if (
            typeof plan?.target === 'string' &&
            (await fs.realpath(plan.target).catch(() => null)) === canonicalTarget
          ) {
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
    await captureInstaller('failure').catch((diagnosticError) => {
      report.diagnosticError = diagnosticError.message;
    });
    console.error(
      'ACTUAL_SETUP_DIAGNOSTICS ' +
        JSON.stringify(
          {
            launch: report.launch,
            diagnostics: report.diagnostics,
            diagnosticError: report.diagnosticError,
          },
          null,
          2,
        ),
    );
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
