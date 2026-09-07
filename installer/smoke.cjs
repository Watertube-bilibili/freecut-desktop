'use strict';
// Windows integration: actual installer UI, native shortcut creation, cancellation
// while waiting for a test-owned process, update, and the real uninstall helper.
// The executable payload is a fixture: this does not claim to launch FreeCut.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');
const backend = require('./backend.cjs');

async function readShortcutsUnderWesternCodePage(directory, files) {
  // Compile the production Unicode reader unchanged into a temporary process
  // with ACP1252. This reproduces English CI without changing the user's locale.
  const helper = await fs.readFile(path.join(__dirname, 'uninstall.ps1'), 'utf8');
  const csharp = helper.match(/Add-Type -TypeDefinition @'\r?\n([\s\S]+?)\r?\n'@/);
  assert(csharp, 'Find the exact production Shell Link reader');
  const source = path.join(directory, 'unicode-reader.cs');
  const manifest = path.join(directory, 'unicode-reader.manifest');
  const executable = path.join(directory, 'unicode-reader.exe');
  await fs.writeFile(
    source,
    csharp[1] +
      `
public static class LocaleTest {
  [System.Runtime.InteropServices.DllImport("kernel32.dll")]
  private static extern uint GetACP();
  [System.STAThread]
  public static int Main(string[] args) {
    System.Console.OutputEncoding = new System.Text.UTF8Encoding(false);
    var links = new System.Collections.Generic.List<object>();
    foreach (string file in args) {
      var data = FreeCutUninstallPaths.ReadShortcut(file);
      links.Add(new { file = file, data = data, canonicalTarget = FreeCutUninstallPaths.Resolve(data.TargetPath) });
    }
    System.Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new { codePage = GetACP(), links = links }));
    return 0;
  }
}
`,
  );
  await fs.writeFile(
    manifest,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><assemblyIdentity version="1.0.0.0" name="FreeCut.Test.ShortcutLocale"/><application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings><activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">en-US</activeCodePage></windowsSettings></application></assembly>',
  );
  const framework = path.join(process.env.SystemRoot, 'Microsoft.NET/Framework64/v4.0.30319');
  await execute(
    path.join(framework, 'csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/out:' + executable,
      '/win32manifest:' + manifest,
      '/reference:' + path.join(framework, 'System.Web.Extensions.dll'),
      source,
    ],
    { windowsHide: true },
  );
  const { stdout } = await execute(executable, files, { windowsHide: true });
  const result = JSON.parse(stdout);
  assert.equal(result.codePage, 1252, 'The isolated reader must really run under Western ACP1252');
  return result;
}

async function main() {
  if (process.platform !== 'win32')
    throw Error(
      'Installer UI integration runs on Windows. Use backend.test.cjs on other platforms.',
    );
  const root = await fs.realpath(path.resolve(__dirname, '..'));
  // Windows temp paths may contain an 8.3 alias such as RUNNER~1.
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'freecut-installer-ui-'));
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
  const report = { directory, checks: [], rendererErrors: [], profiles: [], passed: false };
  let application, page, oldProcess;
  const check = async (name, action) => {
    console.log(`RUN: ${name}`);
    await action();
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  };
  const launch = async (args = [], explicitProfile = true, testHome = integrationHome) => {
    const profile = explicitProfile
      ? path.join(directory, `profile-${report.profiles.length}`)
      : path.join(integrationHome, 'FreeCut Installer');
    await fs.mkdir(profile, { recursive: true });
    const env = {
      ...process.env,
      FREECUT_INSTALLER_PAYLOAD_DIR: payloadRoot,
      FREECUT_INSTALLER_TEST_HOME: testHome,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    delete env.PORTABLE_EXECUTABLE_FILE;
    application = await _electron.launch({
      args: [__dirname, ...(explicitProfile ? [`--user-data-dir=${profile}`] : []), ...args],
      cwd: root,
      env,
      timeout: 30000,
    });
    page = await application.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await expect(page.locator('#heading')).toBeVisible();
    const paths = await application.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    const expectedProfile = await fs.realpath(profile);
    assert.equal(await fs.realpath(paths.userData), expectedProfile);
    assert.equal(await fs.realpath(paths.sessionData), expectedProfile);
    await page.evaluate(() => localStorage.setItem('freecut-installer-profile-test', 'isolated'));
    await expect
      .poll(() =>
        fs.access(path.join(profile, 'Local Storage', 'leveldb', 'CURRENT')).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    report.profiles.push({ explicitProfile, ...paths });
  };
  const closeCompleted = async () => {
    const closed = application.waitForEvent('close');
    await page.locator('#done').click();
    await closed;
    application = undefined;
  };
  try {
    await check(
      'Installer defaults to Simplified Chinese and persists English with translated native dialogs and path errors',
      async () => {
        await launch([], false);
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await expect(page.locator('#heading')).toHaveText('安装水管剪辑');
        await page.getByLabel('Language / 语言', { exact: true }).selectOption('en');
        await expect(page.locator('#heading')).toHaveText('Install FreeCut');
        await expect(page.locator('#choose')).toContainText('Choose another folder');
        await expect(page.locator('#driveD')).toContainText('Install on D drive');
        await application.evaluate(({ dialog }) => {
          dialog.showOpenDialog = async (_window, options) => {
            globalThis.__installerLanguageDialog = options;
            return { canceled: true, filePaths: [] };
          };
        });
        await page.locator('#choose').click();
        assert.equal(
          (await application.evaluate(() => globalThis.__installerLanguageDialog)).title,
          'Choose an installation folder',
        );
        await page.evaluate(
          (value) => window.freecutInstaller.install(value),
          path.parse(target).root,
        );
        await expect(page.locator('#error')).toContainText(
          'Do not install directly into a drive root',
        );
        await expect(page.locator('#heading')).toHaveText('Install FreeCut');
        await page.screenshot({ path: path.join(directory, 'installer-english.png') });
        await application.close();
        application = undefined;
        await launch([], false);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('#heading')).toHaveText('Install FreeCut');
        await page.getByLabel('Language / 语言', { exact: true }).selectOption('zh-CN');
        await expect(page.locator('#heading')).toHaveText('安装水管剪辑');
        await expect(page.locator('#choose')).toContainText('自定义安装目录');
        await application.close();
        application = undefined;
      },
    );
    await check(
      'English installer creates missing nested folders on the workspace drive and completes through the real UI',
      async () => {
        await fs.mkdir(path.join(root, '.cache'), { recursive: true });
        const volumeDirectory = await fs.mkdtemp(path.join(root, '.cache', 'installer-volume-ui-'));
        const freshTarget = path.join(volumeDirectory, 'not created yet', '中文 子目录', 'FreeCut');
        await assert.rejects(fs.stat(path.dirname(freshTarget)), { code: 'ENOENT' });
        await launch(
          ['--install-dir', freshTarget],
          true,
          path.join(volumeDirectory, 'integrations'),
        );
        await page.getByLabel('Language / 语言', { exact: true }).selectOption('en');
        await expect(page.locator('#target')).toHaveText(freshTarget);
        await expect(page.locator('#primary')).toHaveText('Install FreeCut →');
        await page.locator('#primary').click();
        await expect(page.locator('#completeView')).toBeVisible();
        await expect(page.locator('#completeView')).toContainText('Ready to create.');
        await expect(page.locator('#primary')).toHaveText('Launch FreeCut →');
        assert.equal(
          await fs.readFile(path.join(freshTarget, 'resources/app.asar'), 'utf8'),
          entries['resources/app.asar'],
        );
        report.freshInstallation = {
          drive: path.parse(freshTarget).root,
          target: freshTarget,
          createdMissingParents: true,
          english: true,
        };
        await page.screenshot({ path: path.join(directory, 'installer-english-complete.png') });
        await closeCompleted();
        await backend.uninstall({ target: freshTarget });
        await assert.rejects(fs.stat(freshTarget), { code: 'ENOENT' });
      },
    );
    await check(
      'Custom installer starts with no selected disk and normalizes native root selection',
      async () => {
        await launch([], false); // Preserve the existing testHome fallback without an explicit switch.
        await expect(page.locator('#target')).toHaveText('尚未选择');
        await expect(page.locator('#primary')).toBeDisabled();
        await expect(page.locator('#driveC')).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#driveD')).toHaveAttribute('aria-pressed', 'false');
        // Verify the one-click action without installing test files into real C/D locations.
        await application.evaluate(({ ipcMain }) => {
          globalThis.__driveInstallCalls = [];
          ipcMain.removeHandler('freecut-installer:install');
          ipcMain.handle('freecut-installer:install', (_event, target) => {
            globalThis.__driveInstallCalls.push(target);
          });
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
        const calls = await application.evaluate(() => globalThis.__driveInstallCalls);
        assert.equal(calls.length, driveState.drives.filter((drive) => drive.available).length);
        await application.close();
        application = undefined;
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
            await fs.realpath(shortcut.target),
            await fs.realpath(path.join(target, 'FreeCut.exe')),
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
        await launch(['--uninstall', '--install-dir', target]);
        assert.equal(
          (await page.evaluate(() => window.freecutInstaller.state())).mode,
          'uninstall',
        );
        const powershell = path.join(
          process.env.SystemRoot,
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        );
        const aliasScript = path.join(directory, 'shortcut-alias.ps1'),
          aliasFile = path.join(directory, 'shortcut-alias.txt'),
          ownedExecutable = path.join(target, 'FreeCut.exe');
        await fs.writeFile(
          aliasScript,
          'param([string]$Target,[string]$Output)\r\n$fso=New-Object -ComObject Scripting.FileSystemObject\r\n[IO.File]::WriteAllText($Output,[string]$fso.GetFile($Target).ShortPath,[Text.Encoding]::UTF8)\r\n',
        );
        await execute(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            aliasScript,
            '-Target',
            ownedExecutable,
            '-Output',
            aliasFile,
          ],
          { windowsHide: true },
        );
        const executableAlias = (await fs.readFile(aliasFile, 'utf8')).replace(/^\uFEFF/, '');
        assert.equal(await fs.realpath(executableAlias), await fs.realpath(ownedExecutable));
        assert.notEqual(
          executableAlias.toLowerCase(),
          ownedExecutable.toLowerCase(),
          'Exercise a real existing Windows 8.3 alias',
        );
        const aliasShortcut = path.join(integrationHome, 'Desktop', 'SameTargetAlias.lnk'),
          differentShortcut = path.join(integrationHome, 'Desktop', 'DifferentTarget.lnk'),
          customizedShortcut = path.join(integrationHome, 'Desktop', 'Customized.lnk'),
          runAsShortcut = path.join(integrationHome, 'Desktop', 'RunAsAdministrator.lnk'),
          compatibilityShortcut = path.join(integrationHome, 'Desktop', 'Compatibility.lnk'),
          userLinks = path.join(directory, 'user-owned-links'),
          linkedDirectory = path.join(integrationHome, 'Desktop', 'linked-folder'),
          userOwnedShortcut = path.join(userLinks, 'FreeCut.lnk'),
          linkedShortcut = path.join(linkedDirectory, 'FreeCut.lnk'),
          otherExecutable = path.join(directory, 'another application', 'FreeCut.exe');
        await fs.mkdir(path.dirname(otherExecutable));
        await fs.writeFile(otherExecutable, 'USER OTHER APPLICATION');
        await fs.mkdir(userLinks);
        await fs.symlink(userLinks, linkedDirectory, 'junction');
        await application.evaluate(
          ({ shell }, values) => {
            const standard = {
              target: values.executableAlias,
              cwd: values.target,
              icon: values.executableAlias,
              iconIndex: 0,
              description: '水管剪辑 FreeCut',
            };
            if (!shell.writeShortcutLink(values.aliasShortcut, 'create', standard))
              throw Error('Cannot create actual alias shortcut');
            if (
              !shell.writeShortcutLink(values.differentShortcut, 'create', {
                ...standard,
                target: values.otherExecutable,
              })
            )
              throw Error('Cannot create different-target shortcut');
            if (
              !shell.writeShortcutLink(values.customizedShortcut, 'create', {
                ...standard,
                args: '--user-custom-option',
              })
            )
              throw Error('Cannot create customized shortcut');
            if (!shell.writeShortcutLink(values.userOwnedShortcut, 'create', standard))
              throw Error('Cannot create shortcut behind a directory junction');
          },
          {
            executableAlias,
            target,
            aliasShortcut,
            differentShortcut,
            customizedShortcut,
            userOwnedShortcut,
            otherExecutable,
          },
        );
        // The documented Shell Link header stores LinkFlags at byte20. These
        // fixtures change only a real link's advanced execution flags, leaving
        // all normal UI properties equal to the installation defaults.
        for (const [file, flag] of [
          [runAsShortcut, 0x2000],
          [compatibilityShortcut, 0x20000],
        ]) {
          const bytes = await fs.readFile(aliasShortcut);
          assert.equal(bytes.readUInt32LE(0), 0x4c);
          bytes.writeUInt32LE(bytes.readUInt32LE(20) | flag, 20);
          await fs.writeFile(file, bytes);
        }
        const preservedPaths = [
          differentShortcut,
          customizedShortcut,
          userOwnedShortcut,
          runAsShortcut,
          compatibilityShortcut,
        ];
        const preservedShortcutHashes = await Promise.all(
          preservedPaths.map((file) => backend.sha256(file)),
        );
        report.shortcutIdentity = {
          executable: ownedExecutable,
          executableAlias,
          canonical: await fs.realpath(executableAlias),
        };
        const candidatePaths = [
          ...['Desktop', 'StartMenu'].map((kind) =>
            path.join(integrationHome, kind, 'FreeCut.lnk'),
          ),
          aliasShortcut,
          differentShortcut,
          customizedShortcut,
          linkedShortcut,
          runAsShortcut,
          compatibilityShortcut,
        ];
        report.shortcutBefore = await application.evaluate(
          ({ shell }, files) =>
            files.map((file) => ({ file, metadata: shell.readShortcutLink(file) })),
          candidatePaths,
        );
        for (const candidate of report.shortcutBefore) {
          candidate.canonicalTarget = await fs
            .realpath(candidate.metadata.target)
            .catch((error) => ({ error: error.message }));
          candidate.sha256 = await backend.sha256(candidate.file);
        }
        report.unicodeReader = await readShortcutsUnderWesternCodePage(directory, candidatePaths);
        for (const candidate of report.unicodeReader.links) {
          const before = report.shortcutBefore.find((link) => link.file === candidate.file);
          assert.equal(
            candidate.canonicalTarget.toLowerCase(),
            before.canonicalTarget.toLowerCase(),
          );
          assert.equal(candidate.data.Description, '水管剪辑 FreeCut');
          assert.equal(candidate.data.WorkingDirectory, target);
          assert.equal(
            await fs.realpath(candidate.data.IconPath),
            await fs.realpath(ownedExecutable),
          );
        }
        assert(
          report.unicodeReader.links.find((link) => link.file === runAsShortcut).data.Flags &
            0x2000,
        );
        assert(
          report.unicodeReader.links.find((link) => link.file === compatibilityShortcut).data
            .Flags & 0x20000,
        );
        const helperBytes = await fs.readFile(path.join(__dirname, 'uninstall.ps1'));
        report.helperSource = {
          file: path.join(__dirname, 'uninstall.ps1'),
          bytes: helperBytes.length,
          prefix: helperBytes.subarray(0, 3).toString('hex'),
          sha256: await backend.sha256(path.join(__dirname, 'uninstall.ps1')),
        };
        await application.close();
        application = undefined;
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
            // The same executable has an actual alternate path spelling. The
            // old string-only comparison leaves these owned links behind.
            executable: executableAlias,
            pid: sleeper.pid,
            registryKey: null,
            shortcuts: [
              ...['Desktop', 'StartMenu'].map((kind) =>
                path.join(integrationHome, kind, 'FreeCut.lnk'),
              ),
              aliasShortcut,
              differentShortcut,
              customizedShortcut,
              linkedShortcut,
              runAsShortcut,
              compatibilityShortcut,
            ],
            silent: true,
            logFile,
          }),
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
        let errors = '',
          helperOutput = '';
        helper.stdout.on('data', (chunk) => {
          helperOutput = (helperOutput + chunk).slice(-20000);
        });
        helper.stderr.on('data', (chunk) => (errors += chunk));
        const code = await new Promise((resolve, reject) => {
          helper.once('error', reject);
          helper.once('exit', resolve);
        });
        const result = JSON.parse((await fs.readFile(logFile, 'utf8')).replace(/^\uFEFF/, ''));
        // Keep diagnostics before any outcome assertion: failed CI must explain
        // which actual link/property/check was preserved, including its locale.
        report.helperResult = result;
        console.log(
          'UNINSTALL_DIAGNOSTICS ' +
            JSON.stringify(
              {
                code,
                errors,
                helperOutput,
                source: report.helperSource,
                identity: report.shortcutIdentity,
                before: report.shortcutBefore,
                result,
              },
              null,
              2,
            ),
        );
        assert.equal(code, 0, errors);
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
        await assert.rejects(fs.stat(aliasShortcut), { code: 'ENOENT' });
        assert.deepEqual(
          await Promise.all(preservedPaths.map((file) => backend.sha256(file))),
          preservedShortcutHashes,
        );
        assert((await fs.lstat(linkedDirectory)).isSymbolicLink());
        assert.equal(result.removedShortcuts.length, 3);
        assert.deepEqual(
          result.preservedShortcuts.sort(),
          [
            differentShortcut,
            customizedShortcut,
            linkedShortcut,
            runAsShortcut,
            compatibilityShortcut,
          ].sort(),
        );
        for (const file of [runAsShortcut, compatibilityShortcut]) {
          assert.equal(
            result.shortcutDetails.find((detail) => detail.path === file).reason,
            'Shortcut has user execution customizations.',
          );
        }
        assert.equal(await fs.readFile(otherExecutable, 'utf8'), 'USER OTHER APPLICATION');
        report.shortcutResult = {
          removedOwned: 3,
          preservedDifferentTarget: true,
          preservedCustomized: true,
          preservedJunction: true,
          preservedRunAsAdministrator: true,
          preservedCompatibility: true,
          result,
        };
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
