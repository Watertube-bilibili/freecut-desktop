'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const backend = require('./backend.cjs');

const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
async function workspace(t) {
  // macOS exposes its temporary directory through /var -> /private/var.
  // Fixtures need a real parent; explicit link attack cases below stay linked.
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'freecut-installer-test-'));
  t.after(async () => {
    const absolute = path.resolve(directory);
    assert.equal(path.dirname(absolute), temporaryRoot);
    assert(path.basename(absolute).startsWith('freecut-installer-test-'));
    await fs.rm(absolute, { recursive: true, force: true });
  });
  return directory;
}
async function payload(directory, name, entries, version = '0.3.0') {
  const root = path.join(directory, name);
  await fs.mkdir(path.join(root, 'application'), { recursive: true });
  const files = [];
  for (const [relative, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    await fs.mkdir(path.dirname(path.join(root, 'application', relative)), { recursive: true });
    await fs.writeFile(path.join(root, 'application', relative), data);
    files.push({ path: relative, size: data.length, sha256: digest(data) });
  }
  const manifest = {
    format: 1,
    product: backend.PRODUCT,
    version,
    entryPoint: 'FreeCut.exe',
    files,
  };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}
async function noStagingDirectories(directory) {
  assert(
    !(await fs.readdir(directory)).some((entry) => /^\.freecut-(stage|backup)-/.test(entry)),
    'Private stage/backup directories must be cleaned after success, cancellation or successful rollback',
  );
}

async function legacyFixture(directory, name = 'freecut-desktop') {
  const target = path.join(directory, 'legacy-install'),
    source = path.join(directory, 'old-app-source');
  for (const folder of ['electron', 'dist'])
    await fs.mkdir(path.join(source, folder), { recursive: true });
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name, version: '0.2.0', main: 'electron/main.cjs' }),
  );
  await fs.writeFile(
    path.join(source, 'electron/main.cjs'),
    'throw Error("OLD CODE MUST NEVER EXECUTE");',
  );
  await fs.writeFile(path.join(source, 'electron/preload.cjs'), '/* old preload fixture */');
  await fs.writeFile(path.join(source, 'dist/index.html'), '<title>FreeCut fixture</title>');
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

test('recognized old Electron installation migrates only incoming payload paths and preserves mixed user files', async (t) => {
  const directory = await workspace(t),
    target = await legacyFixture(directory);
  const userFiles = {
    'my-project.freecut': 'MY EDIT',
    'Uninstall FreeCut.exe': 'OLD UNINSTALLER',
    'unins000.dat': 'OLD INNO DATA',
    'resources/my-font.ttf': 'USER FONT',
    'models/model.bin': 'USER MODEL',
    'FreeCutData/preferences.json': 'USER SETTINGS',
  };
  for (const [file, contents] of Object.entries(userFiles)) {
    await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await fs.writeFile(path.join(target, file), contents);
  }
  const source = await payload(
    directory,
    'new-payload',
    {
      'FreeCut.exe': 'new-runtime',
      'resources/app.asar': 'new-archive',
      'resources/new.dat': 'new-component',
    },
    '0.3.1',
  );
  const result = await backend.install({ payloadRoot: source.root, target, update: true });
  assert.equal(result.manifest.migratedFrom, '0.2.0');
  assert.equal(result.manifest.files.length, 3);
  assert.equal(await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'), 'new-runtime');
  for (const [file, contents] of Object.entries(userFiles))
    assert.equal(await fs.readFile(path.join(target, file), 'utf8'), contents);
  assert.equal((await backend.inspectTarget(target, { update: true })).installed.version, '0.3.1');
  await backend.uninstall({ target });
  for (const [file, contents] of Object.entries(userFiles))
    assert.equal(await fs.readFile(path.join(target, file), 'utf8'), contents);
  await noStagingDirectories(directory);
});

test('legacy upgrade cancellation and racing changes preserve the old application with no marker', async (t) => {
  const directory = await workspace(t),
    target = await legacyFixture(directory);
  const oldExe = await fs.readFile(path.join(target, 'FreeCut.exe')),
    oldArchive = await fs.readFile(path.join(target, 'resources/app.asar'));
  const source = await payload(directory, 'new-payload', {
    'FreeCut.exe': 'new',
    'resources/app.asar': 'new app',
  });
  const controller = new AbortController();
  await assert.rejects(
    backend.install({
      payloadRoot: source.root,
      target,
      signal: controller.signal,
      beforeCommit: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.deepEqual(await fs.readFile(path.join(target, 'FreeCut.exe')), oldExe);
  assert.deepEqual(await fs.readFile(path.join(target, 'resources/app.asar')), oldArchive);
  await assert.rejects(fs.stat(path.join(target, backend.OWNERSHIP)), { code: 'ENOENT' });
  await assert.rejects(
    backend.install({
      payloadRoot: source.root,
      target,
      beforeCommit: () =>
        fs.appendFile(path.join(target, 'resources/app.asar'), 'USER RACING EDIT'),
    }),
    /安装期间发生变化/,
  );
  assert.deepEqual(await fs.readFile(path.join(target, 'FreeCut.exe')), oldExe);
  assert.deepEqual(
    await fs.readFile(path.join(target, 'resources/app.asar')),
    Buffer.concat([oldArchive, Buffer.from('USER RACING EDIT')]),
  );
  await assert.rejects(fs.stat(path.join(target, backend.OWNERSHIP)), { code: 'ENOENT' });
  await noStagingDirectories(directory);
});

test('legacy upgrade rolls back replaced files when a new destination appears during staging', async (t) => {
  const directory = await workspace(t),
    target = await legacyFixture(directory);
  const oldExe = await fs.readFile(path.join(target, 'FreeCut.exe')),
    oldArchive = await fs.readFile(path.join(target, 'resources/app.asar'));
  const source = await payload(directory, 'new-payload', {
    'FreeCut.exe': 'new',
    'resources/app.asar': 'new app',
    'new-component.dat': 'payload',
  });
  await assert.rejects(
    backend.install({
      payloadRoot: source.root,
      target,
      beforeCommit: () => fs.writeFile(path.join(target, 'new-component.dat'), 'USER FILE'),
    }),
    /被其他程序创建/,
  );
  assert.deepEqual(await fs.readFile(path.join(target, 'FreeCut.exe')), oldExe);
  assert.deepEqual(await fs.readFile(path.join(target, 'resources/app.asar')), oldArchive);
  assert.equal(await fs.readFile(path.join(target, 'new-component.dat'), 'utf8'), 'USER FILE');
  await assert.rejects(fs.stat(path.join(target, backend.OWNERSHIP)), { code: 'ENOENT' });
  await noStagingDirectories(directory);
});

test('an unrelated Electron package or malformed ASAR cannot authorize overwriting FreeCut.exe', async (t) => {
  const directory = await workspace(t),
    target = await legacyFixture(directory, 'another-editor');
  const source = await payload(directory, 'new-payload', { 'FreeCut.exe': 'new' });
  const before = await backend.sha256(path.join(target, 'FreeCut.exe'));
  await assert.rejects(backend.install({ payloadRoot: source.root, target }), /没有新版安装清单/);
  const malformed = Buffer.alloc(16);
  malformed.writeUInt32LE(4, 0);
  malformed.writeUInt32LE(0xffffffff, 4);
  await fs.writeFile(path.join(target, 'resources/app.asar'), malformed);
  await assert.rejects(backend.install({ payloadRoot: source.root, target }), /没有新版安装清单/);
  assert.equal(await backend.sha256(path.join(target, 'FreeCut.exe')), before);
  await assert.rejects(fs.stat(path.join(target, backend.OWNERSHIP)), { code: 'ENOENT' });
});

test('first installation creates all missing parent and child directories on an existing volume', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'new parent', '中文 子目录', 'FreeCut');
  const source = await payload(directory, 'payload', {
    'FreeCut.exe': 'new',
    'resources/nested/component.bin': 'data',
  });
  await backend.install({ payloadRoot: source.root, target });
  assert.equal(
    await fs.readFile(path.join(target, 'resources/nested/component.bin'), 'utf8'),
    'data',
  );
  await noStagingDirectories(path.dirname(target));
});

test('missing payload files are reported as an incomplete installer, not as a target-drive failure', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'new', 'FreeCut');
  const source = await payload(directory, 'payload', {
    'FreeCut.exe': 'new',
    'resources/app.asar': 'app',
  });
  await fs.unlink(path.join(source.root, 'application/resources/app.asar'));
  await assert.rejects(
    backend.install({ payloadRoot: source.root, target }),
    /安装包缺少程序文件：resources\/app.asar/,
  );
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  await noStagingDirectories(path.dirname(target));
});

test('installer English covers drive, directory creation, legacy migration and incomplete payload messages', () => {
  const { translate } = require('./i18n.js');
  assert.match(
    translate('D 盘不存在或未连接，请选择这台电脑上可用的磁盘。', 'en'),
    /Drive D does not exist/,
  );
  assert.match(
    translate('无法创建安装目录 D:\\Apps。请确认有写入权限，或选择其他目录。\nEACCES', 'en'),
    /Cannot create.*write permissions/s,
  );
  assert.match(
    translate('正在升级 FreeCut 0.2.0，个人工程和模型会保留。', 'en'),
    /Upgrading FreeCut 0.2.0.*kept/,
  );
  assert.match(
    translate('安装包缺少程序文件：resources/app.asar。请重新下载安装器。', 'en'),
    /installer is missing.*app.asar/,
  );
  assert.equal(translate('安装目录无效。', 'zh-CN'), '安装目录无效。');
});

test(
  'a genuinely absent Windows drive reports the drive explicitly without attempting root installation',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const directory = await workspace(t),
      source = await payload(directory, 'payload', { 'FreeCut.exe': 'new' });
    let absent;
    for (const letter of 'ZYXWVUTSRQPONMLKJIHGFED') {
      if (
        await fs.stat(`${letter}:\\`).then(
          () => false,
          (error) => error.code === 'ENOENT',
        )
      ) {
        absent = letter;
        break;
      }
    }
    assert(absent, 'Need an actually absent drive for this Windows regression');
    await assert.rejects(
      backend.install({ payloadRoot: source.root, target: `${absent}:\\FreeCut` }),
      (error) =>
        error.code === 'FREECUT_DRIVE_MISSING' && error.message.startsWith(`${absent} 盘不存在`),
    );
    assert.throws(() => backend.validateTarget(`${absent}:\\`), /磁盘根目录/);
  },
);

test('C/D and arbitrary drive roots normalize to FreeCut but direct backend roots are forbidden', () => {
  assert.equal(backend.normalizeSelection('C:\\', 'win32'), 'C:\\FreeCut');
  assert.equal(backend.normalizeSelection('D:/', 'win32'), 'D:\\FreeCut');
  assert.equal(backend.normalizeSelection('Z:\\', 'win32'), 'Z:\\FreeCut');
  assert.equal(backend.normalizeSelection('D:\\创作应用', 'win32'), 'D:\\创作应用');
  assert.equal(backend.normalizeSelection('', 'win32'), '');
  for (const target of [
    'C:\\',
    'D:/',
    'Z:\\',
    'C:folder',
    'relative',
    '\\\\server\\share\\FreeCut',
    '\\\\?\\C:\\FreeCut',
  ])
    assert.throws(() => backend.validateTarget(target, { platform: 'win32', env: {} }));
});

test('protected Windows folders, invalid device names and path streams are rejected', () => {
  const env = {
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\Test',
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
  };
  for (const target of [
    'C:\\Windows',
    'C:\\Windows\\System32\\FreeCut',
    env.USERPROFILE,
    env.LOCALAPPDATA,
    env.ProgramFiles,
    'C:\\Users\\Test\\Documents',
    'D:\\$Recycle.Bin\\FreeCut',
    'D:\\System Volume Information',
    'D:\\CON',
    'D:\\tool:stream',
    'D:\\FreeCut.',
  ])
    assert.throws(() => backend.validateTarget(target, { platform: 'win32', env }), target);
  assert.equal(
    backend.validateTarget('D:\\Apps\\FreeCut', { platform: 'win32', env }),
    'D:\\Apps\\FreeCut',
  );
  assert.equal(
    backend.validateTarget('C:\\Users\\Test\\Apps\\FreeCut', { platform: 'win32', env }),
    'C:\\Users\\Test\\Apps\\FreeCut',
  );
});

test('manifest rejects traversal, ownership injection, duplicates and parent/file conflicts', () => {
  const entry = { path: 'FreeCut.exe', size: 1, sha256: digest('x') };
  const base = {
    format: 1,
    product: backend.PRODUCT,
    version: '0.3.0',
    entryPoint: 'FreeCut.exe',
    files: [entry],
  };
  for (const relative of [
    '../outside',
    '/outside',
    'resources/../../outside',
    'resources\\outside',
    '.freecut-install.json',
    'C:outside',
    'NUL',
  ])
    assert.throws(() =>
      backend.validateManifest({ ...base, files: [entry, { ...entry, path: relative }] }),
    );
  assert.throws(() =>
    backend.validateManifest({ ...base, files: [entry, { ...entry, path: 'freecut.EXE' }] }),
  );
  assert.throws(() =>
    backend.validateManifest({ ...base, files: [entry, { ...entry, path: 'FreeCut.exe/nested' }] }),
  );
  assert.throws(() => backend.validateManifest({ ...base, product: 'unrelated.application' }));
});

test('real first install verifies payload and keeps existing user projects', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'apps', 'FreeCut');
  const source = await payload(directory, 'payload', {
    'FreeCut.exe': 'executable-v1',
    'resources/app.asar': 'app-v1',
  });
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, '我的工程.freecut'), 'user project');
  const phases = [];
  const result = await backend.install({
    payloadRoot: source.root,
    target,
    onProgress: (progress) => phases.push(progress),
  });
  assert.equal(await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'), 'executable-v1');
  assert.equal(await fs.readFile(path.join(target, '我的工程.freecut'), 'utf8'), 'user project');
  assert.equal(result.manifest.version, '0.3.0');
  assert.equal(
    (await backend.inspectTarget(target, { update: true })).installed.installId,
    result.manifest.installId,
  );
  assert(phases.some((entry) => entry.phase === 'copying' && entry.cancellable));
  assert(phases.some((entry) => entry.phase === 'committing' && !entry.cancellable));
  await noStagingDirectories(path.dirname(target));
});

test('update replaces owned files, removes obsolete app files, and preserves models and documents', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'FreeCut');
  const v1 = await payload(directory, 'v1', {
    'FreeCut.exe': 'exe-one',
    'resources/app.asar': 'app-one',
    'obsolete.dll': 'old-library',
  });
  const old = await backend.install({ payloadRoot: v1.root, target });
  await fs.mkdir(path.join(target, 'models'));
  await fs.writeFile(path.join(target, 'models', 'user-model.bin'), 'keep model');
  await fs.writeFile(path.join(target, 'recording.wav'), 'keep recording');
  const v2 = await payload(
    directory,
    'v2',
    { 'FreeCut.exe': 'exe-two', 'resources/app.asar': 'app-two', 'new.dll': 'new-library' },
    '0.3.1',
  );
  const result = await backend.install({ payloadRoot: v2.root, target, update: true });
  assert.equal(result.manifest.installId, old.manifest.installId);
  assert.equal(result.manifest.version, '0.3.1');
  assert.equal(await fs.readFile(path.join(target, 'resources/app.asar'), 'utf8'), 'app-two');
  await assert.rejects(fs.stat(path.join(target, 'obsolete.dll')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(target, 'models/user-model.bin'), 'utf8'), 'keep model');
  assert.equal(await fs.readFile(path.join(target, 'recording.wav'), 'utf8'), 'keep recording');
  await noStagingDirectories(directory);
});

test('unknown FreeCut.exe and automatic update without ownership are refused without modifications', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'FreeCut');
  const source = await payload(directory, 'payload', { 'FreeCut.exe': 'new' });
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'FreeCut.exe'), 'unknown existing executable');
  await assert.rejects(backend.install({ payloadRoot: source.root, target }), /没有新版安装清单/);
  await assert.rejects(
    backend.install({ payloadRoot: source.root, target, update: true }),
    /自动更新仅支持/,
  );
  assert.equal(
    await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'),
    'unknown existing executable',
  );
});

test('a corrupted payload cannot alter an existing installation', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'FreeCut');
  const source = await payload(directory, 'payload', {
    'FreeCut.exe': 'original',
    'resources/app.asar': 'contents',
  });
  await backend.install({ payloadRoot: source.root, target });
  const marker = await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8');
  await fs.writeFile(path.join(source.root, 'application', 'FreeCut.exe'), 'tampered');
  await assert.rejects(
    backend.install({ payloadRoot: source.root, target, update: true }),
    /SHA-256/,
  );
  assert.equal(await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8'), marker);
  await noStagingDirectories(directory);
});

test('cancellation after staging leaves old installation byte-identical and permits retry', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'FreeCut');
  const v1 = await payload(directory, 'v1', { 'FreeCut.exe': 'old' });
  await backend.install({ payloadRoot: v1.root, target });
  const marker = await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8');
  const v2 = await payload(
    directory,
    'v2',
    { 'FreeCut.exe': 'new', 'resources/data.bin': Buffer.alloc(131072, 7) },
    '0.3.1',
  );
  const controller = new AbortController();
  await assert.rejects(
    backend.install({
      payloadRoot: v2.root,
      target,
      update: true,
      signal: controller.signal,
      beforeCommit: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  assert.equal(await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8'), marker);
  await noStagingDirectories(directory);
  await backend.install({ payloadRoot: v2.root, target, update: true });
  assert.equal(await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'), 'new');
});

test('commit collision rolls back prior files and preserves the racing unrelated file', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'FreeCut');
  const v1 = await payload(directory, 'v1', {
    'FreeCut.exe': 'old',
    'resources/app.asar': 'old-app',
  });
  await backend.install({ payloadRoot: v1.root, target });
  const marker = await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8');
  const v2 = await payload(directory, 'v2', { 'FreeCut.exe': 'new', 'new.txt': 'payload file' });
  await assert.rejects(
    backend.install({
      payloadRoot: v2.root,
      target,
      update: true,
      beforeCommit: async () =>
        fs.writeFile(path.join(target, 'new.txt'), 'unrelated file created during installation'),
    }),
    /被其他程序创建/,
  );
  assert.equal(await fs.readFile(path.join(target, 'FreeCut.exe'), 'utf8'), 'old');
  assert.equal(await fs.readFile(path.join(target, 'resources/app.asar'), 'utf8'), 'old-app');
  assert.equal(await fs.readFile(path.join(target, backend.OWNERSHIP), 'utf8'), marker);
  assert.equal(
    await fs.readFile(path.join(target, 'new.txt'), 'utf8'),
    'unrelated file created during installation',
  );
  await noStagingDirectories(directory);
});

test('directory junctions and symbolic links cannot redirect installation', async (t) => {
  const directory = await workspace(t),
    outside = path.join(directory, 'outside'),
    linked = path.join(directory, 'linked');
  await fs.mkdir(outside);
  await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const source = await payload(directory, 'payload', { 'FreeCut.exe': 'new' });
  await assert.rejects(
    backend.install({ payloadRoot: source.root, target: path.join(linked, 'FreeCut') }),
    /符号链接|目录联接/,
  );
  assert.deepEqual(await fs.readdir(outside), []);
});

test('uninstall only removes unchanged owned files and preserves edits and other data', async (t) => {
  const directory = await workspace(t),
    target = path.join(directory, 'FreeCut');
  const source = await payload(directory, 'payload', {
    'FreeCut.exe': 'executable',
    'resources/app.asar': 'app archive',
    'license.txt': 'bundled notice',
  });
  await backend.install({ payloadRoot: source.root, target });
  await fs.writeFile(path.join(target, 'license.txt'), 'user-edited file');
  await fs.writeFile(path.join(target, 'my-project.freecut'), 'personal project');
  const result = await backend.uninstall({ target });
  assert.deepEqual(result.preserved, ['license.txt']);
  assert.equal(await fs.readFile(path.join(target, 'license.txt'), 'utf8'), 'user-edited file');
  assert.equal(
    await fs.readFile(path.join(target, 'my-project.freecut'), 'utf8'),
    'personal project',
  );
  await assert.rejects(fs.stat(path.join(target, 'FreeCut.exe')), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(target, backend.OWNERSHIP)), { code: 'ENOENT' });
});

test('in-place preparation and install use one runtime and retain byte-identical product archives', async (t) => {
  const directory = await workspace(t),
    source = path.join(directory, 'prepackaged'),
    target = path.join(directory, 'installed');
  await fs.mkdir(path.join(source, 'resources', 'freecut-installer'), { recursive: true });
  await fs.writeFile(path.join(source, 'FreeCut.exe'), 'ONE ELECTRON RUNTIME');
  await fs.writeFile(path.join(source, 'resources', 'app.asar'), 'ORIGINAL PRODUCT ASAR');
  await fs.writeFile(
    path.join(source, 'resources', 'freecut-installer', 'main.cjs'),
    'CUSTOM UI ENTRY',
  );
  const run = require('node:util').promisify(require('node:child_process').execFile);
  const prepare = () =>
    run(
      process.execPath,
      [
        path.join(__dirname, 'prepare-payload.cjs'),
        '--source',
        source,
        '--in-place',
        '--version',
        '0.3.0',
      ],
      { windowsHide: true },
    );
  await prepare();
  const first = await backend.readManifest(path.join(source, backend.EMBEDDED_MANIFEST));
  await prepare();
  const second = await backend.readManifest(path.join(source, backend.EMBEDDED_MANIFEST));
  assert.deepEqual(first, second, 'Rebuilding must exclude the old manifest, not hash itself');
  assert.equal(second.files.length, 3);
  await assert.rejects(fs.stat(path.join(source, 'application')), { code: 'ENOENT' });
  const result = await backend.install({ payloadRoot: source, embedded: true, target });
  assert.equal(
    await fs.readFile(path.join(target, 'resources', 'app.asar'), 'utf8'),
    'ORIGINAL PRODUCT ASAR',
  );
  assert.equal(
    await backend.sha256(path.join(target, 'FreeCut.exe')),
    await backend.sha256(path.join(source, 'FreeCut.exe')),
  );
  await assert.rejects(fs.stat(path.join(target, backend.EMBEDDED_MANIFEST)), { code: 'ENOENT' });
  assert.equal(result.manifest.files.length, 3);
});

test('embedded payload keeps hash rejection and cannot install its own manifest', async (t) => {
  const directory = await workspace(t),
    source = path.join(directory, 'payload'),
    target = path.join(directory, 'installed');
  await fs.mkdir(path.join(source, 'resources', 'freecut-installer'), { recursive: true });
  await fs.writeFile(path.join(source, 'FreeCut.exe'), 'same-size-tamper');
  const manifest = {
    format: 1,
    product: backend.PRODUCT,
    version: '0.3.0',
    entryPoint: 'FreeCut.exe',
    files: [{ path: 'FreeCut.exe', size: 16, sha256: digest('original-binary!') }],
  };
  manifest.files[0].size = Buffer.byteLength('same-size-tamper');
  const file = path.join(source, backend.EMBEDDED_MANIFEST);
  await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(backend.install({ payloadRoot: source, embedded: true, target }), /SHA-256/);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  manifest.files.push({ path: backend.EMBEDDED_MANIFEST, size: 0, sha256: digest('') });
  await fs.writeFile(file, JSON.stringify(manifest));
  await assert.rejects(backend.install({ payloadRoot: source, embedded: true, target }), /自身/);
  await noStagingDirectories(directory);
});

test('an embedded manifest cannot be read through a parent directory junction', async (t) => {
  const directory = await workspace(t),
    source = path.join(directory, 'source'),
    outside = path.join(directory, 'outside');
  await fs.mkdir(source);
  await fs.mkdir(path.join(outside, 'freecut-installer'), { recursive: true });
  await fs.writeFile(path.join(source, 'FreeCut.exe'), 'runtime');
  await fs.writeFile(
    path.join(outside, 'freecut-installer', 'payload-manifest.json'),
    JSON.stringify({
      format: 1,
      product: backend.PRODUCT,
      version: '0.3.0',
      entryPoint: 'FreeCut.exe',
      files: [{ path: 'FreeCut.exe', size: 7, sha256: digest('runtime') }],
    }),
  );
  await fs.symlink(
    outside,
    path.join(source, 'resources'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    backend.install({
      payloadRoot: source,
      embedded: true,
      target: path.join(directory, 'installed'),
    }),
    /符号链接|目录联接/,
  );
});
