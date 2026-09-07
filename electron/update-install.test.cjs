'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const { hashFile } = require('./updater.cjs');
const { portableTarget } = require('./update-install.cjs');
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const helper = path.join(__dirname, 'update-portable.ps1');
const quotePS = (value) => "'" + value.replaceAll("'", "''") + "'";
async function waitForFile(file, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (
      await fs.stat(file).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out waiting for the independent helper: ${file}`);
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-update-helper-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  return dir;
}
async function compile(file, code, outputType = 'ConsoleApplication') {
  await run(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -TypeDefinition ${quotePS(code)} -OutputAssembly ${quotePS(file)} -OutputType ${outputType}`,
    ],
    { windowsHide: true },
  );
}
test('portable target is the precise executable in the launcher directory', () => {
  const dir = path.resolve(os.tmpdir(), 'FreeCut isolated');
  assert.equal(
    portableTarget({
      PORTABLE_EXECUTABLE_DIR: dir,
      PORTABLE_EXECUTABLE_APP_FILENAME: 'FreeCut.exe',
    }),
    path.join(dir, 'FreeCut.exe'),
  );
  assert.throws(() =>
    portableTarget({
      PORTABLE_EXECUTABLE_DIR: dir,
      PORTABLE_EXECUTABLE_FILE: path.join(dir, '..', 'elsewhere.exe'),
    }),
  );
});
test(
  'real Windows helper replaces and launches only the temporary executable; startup failure rolls back',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const dir = await temporary(t);
    const old = path.join(dir, 'old.exe'),
      good = path.join(dir, 'good.exe'),
      bad = path.join(dir, 'bad.exe');
    await compile(old, 'class Program { static int Main() { return 0; } }');
    await compile(
      good,
      'class Program { static int Main() { System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("FREECUT_UPDATER_TEST_MARKER"), "new executable started"); return 0; } }',
    );
    await compile(bad, 'class Program { static int Main() { return 7; } }');
    for (const scenario of ['success', 'startup-failure', 'checksum-failure']) {
      await t.test(scenario, async () => {
        const fixture = path.join(dir, `中文 空格-${scenario}`);
        await fs.mkdir(fixture);
        const target = path.join(fixture, 'FreeCut.exe'),
          source = path.join(fixture, 'download.exe'),
          marker = path.join(fixture, 'started.txt');
        const userData = path.join(fixture, 'FreeCutData');
        await fs.mkdir(userData);
        await fs.writeFile(path.join(userData, 'project.freecut'), 'existing project remains');
        await fs.copyFile(old, target);
        await fs.copyFile(scenario === 'startup-failure' ? bad : good, source);
        const originalHash = await hashFile(target),
          sourceHash = await hashFile(source);
        // Use a completed child PID, never the editor or test runner PID.
        let stoppedPid;
        const stopped = execFile(
          powershell,
          ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'],
          { windowsHide: true },
        );
        stoppedPid = stopped.pid;
        await new Promise((resolve, reject) => {
          stopped.once('exit', resolve);
          stopped.once('error', reject);
        });
        const plan = path.join(fixture, 'plan.json');
        await fs.writeFile(
          plan,
          JSON.stringify({
            source,
            target,
            processId: stoppedPid,
            sha256: scenario === 'checksum-failure' ? '0'.repeat(64) : sourceHash,
          }),
        );
        const operation = run(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            helper,
            '-Plan',
            plan,
            '-Quiet',
          ],
          {
            windowsHide: true,
            timeout: 20000,
            env: { ...process.env, FREECUT_UPDATER_TEST_MARKER: marker },
          },
        );
        if (scenario === 'success') {
          await operation;
          assert.equal(await fs.readFile(marker, 'utf8'), 'new executable started');
          assert.equal(await hashFile(target), sourceHash);
          await assert.rejects(fs.stat(source), { code: 'ENOENT' });
          assert(!(await fs.readdir(fixture)).some((name) => name.startsWith('.freecut-backup-')));
        } else {
          await assert.rejects(operation);
          assert.equal(await hashFile(target), originalHash);
          assert.equal(await hashFile(source), sourceHash);
          const error = await fs.readFile(path.join(fixture, 'error.txt'), 'utf8');
          assert.match(
            error,
            scenario === 'startup-failure' ? /Previous application restored/ : /Checksum mismatch/,
          );
          await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
        }
        assert.equal(
          await fs.readFile(path.join(userData, 'project.freecut'), 'utf8'),
          'existing project remains',
        );
      });
    }
  },
);

test(
  'real Node and Electron parents call prepareUpdateInstall then exit before the portable helper replaces and starts the temporary executable',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const dir = await temporary(t),
      old = path.join(dir, 'old.exe'),
      replacement = path.join(dir, 'replacement.exe'),
      guiSetup = path.join(dir, 'setup-gui.exe');
    await compile(old, 'class Program { static int Main() { return 0; } }');
    await compile(
      replacement,
      'class Program { static int Main() { System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("FREECUT_UPDATER_TEST_MARKER"), "new executable started after parent exit"); return 0; } }',
    );
    await compile(
      guiSetup,
      'class Program { static int Main(string[] args) { System.Threading.Thread.Sleep(1200); System.IO.File.WriteAllText(System.Environment.GetEnvironmentVariable("FREECUT_UPDATER_TEST_MARKER"), string.Join("\\n", args)); return 0; } }',
      'WindowsApplication',
    );
    const parentScript = path.join(dir, 'update-parent.cjs');
    // These are real parents, not an execFile of the PowerShell script. In
    // particular, Electron runs the real module's spawn options and unref path.
    await fs.writeFile(
      parentScript,
      `const fs = require('node:fs/promises');
const { prepareUpdateInstall } = require(${JSON.stringify(path.join(__dirname, 'update-install.cjs'))});
const electron = process.versions.electron ? require('electron') : null;
(async () => {
  if (electron) await electron.app.whenReady();
  const settings = JSON.parse(await fs.readFile(process.env.FREECUT_UPDATER_TEST_PLAN, 'utf8'));
  const launch = await prepareUpdateInstall({ ...settings, env: process.env, pid: process.pid });
  await launch();
  await fs.writeFile(settings.parentMarker, String(process.pid));
  if (electron) electron.app.quit();
  else process.exit(0);
})().catch(error => { console.error(error); if (electron) electron.app.exit(1); else process.exit(1); });
`,
    );
    for (const parent of ['node', 'electron', 'electron-setup-gui']) {
      await t.test(parent, async () => {
        const setupMode = parent === 'electron-setup-gui';
        const fixture = path.join(dir, `中文 父进程-${parent}`),
          target = path.join(fixture, 'FreeCut.exe'),
          source = path.join(fixture, 'download.exe'),
          userData = path.join(fixture, 'FreeCutData'),
          marker = path.join(fixture, 'started.txt'),
          parentMarker = path.join(fixture, 'parent-returned.txt'),
          plan = path.join(fixture, 'test-plan.json');
        await fs.mkdir(path.join(userData, 'updates'), { recursive: true });
        await fs.copyFile(old, target);
        await fs.copyFile(setupMode ? guiSetup : replacement, source);
        if (setupMode) await fs.writeFile(path.join(fixture, '.freecut-install.json'), '{}');
        await fs.writeFile(path.join(userData, 'project.freecut'), 'existing project remains');
        const sha256 = await hashFile(source);
        await fs.writeFile(
          plan,
          JSON.stringify({
            asset: { file: source, sha256 },
            userData,
            portable: !setupMode,
            platform: 'win32',
            executable: target,
            parentMarker,
          }),
        );
        const env = {
          ...process.env,
          FREECUT_UPDATER_TEST_PLAN: plan,
          FREECUT_UPDATER_TEST_MARKER: marker,
          PORTABLE_EXECUTABLE_DIR: fixture,
          PORTABLE_EXECUTABLE_FILE: target,
        };
        delete env.ELECTRON_RUN_AS_NODE;
        await run(
          parent.startsWith('electron') ? require('electron') : process.execPath,
          parent.startsWith('electron')
            ? [parentScript, `--user-data-dir=${path.join(fixture, 'isolated-electron-profile')}`]
            : [parentScript],
          { env, cwd: fixture, windowsHide: true, timeout: 45000 },
        );
        const parentPid = Number(await fs.readFile(parentMarker, 'utf8'));
        assert.throws(() => process.kill(parentPid, 0), { code: 'ESRCH' });
        await waitForFile(marker);
        if (setupMode) {
          assert.deepEqual((await fs.readFile(marker, 'utf8')).split('\n'), [
            '--update',
            '--install-dir',
            fixture,
            '--auto-run',
            '--wait-pid',
            String(parentPid),
          ]);
          assert.equal(await hashFile(source), sha256);
          assert.equal(await hashFile(target), await hashFile(old));
          assert.equal(
            await fs.readFile(path.join(userData, 'project.freecut'), 'utf8'),
            'existing project remains',
          );
          return;
        }
        assert.equal(await fs.readFile(marker, 'utf8'), 'new executable started after parent exit');
        const helperName = (await fs.readdir(path.join(userData, 'updates'))).find((name) =>
          name.startsWith('apply-'),
        );
        assert(helperName, 'the real prepareUpdateInstall created the helper directory');
        await waitForFile(path.join(userData, 'updates', helperName, 'result.txt'));
        assert.equal(await hashFile(target), sha256);
        await assert.rejects(fs.stat(source), { code: 'ENOENT' });
        assert(!(await fs.readdir(fixture)).some((name) => name.startsWith('.freecut-backup-')));
        assert.equal(
          await fs.readFile(path.join(userData, 'project.freecut'), 'utf8'),
          'existing project remains',
        );
      });
    }
  },
);
