'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const FOLDER = 'FreeCut-VoiceModels';
const MARKER = '.freecut-voice-model.json';
const BUSY = '语音模型正在下载、生成或切换目录，请完成或取消当前任务后重试。';
const comparable = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
const same = (a, b) => comparable(path.resolve(a)) === comparable(path.resolve(b));
const beneath = (root, target) => {
  const relative = path.relative(comparable(path.resolve(root)), comparable(path.resolve(target)));
  return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};
function friendly(error) {
  if (['EACCES', 'EPERM', 'EROFS'].includes(error.code))
    return Error('所选目录没有写入权限，请选择其他文件夹。');
  if (error.code === 'ENOSPC') return Error('所选磁盘空间不足，请释放空间或选择其他磁盘。');
  if (['ENOENT', 'ENODEV', 'ENXIO'].includes(error.code))
    return Error('所选目录或磁盘不可用，请重新选择模型位置。');
  return error;
}

function createVoiceStorage({ userData, models }) {
  if (typeof userData !== 'string' || !path.isAbsolute(userData))
    throw Error('语音模型配置目录无效。');
  const defaultPath = path.join(userData, 'ai');
  const settings = path.join(userData, 'voice-storage.json');
  const descriptors = new Map(models.map((model) => [model.id, model]));
  let customPath = null,
    jobs = 0,
    switching = false,
    pending = null;
  try {
    const stat = fs.lstatSync(settings);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096)
      throw Error('Invalid settings');
    const value = JSON.parse(fs.readFileSync(settings, 'utf8'));
    if (
      value.version === 1 &&
      typeof value.path === 'string' &&
      path.isAbsolute(value.path) &&
      path.basename(value.path) === FOLDER &&
      !value.path.includes('\0')
    )
      customPath = path.resolve(value.path);
  } catch {
    /* Absent or malformed optional settings use the compatible default. */
  }
  const status = () => ({
    path: customPath || defaultPath,
    defaultPath,
    custom: !!customPath,
    busy: switching || jobs > 0,
  });
  function descriptor(id) {
    const value = descriptors.get(id);
    if (!value) throw Error('未知语音模型。');
    return value;
  }
  const modelPath = (id) => path.join(customPath || defaultPath, descriptor(id).directory);
  const cachePath = (id) =>
    path.join(
      customPath || defaultPath,
      customPath
        ? path.join('downloads', id)
        : descriptor(id).defaultCacheDirectory || path.join('downloads', id),
    );
  function beginTask() {
    if (switching) throw Error(BUSY);
    jobs++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        jobs--;
      }
    };
  }
  async function safeDirectory(root, target = root) {
    if (!beneath(root, target)) throw Error('语音模型路径超出专用目录。');
    // The selected parent's existing aliases (including macOS /var) are valid;
    // every child owned by FreeCut must remain a real directory, not a junction.
    await fsp.mkdir(path.dirname(root), { recursive: true });
    const parent = await fsp.realpath(path.dirname(root));
    let current = path.join(parent, path.basename(root));
    const parts = [null, ...path.relative(root, target).split(path.sep).filter(Boolean)];
    for (const part of parts) {
      if (part) current = path.join(current, part);
      try {
        await fsp.mkdir(current);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const info = await fsp.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw Error('语音模型目录不能是符号链接、快捷方式或文件。');
    }
    return current;
  }
  async function ensureDirectory(target) {
    const roots = [customPath, defaultPath].filter(Boolean).sort((a, b) => b.length - a.length);
    const root = roots.find((root) => beneath(root, target));
    if (!root) throw Error('语音模型路径超出专用目录。');
    try {
      return await safeDirectory(root, target);
    } catch (error) {
      throw friendly(error);
    }
  }
  async function assertModelWritable(id) {
    if (!customPath) return;
    const target = modelPath(id);
    await safeDirectory(customPath, path.dirname(target));
    const info = await fsp.lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('语音模型目录不能是符号链接、快捷方式或文件。');
    if (!(await fsp.readdir(target)).length || (await descriptor(id).verify(target))) return;
    let marker;
    try {
      const file = path.join(target, MARKER);
      const stat = await fsp.lstat(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.size < 4096)
        marker = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {}
    if (marker?.version !== 1 || marker?.id !== id)
      throw Error('目标位置已有不完整或未知模型文件，请选择空文件夹后重试。');
  }
  async function writeMarker(root, id, target) {
    await safeDirectory(root, target);
    const marker = path.join(target, MARKER);
    const info = await fsp.lstat(marker).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink() || (info && !info.isFile()))
      throw Error('语音模型文件包含不安全链接。');
    const temporary = marker + `.${crypto.randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temporary, JSON.stringify({ version: 1, id }), { flag: 'wx' });
      await fsp.rename(temporary, marker);
    } finally {
      await fsp.rm(temporary, { force: true });
    }
  }
  async function markModel(id, target = modelPath(id)) {
    if (!customPath) return;
    const expected = modelPath(id);
    if (
      !same(target, expected) &&
      !(
        path.dirname(target) === path.dirname(expected) && target.startsWith(expected + '-staging-')
      )
    )
      throw Error('语音模型路径超出专用目录。');
    await writeMarker(customPath, id, target);
  }
  async function checkedFiles(model, directory) {
    const info = await fsp.lstat(directory).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info) return null;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('语音模型目录不能是符号链接、快捷方式或文件。');
    if (!(await model.verify(directory))) return null;
    const files = await model.files(directory);
    if (!Array.isArray(files) || !files.length || files.length > 10000)
      throw Error('语音模型文件清单无效。');
    let bytes = 0;
    for (const name of files) {
      if (
        typeof name !== 'string' ||
        !name ||
        path.isAbsolute(name) ||
        name.includes('\0') ||
        name.includes(':')
      )
        throw Error('语音模型文件清单包含不安全路径。');
      const target = path.resolve(directory, name);
      if (!beneath(directory, target) || same(directory, target))
        throw Error('语音模型文件清单包含不安全路径。');
      let current = directory;
      const components = path.relative(directory, target).split(path.sep);
      for (let index = 0; index < components.length; index++) {
        current = path.join(current, components[index]);
        const stat = await fsp.lstat(current);
        if (
          stat.isSymbolicLink() ||
          (index === components.length - 1 ? !stat.isFile() : !stat.isDirectory())
        )
          throw Error('语音模型文件包含不安全链接。');
        if (index === components.length - 1) bytes += stat.size;
      }
    }
    if (bytes > 4 * 1024 ** 3) throw Error('语音模型文件超出预期大小。');
    return { files, bytes };
  }
  async function save(next) {
    await fsp.mkdir(userData, { recursive: true });
    const stat = await fsp.lstat(settings).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw Error('语音模型配置文件不是普通文件。');
    const temporary = path.join(userData, `.voice-storage-${crypto.randomUUID()}.tmp`);
    try {
      const file = await fsp.open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, path: next }));
        await file.sync();
      } finally {
        await file.close();
      }
      await fsp.rename(temporary, settings);
    } finally {
      await fsp.rm(temporary, { force: true });
    }
  }
  function change(parent) {
    if (switching || jobs) return Promise.reject(Error(BUSY));
    switching = true;
    pending = (async () => {
      const stages = [];
      try {
        let next = null;
        if (parent !== null) {
          if (typeof parent !== 'string' || !path.isAbsolute(parent) || parent.includes('\0'))
            throw Error('请选择有效的绝对目录。');
          await fsp.mkdir(parent, { recursive: true });
          const canonical = await fsp.realpath(parent);
          next =
            path.basename(parent) === FOLDER
              ? path.join(await fsp.realpath(path.dirname(parent)), FOLDER)
              : path.join(canonical, FOLDER);
        }
        const destination = next || defaultPath;
        await safeDirectory(destination);
        const probe = path.join(destination, `.freecut-write-${crypto.randomUUID()}.tmp`);
        await fsp.writeFile(probe, '', { flag: 'wx' });
        await fsp.rm(probe);
        if (same(destination, customPath || defaultPath)) return status();
        // No source is removed. All known model copies are validated before a
        // new setting becomes visible to either inference service.
        const moves = [],
          verifiedTargets = [];
        for (const model of descriptors.values()) {
          const source = modelPath(model.id),
            target = path.join(destination, model.directory);
          const sourceFiles = await checkedFiles(model, source);
          await safeDirectory(destination, path.dirname(target));
          if (await checkedFiles(model, target)) {
            verifiedTargets.push({ model, target });
            continue;
          }
          const present = await fsp.lstat(target).catch((error) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (present && (await fsp.readdir(target)).length)
            throw Error('目标位置已有不完整或未知模型文件，请选择空文件夹后重试。');
          if (!sourceFiles) continue; // Incomplete downloads are not migrated.
          moves.push({ model, source, target, ...sourceFiles, emptyTarget: !!present });
        }
        const disk = await fsp.statfs(destination);
        if (
          disk.bavail * disk.bsize <
          moves.reduce((sum, move) => sum + move.bytes, 0) + (moves.length ? 128 * 1024 ** 2 : 0)
        )
          throw Error('所选磁盘空间不足，复制模型还需要额外预留 128 MB。');
        for (const move of moves) {
          const stage = move.target + `.copy-${crypto.randomUUID()}`;
          await safeDirectory(destination, stage);
          stages.push(stage);
          for (const name of move.files) {
            const output = path.join(stage, name);
            await safeDirectory(destination, path.dirname(output));
            await fsp.copyFile(path.join(move.source, name), output, fs.constants.COPYFILE_EXCL);
          }
          if (!(await checkedFiles(move.model, stage)))
            throw Error('复制后的语音模型校验失败，原目录和设置已保留。');
          if (next)
            await fsp.writeFile(
              path.join(stage, MARKER),
              JSON.stringify({ version: 1, id: move.model.id }),
              { flag: 'wx' },
            );
          move.stage = stage;
        }
        for (const move of moves) {
          if (move.emptyTarget) await fsp.rmdir(move.target);
          await fsp.rename(move.stage, move.target);
        }
        if (next)
          for (const { model, target } of verifiedTargets)
            await writeMarker(next, model.id, target);
        await save(next);
        customPath = next;
        return status();
      } catch (error) {
        throw friendly(error);
      } finally {
        for (const stage of stages)
          await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
        switching = false;
      }
    })();
    return pending.then(() => status());
  }
  return {
    status,
    modelPath,
    cachePath,
    beginTask,
    ensureDirectory,
    assertModelWritable,
    markModel,
    choose: (parent) => change(parent),
    reset: () => change(null),
    dispose: () => pending?.catch(() => {}),
  };
}

function createVoiceModelStorage({ userData }) {
  const chattts = require('./chattts.cjs');
  const ai = require('./ai.cjs');
  return createVoiceStorage({
    userData,
    models: [
      {
        id: 'chattts',
        directory: `${chattts.VERSION}/models`,
        verify: chattts.verifyModels,
        files: async () => chattts.MODELS.map((model) => model[0]),
      },
      {
        id: 'tts-zh',
        directory: 'tts-zh-v1',
        defaultCacheDirectory: 'downloads',
        verify: ai.verifyInstalledModel,
        files: ai.installedModelFiles,
      },
    ],
  });
}
module.exports = { createVoiceStorage, createVoiceModelStorage, BUSY };
