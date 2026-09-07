'use strict';

// Electron's normal fs interprets *.asar as virtual folders. An installer must
// copy/hash the actual archive bytes, including archives inside its payload.
const nativeFs = process.versions.electron ? require('original-fs') : require('node:fs');
const fs = nativeFs.promises;
const { createReadStream, createWriteStream } = nativeFs;
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { identifyLegacy } = require('./legacy.cjs');

const PRODUCT = 'org.freecut.desktop';
const OWNERSHIP = '.freecut-install.json';
const EMBEDDED_MANIFEST = 'resources/freecut-installer/payload-manifest.json';
const MAX_FILES = 100000;
const MAX_BYTES = 30 * 1024 ** 3;
const fail = (message) => {
  throw new Error(message);
};
const aborted = (signal) => {
  if (signal?.aborted) throw Object.assign(new Error('安装已取消。'), { name: 'AbortError' });
};
const exists = async (file) =>
  fs.lstat(file).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

/** UI selections may be drive roots; the actual install operation never accepts one. */
function normalizeSelection(input, platform = process.platform) {
  if (typeof input !== 'string' || !input.trim()) return '';
  const paths = platform === 'win32' ? path.win32 : path;
  const value = paths.normalize(input.trim());
  if (!paths.isAbsolute(value)) fail('请选择绝对路径。');
  return value.toLowerCase() === paths.parse(value).root.toLowerCase()
    ? paths.join(value, 'FreeCut')
    : value;
}

function validateTarget(input, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = platform === 'win32' ? path.win32 : path;
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) fail('安装目录无效。');
  if (platform === 'win32' && !/^[a-z]:[\\/]/i.test(input)) fail('请选择本机磁盘上的完整目录。');
  if (!paths.isAbsolute(input)) fail('安装目录必须是绝对路径。');
  const target = paths.normalize(input.trim());
  const canonical = (value) =>
    paths
      .normalize(value)
      .replace(/[\\/]+$/, '')
      .toLowerCase();
  if (canonical(target) === canonical(paths.parse(target).root))
    fail('不能直接安装到磁盘根目录，请选择 FreeCut 子目录。');
  if (platform === 'win32') {
    const parts = target.slice(3).split(/[\\/]/);
    for (const part of parts) {
      if (
        !part ||
        /[<>:"|?*\x00-\x1f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
        fail('安装目录包含 Windows 不支持的名称。');
    }
  }
  const exact = [
    env.USERPROFILE,
    env.HOME,
    env.APPDATA,
    env.LOCALAPPDATA,
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramData,
    env.PUBLIC,
    env.USERPROFILE && paths.join(env.USERPROFILE, 'Desktop'),
    env.USERPROFILE && paths.join(env.USERPROFILE, 'Documents'),
    env.USERPROFILE && paths.join(env.USERPROFILE, 'Downloads'),
  ].filter(Boolean);
  if (exact.some((directory) => canonical(directory) === canonical(target)))
    fail('请选择独立的 FreeCut 文件夹，不要直接使用系统或个人文件目录。');
  const protectedRoots = [...(options.forbiddenRoots ?? [])];
  if (platform === 'win32')
    protectedRoots.push(
      env.SystemRoot ?? 'C:\\Windows',
      paths.join(paths.parse(target).root, 'System Volume Information'),
      paths.join(paths.parse(target).root, '$Recycle.Bin'),
      paths.join(paths.parse(target).root, 'Recovery'),
    );
  for (const directory of protectedRoots) {
    const relative = paths.relative(directory, target);
    if (!relative || (!relative.startsWith('..') && !paths.isAbsolute(relative)))
      fail('这个目录用于系统或安装器运行，请选择其他目录。');
  }
  return target;
}

function safeRelative(input) {
  if (
    typeof input !== 'string' ||
    !input ||
    input.length > 1500 ||
    input.includes('\\') ||
    input.startsWith('/') ||
    input === OWNERSHIP
  )
    fail('安装清单包含无效文件路径。');
  const segments = input.split('/');
  if (
    segments.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[<>:"|?*\x00-\x1f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    fail('安装清单包含危险文件路径。');
  return segments.join('/');
}

function validateManifest(value) {
  if (
    !value ||
    value.format !== 1 ||
    value.product !== PRODUCT ||
    typeof value.version !== 'string' ||
    !/^[\w.+-]{1,80}$/.test(value.version) ||
    value.entryPoint !== 'FreeCut.exe' ||
    !Array.isArray(value.files) ||
    !value.files.length ||
    value.files.length > MAX_FILES
  )
    fail('FreeCut 安装清单无效或不属于本应用。');
  let totalBytes = 0;
  const seen = new Set();
  for (const entry of value.files) {
    const relative = safeRelative(entry.path);
    if (seen.has(relative.toLowerCase())) fail('安装清单包含重复文件。');
    seen.add(relative.toLowerCase());
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256))
      fail('安装文件的大小或校验信息无效。');
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_BYTES)
      fail('安装文件总大小超出限制。');
  }
  if (!seen.has('freecut.exe')) fail('安装文件中缺少 FreeCut.exe。');
  // A file cannot also be another file's parent directory.
  for (const entry of value.files) {
    const parts = entry.path.toLowerCase().split('/');
    while (parts.length > 1) {
      parts.pop();
      if (seen.has(parts.join('/'))) fail('安装清单的文件和目录发生冲突。');
    }
  }
  return { ...value, totalBytes };
}

async function readManifest(file) {
  await assertNoLinks(file);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 ** 2)
    fail('安装清单不是可读取的普通文件。');
  return validateManifest(JSON.parse(await fs.readFile(file, 'utf8')));
}

async function assertNoLinks(absolute) {
  let current = path.resolve(absolute);
  for (;;) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) fail('安装目录不能包含符号链接或目录联接，请选择实际目录。');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const data of createReadStream(file)) hash.update(data);
  return hash.digest('hex');
}

async function removeTemporary(directory, parent) {
  const absolute = path.resolve(directory),
    expectedParent = path.resolve(parent);
  if (
    path.dirname(absolute) !== expectedParent ||
    !/^\.freecut-(stage|backup)-[a-f0-9-]+$/.test(path.basename(absolute))
  )
    fail('临时目录清理校验失败。');
  await assertNoLinks(absolute);
  await fs.rm(absolute, { recursive: true, force: true });
}

async function pruneEmpty(target, relatives) {
  const parents = new Set();
  for (const relative of relatives) {
    let directory = path.dirname(path.join(target, relative));
    while (directory !== target && directory.startsWith(target + path.sep)) {
      parents.add(directory);
      directory = path.dirname(directory);
    }
  }
  for (const directory of [...parents].sort((a, b) => b.length - a.length)) {
    await assertNoLinks(directory);
    await fs.rmdir(directory).catch((error) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    });
  }
}

async function inspectTarget(input, options = {}) {
  const target = validateTarget(input, options);
  await assertVolumeAvailable(target);
  await assertNoLinks(target);
  if (await exists(target)) {
    if (!(await fs.lstat(target)).isDirectory()) fail('安装目标已被一个文件占用。');
  }
  const ownership = path.join(target, OWNERSHIP);
  const installed = (await exists(ownership)) ? await readManifest(ownership) : null;
  if (
    installed &&
    (typeof installed.installId !== 'string' ||
      !/^[a-f0-9-]{36}$/i.test(installed.installId) ||
      typeof installed.installedAt !== 'string')
  )
    fail('现有 FreeCut 安装标记不完整，请另选目录。');
  if (options.update && !installed)
    fail('自动更新仅支持有 FreeCut 安装清单的现有安装，请手动选择安装目录。');
  return { target, installed };
}

async function assertVolumeAvailable(target) {
  if (process.platform !== 'win32') return;
  const root = path.parse(target).root;
  try {
    if (!(await fs.stat(root)).isDirectory()) throw Object.assign(Error(), { code: 'ENOENT' });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ENODEV'].includes(error.code))
      throw Object.assign(
        Error(`${root.slice(0, 1)} 盘不存在或未连接，请选择这台电脑上可用的磁盘。`),
        { code: 'FREECUT_DRIVE_MISSING' },
      );
    throw error;
  }
}

async function install({
  payloadRoot,
  target: input,
  embedded = false,
  update = false,
  signal,
  onProgress = () => {},
  beforeCommit,
  ...options
}) {
  const payload = path.resolve(payloadRoot);
  await assertNoLinks(payload);
  const manifest = await readManifest(
    path.join(payload, embedded ? EMBEDDED_MANIFEST : 'manifest.json'),
  );
  if (
    embedded &&
    manifest.files.some((entry) => entry.path.toLowerCase() === EMBEDDED_MANIFEST.toLowerCase())
  )
    fail('内置安装清单不能包含自身。');
  const { target, installed } = await inspectTarget(input, {
    ...options,
    // Legacy migration is supported by installation only. Uninstall still
    // requires a committed ownership marker and never guesses which files to delete.
    update: false,
    forbiddenRoots: [payload, ...(options.forbiddenRoots ?? [])],
  });
  const legacy = !installed ? await identifyLegacy(target, assertNoLinks) : null;
  if (update && !installed && !legacy)
    fail('自动更新仅支持可识别的 FreeCut 安装，请手动选择安装目录。');
  const parent = path.dirname(target);
  await assertNoLinks(parent);
  try {
    await fs.mkdir(parent, { recursive: true });
  } catch (error) {
    await assertVolumeAvailable(target);
    error.message = `无法创建安装目录 ${parent}。请确认有写入权限，或选择其他目录。\n${error.message}`;
    throw error;
  }
  const id = crypto.randomUUID();
  const stage = path.join(parent, `.freecut-stage-${id}`),
    backup = path.join(parent, `.freecut-backup-${id}`);
  const owned = new Map((installed?.files ?? []).map((entry) => [entry.path.toLowerCase(), entry]));
  const legacyFiles = [];
  for (const entry of manifest.files) {
    const destination = path.join(target, entry.path);
    await assertNoLinks(destination);
    if (await exists(destination)) {
      if (!owned.has(entry.path.toLowerCase()) && !legacy)
        fail(
          entry.path.toLowerCase() === 'freecut.exe'
            ? '此目录已有 FreeCut.exe，但没有新版安装清单。请先从 Windows 设置卸载旧版，或选择另一个文件夹；原文件未修改。'
            : `目标目录里已有不属于 FreeCut 的同名文件：${entry.path}。请换一个目录，原文件未修改。`,
        );
      if (!(await fs.lstat(destination)).isFile()) fail(`程序文件位置被目录占用：${entry.path}`);
      if (legacy) {
        // Only incoming known payload paths may be replaced. Never enumerate,
        // adopt or remove other files in an old/mixed installation directory.
        legacyFiles.push({
          path: entry.path,
          size: (await fs.stat(destination)).size,
          sha256: await sha256(destination),
        });
      }
    }
    let ancestor = path.dirname(destination);
    while (ancestor !== target && ancestor.startsWith(target + path.sep)) {
      if ((await exists(ancestor)) && !(await fs.lstat(ancestor)).isDirectory())
        fail('安装文件的父目录被现有文件占用。');
      ancestor = path.dirname(ancestor);
    }
  }
  // Old entries are checked too; an attacker must not turn an owned file into a junction.
  for (const entry of installed?.files ?? []) await assertNoLinks(path.join(target, entry.path));
  let completedBytes = 0,
    lastProgress = 0,
    committing = false,
    committed = false,
    keepBackup = false;
  const movedOld = [],
    movedNew = [];
  const hadTarget = await exists(target);
  const emit = (phase, message, progress, cancellable) =>
    onProgress({
      phase,
      message,
      progress,
      completedBytes,
      totalBytes: manifest.totalBytes,
      cancellable,
    });
  try {
    aborted(signal);
    await fs.mkdir(stage, { mode: 0o700 });
    if (legacy)
      emit('checking', `正在升级 FreeCut ${legacy.version}，个人工程和模型会保留。`, 0, true);
    emit('copying', '正在展开并校验程序文件', 0, true);
    for (const entry of manifest.files) {
      aborted(signal);
      const source = embedded
          ? path.join(payload, entry.path)
          : path.join(payload, 'application', entry.path),
        destination = path.join(stage, entry.path);
      await assertNoLinks(source);
      const stat = await fs.lstat(source).catch((error) => {
        if (error.code === 'ENOENT') fail(`安装包缺少程序文件：${entry.path}。请重新下载安装器。`);
        throw error;
      });
      if (!stat.isFile() || stat.size !== entry.size) fail(`安装文件大小不匹配：${entry.path}`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const hash = crypto.createHash('sha256');
      const meter = new Transform({
        transform(data, _encoding, callback) {
          hash.update(data);
          completedBytes += data.length;
          if (Date.now() - lastProgress > 80) {
            lastProgress = Date.now();
            emit(
              'copying',
              `正在校验 ${entry.path}`,
              manifest.totalBytes ? (completedBytes / manifest.totalBytes) * 90 : 90,
              true,
            );
          }
          callback(null, data);
        },
      });
      await pipeline(
        createReadStream(source),
        meter,
        createWriteStream(destination, { flags: 'wx', mode: stat.mode & 0o777 }),
        { signal },
      );
      if (hash.digest('hex') !== entry.sha256)
        fail(`安装文件 SHA-256 校验失败：${entry.path}。请重新下载安装器。`);
    }
    aborted(signal);
    if (beforeCommit) await beforeCommit({ target, stage });
    aborted(signal);
    for (const entry of legacyFiles) {
      const file = path.join(target, entry.path);
      await assertNoLinks(file);
      if (
        !(await exists(file)) ||
        !(await fs.lstat(file)).isFile() ||
        (await fs.stat(file)).size !== entry.size ||
        (await sha256(file)) !== entry.sha256
      )
        fail('旧版程序文件在安装期间发生变化，请关闭 FreeCut 后重试；原文件未修改。');
    }
    // Cancellation is disabled only for the short replacement transaction. A
    // failure restores all backed-up files before it is reported to the UI.
    committing = true;
    emit('committing', '正在替换程序文件，请稍候', 92, false);
    await assertNoLinks(target);
    await fs.mkdir(target, { recursive: true });
    await fs.mkdir(backup, { mode: 0o700 });
    for (const entry of installed?.files ?? legacyFiles) {
      const source = path.join(target, entry.path);
      await assertNoLinks(source);
      if (!(await exists(source))) continue;
      if (!(await fs.lstat(source)).isFile()) fail(`现有程序文件已变为目录：${entry.path}`);
      const destination = path.join(backup, entry.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      movedOld.push(entry.path);
    }
    if (installed) {
      await fs.rename(path.join(target, OWNERSHIP), path.join(backup, OWNERSHIP));
      movedOld.push(OWNERSHIP);
    }
    for (const entry of manifest.files) {
      const destination = path.join(target, entry.path);
      await assertNoLinks(destination);
      if (await exists(destination))
        fail(`安装时目标文件被其他程序创建：${entry.path}。原文件已保留。`);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(path.join(stage, entry.path), destination);
      movedNew.push(entry.path);
    }
    const installation = {
      ...manifest,
      installId: installed?.installId ?? crypto.randomUUID(),
      installedAt: new Date().toISOString(),
      target,
      ...(legacy ? { migratedFrom: legacy.version } : {}),
    };
    delete installation.totalBytes;
    await fs.writeFile(path.join(stage, OWNERSHIP), JSON.stringify(installation, null, 2), {
      flag: 'wx',
    });
    await fs.rename(path.join(stage, OWNERSHIP), path.join(target, OWNERSHIP));
    movedNew.push(OWNERSHIP);
    committed = true;
    emit('installed', '程序文件安装完成', 97, false);
    await pruneEmpty(
      target,
      (installed?.files ?? []).map((entry) => entry.path),
    ).catch(() => {});
    return { target, manifest: installation, executable: path.join(target, manifest.entryPoint) };
  } catch (error) {
    if (committing && !committed) {
      const rollbackErrors = [];
      for (const relative of [...movedNew].reverse()) {
        await fs.unlink(path.join(target, relative)).catch((failure) => {
          if (failure.code !== 'ENOENT') rollbackErrors.push(failure.message);
        });
      }
      for (const relative of [...movedOld].reverse()) {
        try {
          await fs.mkdir(path.dirname(path.join(target, relative)), { recursive: true });
          await fs.rename(path.join(backup, relative), path.join(target, relative));
        } catch (failure) {
          rollbackErrors.push(failure.message);
        }
      }
      if (rollbackErrors.length) {
        error.message += `\n自动恢复未完成，原程序备份保留在 ${backup}。${rollbackErrors.join('；')}`;
        keepBackup = true;
      }
      await pruneEmpty(
        target,
        manifest.files.map((entry) => entry.path),
      ).catch(() => {});
      if (!hadTarget) await fs.rmdir(target).catch(() => {});
    }
    if (error.name === 'AbortError') error.message = '安装已取消，原有程序和其他文件保持不变。';
    else if (['EACCES', 'EPERM', 'EBUSY'].includes(error.code))
      error.message =
        '无法写入程序文件。请先关闭 FreeCut，并确认此目录允许当前用户写入。\n' + error.message;
    else if (error.code === 'ENOSPC')
      error.message = '磁盘空间不足。请释放一些空间或选择其他磁盘后重试，原有文件已保留。';
    throw error;
  } finally {
    await removeTemporary(stage, parent).catch(() => {});
    // A backup after rollback failure is intentionally retained for recovery.
    if (!keepBackup) await removeTemporary(backup, parent).catch(() => {});
  }
}

async function uninstall({ target: input, onProgress = () => {}, ...options }) {
  const { target, installed } = await inspectTarget(input, { ...options, update: true });
  const preserved = [];
  // Inspect and hash all files before removing anything. User-modified files are kept.
  const removable = [];
  for (const entry of installed.files) {
    const file = path.join(target, entry.path);
    await assertNoLinks(file);
    if (!(await exists(file))) continue;
    const stat = await fs.lstat(file);
    if (stat.isFile() && stat.size === entry.size && (await sha256(file)) === entry.sha256)
      removable.push(entry.path);
    else preserved.push(entry.path);
  }
  for (let index = 0; index < removable.length; index++) {
    await fs.unlink(path.join(target, removable[index]));
    onProgress({
      phase: 'uninstalling',
      message: '正在移除 FreeCut 程序文件',
      progress: ((index + 1) / removable.length) * 95,
      cancellable: false,
    });
  }
  await fs.unlink(path.join(target, OWNERSHIP));
  await pruneEmpty(
    target,
    installed.files.map((entry) => entry.path),
  );
  await fs.rmdir(target).catch((error) => {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  });
  return { target, preserved, removedFiles: removable.length };
}

module.exports = {
  PRODUCT,
  OWNERSHIP,
  EMBEDDED_MANIFEST,
  normalizeSelection,
  validateTarget,
  safeRelative,
  validateManifest,
  readManifest,
  assertNoLinks,
  inspectTarget,
  sha256,
  install,
  uninstall,
};
