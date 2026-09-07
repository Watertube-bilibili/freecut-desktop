'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { sha256 } = require('../installer/backend.cjs');
const root = path.resolve(__dirname, '..');
function run(executable, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(Error(`Packaging failed (${code})`)),
    );
  });
}
async function main() {
  if (process.platform !== 'win32')
    throw Error('The custom Windows installer must be built on Windows.');
  const { version } = require('../package.json');
  const payload = path.join(root, 'release', 'win-unpacked');
  const archive = path.join(payload, 'resources', 'app.asar');
  const executable = path.join(payload, 'FreeCut.exe');
  const before = { archive: await sha256(archive), executable: await sha256(executable) };
  await run(process.execPath, [
    'installer/prepare-payload.cjs',
    '--source',
    payload,
    '--in-place',
    '--version',
    version,
  ]);
  await run(process.execPath, [
    'node_modules/electron-builder/out/cli/cli.js',
    '--config',
    'installer-builder.cjs',
    '--win',
    'nsis',
    '--prepackaged',
    payload,
    '--x64',
    '--publish',
    'never',
  ]);
  if (
    (await sha256(archive)) !== before.archive ||
    (await sha256(executable)) !== before.executable
  )
    throw Error('Installer packaging changed the product executable or app.asar');
  const name = `FreeCut-${version}-win-x64-Setup.exe`;
  await fs.copyFile(path.join(root, 'release', 'setup', name), path.join(root, 'release', name));
  console.log(`Custom installer ready: release/${name}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
