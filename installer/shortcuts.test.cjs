'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { shortcutDecision } = require('./shortcuts.cjs');

async function fixture(directory, folder, name = 'freecut-desktop') {
  const target = path.join(directory, folder),
    source = path.join(directory, `${folder}-source`);
  for (const child of ['electron', 'dist'])
    await fs.mkdir(path.join(source, child), { recursive: true });
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name, version: '0.2.0', main: 'electron/main.cjs' }),
  );
  await fs.writeFile(
    path.join(source, 'electron/main.cjs'),
    'throw Error("OLD APP MUST NOT EXECUTE");',
  );
  await fs.writeFile(path.join(source, 'electron/preload.cjs'), '/* fixture */');
  await fs.writeFile(path.join(source, 'dist/index.html'), '<title>Fixture</title>');
  await fs.mkdir(path.join(target, 'resources'), { recursive: true });
  await require('@electron/asar').createPackage(source, path.join(target, 'resources/app.asar'));
  const pe = Buffer.alloc(512);
  pe.write('MZ');
  pe.writeUInt32LE(64, 60);
  pe.writeUInt32LE(0x4550, 64);
  pe.writeUInt16LE(0x8664, 68);
  pe.writeUInt16LE(1, 70);
  pe.writeUInt16LE(240, 84);
  pe.writeUInt16LE(2, 86);
  pe.writeUInt16LE(0x20b, 88);
  await fs.writeFile(path.join(target, 'FreeCut.exe'), pe);
  return target;
}

async function electronChecks(directory) {
  const { app, shell } = require('electron');
  app.setPath('userData', path.join(directory, 'profile'));
  await app.whenReady();
  const target = path.join(directory, 'new application');
  const executable = path.join(target, 'FreeCut.exe');
  const previous = path.join(directory, 'old application');
  const readShortcut = (file) => shell.readShortcutLink(file);
  const cases = [];
  async function check(name, options, operation, afterCreate) {
    const file = path.join(directory, `${cases.length}.lnk`);
    if (options) assert(shell.writeShortcutLink(file, 'create', options));
    if (afterCreate) await afterCreate(file);
    const before = options ? await fs.readFile(file) : null;
    const result = await shortcutDecision({ file, executable, target, readShortcut });
    assert.equal(result.operation, operation, `${name}: ${JSON.stringify(result)}`);
    if (before)
      assert.deepEqual(await fs.readFile(file), before, `${name}: classifier cannot change links`);
    cases.push({ name, operation, reason: result.reason });
    return file;
  }
  const standard = {
    target: executable,
    cwd: target,
    icon: executable,
    iconIndex: 0,
    description: '水管剪辑 FreeCut',
  };
  await check('fresh shortcut', null, 'create');
  const sameFile = await check('same-directory update', standard, 'replace');
  await check(
    'verified legacy installation in another directory',
    {
      ...standard,
      target: path.join(previous, 'FreeCut.exe'),
      cwd: previous,
      icon: path.join(previous, 'FreeCut.exe'),
      description: '自由剪辑 FreeCut — 开源桌面视频编辑器',
    },
    'replace',
  );
  const unknown = path.join(directory, 'unrelated application');
  await check(
    'unrelated Electron app with same executable name',
    {
      ...standard,
      target: path.join(unknown, 'FreeCut.exe'),
      cwd: unknown,
      icon: path.join(unknown, 'FreeCut.exe'),
    },
    'preserve',
  );
  await check('custom arguments', { ...standard, args: '--custom' }, 'preserve');
  await check('custom working directory', { ...standard, cwd: directory }, 'preserve');
  await check('custom description', { ...standard, description: 'My work shortcut' }, 'preserve');
  const otherIcon = path.join(directory, 'personal.ico');
  await fs.copyFile(path.join(__dirname, '..', 'resources', 'icon.ico'), otherIcon);
  await check('custom icon', { ...standard, icon: otherIcon }, 'preserve');
  await check('custom icon index', { ...standard, iconIndex: 1 }, 'preserve');
  for (const [name, flag] of [
    ['run as administrator', 0x2000],
    ['compatibility mode', 0x20000],
  ]) {
    await check(name, standard, 'preserve', async (file) => {
      const bytes = await fs.readFile(file);
      bytes.writeUInt32LE(bytes.readUInt32LE(20) | flag, 20);
      await fs.writeFile(file, bytes);
    });
  }
  await check('custom hotkey', standard, 'preserve', async (file) => {
    const bytes = await fs.readFile(file);
    bytes.writeUInt16LE(0x641, 64);
    await fs.writeFile(file, bytes);
  });
  const data = await fs.readFile(otherIcon);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  const ownedIcon = path.join(
    target,
    'resources',
    'freecut-installer',
    'icons',
    `FreeCut-${hash}.ico`,
  );
  await fs.mkdir(path.dirname(ownedIcon), { recursive: true });
  await fs.writeFile(ownedIcon, data);
  await check('managed content-addressed icon', { ...standard, icon: ownedIcon }, 'replace');
  await check(
    'prior managed icon removed by installation upgrade',
    { ...standard, icon: ownedIcon },
    'replace',
    async () => fs.unlink(ownedIcon),
  );
  await fs.writeFile(ownedIcon, 'USER CUSTOM ICON');
  await check('modified managed icon survives', { ...standard, icon: ownedIcon }, 'preserve');
  const cacheIcon = path.join(process.env.LOCALAPPDATA, 'FreeCut', 'icons', `FreeCut-${hash}.ico`);
  await fs.mkdir(path.dirname(cacheIcon), { recursive: true });
  await fs.writeFile(cacheIcon, data);
  await check('fixed local app cache repair icon', { ...standard, icon: cacheIcon }, 'replace');
  await check(
    'missing local app cache repair icon',
    { ...standard, icon: cacheIcon },
    'replace',
    async () => fs.unlink(cacheIcon),
  );
  await fs.writeFile(cacheIcon, 'USER CUSTOM CACHE ICON');
  await check('modified cache icon survives', { ...standard, icon: cacheIcon }, 'preserve');
  // Real Shell replacement proves target/icon properties are actually written.
  await fs.writeFile(ownedIcon, data);
  assert(shell.writeShortcutLink(sameFile, 'replace', { ...standard, icon: ownedIcon }));
  assert.equal(await fs.realpath(readShortcut(sameFile).icon), await fs.realpath(ownedIcon));
  const aliasScript = path.join(directory, 'alias.ps1');
  await fs.writeFile(
    aliasScript,
    'param([string]$Target)\r\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\r\n$fso=New-Object -ComObject Scripting.FileSystemObject\r\n[Console]::Write([string]$fso.GetFile($Target).ShortPath)\r\n',
  );
  const { stdout } = await promisify(execFile)(
    path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', aliasScript, executable],
    { windowsHide: true, encoding: 'utf8' },
  );
  const alias = stdout.trim();
  assert.equal(await fs.realpath(alias), await fs.realpath(executable));
  if (alias.toLowerCase() !== executable.toLowerCase()) {
    await check(
      'actual Windows 8.3 alias',
      { ...standard, target: alias, cwd: path.dirname(alias), icon: alias },
      'replace',
    );
  } else
    cases.push({
      name: 'actual Windows 8.3 alias',
      skipped: 'Volume does not generate short names.',
    });
  await fs.writeFile(
    path.join(directory, 'result.json'),
    JSON.stringify({ passed: true, cases }, null, 2),
  );
  app.quit();
}

if (process.versions.electron) {
  electronChecks(process.argv[2]).catch((error) => {
    console.error(error);
    require('electron').app.exit(1);
  });
} else {
  const test = require('node:test');
  test(
    'Windows shortcut decisions use real Electron shell links without touching user shortcuts',
    { skip: process.platform !== 'win32', timeout: 90000 },
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-shortcut-test-'));
      await fixture(directory, 'new application');
      await fixture(directory, 'old application');
      await fixture(directory, 'unrelated application', 'another-editor');
      const env = { ...process.env };
      env.LOCALAPPDATA = path.join(directory, 'local-app-data');
      await fs.mkdir(env.LOCALAPPDATA);
      delete env.ELECTRON_RUN_AS_NODE;
      await promisify(execFile)(require('electron'), [__filename, directory], {
        env,
        windowsHide: true,
        timeout: 60000,
      });
      const report = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8'));
      assert.equal(report.passed, true);
      console.log(JSON.stringify({ directory, ...report }));
    },
  );
}
