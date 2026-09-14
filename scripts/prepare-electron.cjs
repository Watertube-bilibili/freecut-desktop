'use strict';
// Install the pinned, checksum-verified runtime before parallel tests. Electron
// 44 no longer downloads it in npm ci; concurrent require() calls must not race.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
async function main() {
  const installer = path.join(path.dirname(require.resolve('electron/package.json')), 'install.js');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = spawnSync(process.execPath, [installer], { stdio: 'inherit', windowsHide: true, timeout: 120000 });
    if (result.status === 0) { console.log('Pinned Electron runtime is ready.'); return; }
    if (attempt < 3) {
      console.log(`Electron download failed; retrying (${attempt}/3).`);
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  throw Error('Could not prepare the pinned Electron runtime after three attempts.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
