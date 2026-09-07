'use strict';
// Run after the real electron-builder ZIP target. This never opens the app or
// changes an installation; extraction is confined to a new temporary directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--arch' || !['x64', 'arm64'].includes(args[1]))
    throw Error('Usage: node scripts/verify-mac-update.cjs --arch x64|arm64');
  if (process.platform !== 'darwin') throw Error('macOS codesign and ditto are required');
  const root = path.resolve(__dirname, '..');
  const { version } = require('../package.json');
  const arch = args[1];
  const zip = path.join(root, 'release', `FreeCut-${version}-mac-${arch}.zip`);
  assert((await fs.stat(zip)).isFile(), 'Expected real packaged ZIP');
  const { stdout } = await run('/usr/bin/unzip', ['-Z1', zip], { maxBuffer: 32 * 1024 * 1024 });
  const entries = stdout.trimEnd().split('\n');
  assert(entries.length > 1, 'ZIP must contain the application bundle');
  for (const item of entries) {
    assert(item.startsWith('FreeCut.app/'), `Updater rejects ZIP entry: ${item}`);
    assert(
      !item.split('/').some((part) => part === '.' || part === '..'),
      `Unsafe ZIP entry: ${item}`,
    );
    assert(!/[\\\r\0]/.test(item), `Ambiguous ZIP entry: ${item}`);
  }
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-mac-update-zip-'));
  try {
    await run('/usr/bin/ditto', ['-x', '-k', zip, stage]);
    const app = path.join(stage, 'FreeCut.app');
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const plist = path.join(app, 'Contents', 'Info.plist');
    const value = async (key) =>
      (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])).stdout.trim();
    assert.equal(await value('CFBundleIdentifier'), 'org.freecut.desktop');
    assert.equal(await value('CFBundleShortVersionString'), version);
    const executable = await value('CFBundleExecutable');
    assert.equal(executable, 'FreeCut');
    const architectures = (
      await run('/usr/bin/lipo', ['-archs', path.join(app, 'Contents', 'MacOS', executable)])
    ).stdout
      .trim()
      .split(/\s+/);
    assert(
      architectures.includes(arch === 'x64' ? 'x86_64' : 'arm64'),
      'ZIP architecture does not match its file name',
    );
    const report = {
      passed: true,
      zip,
      entries: entries.length,
      version,
      bundleId: 'org.freecut.desktop',
      architectures,
      codesign: 'verified --deep --strict',
      launched: false,
    };
    const reportPath = path.join(root, 'artifacts', 'smoke', `mac-update-zip-${arch}.json`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    // This exact path was returned by mkdtemp; no installation path is accepted.
    assert(
      path.dirname(stage) === os.tmpdir() &&
        path.basename(stage).startsWith('freecut-mac-update-zip-'),
    );
    await fs.rm(stage, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
