'use strict';
// Packaging-only config: --prepackaged keeps the product app.asar and its one
// Electron runtime. NSIS provides compression and launch, with no wizard UI.
const { version } = require('./package.json');
module.exports = {
  appId: 'org.freecut.desktop',
  productName: 'FreeCut',
  directories: { output: 'release/setup' },
  win: {
    icon: 'resources/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    signExecutable: false,
  },
  nsis: {
    script: 'installer/bootstrap.nsi',
    artifactName: `FreeCut-${version}-win-x64-Setup.exe`,
    oneClick: true,
    perMachine: false,
    packElevateHelper: false,
    preCompressedFileExtensions: [],
  },
  publish: null,
};
