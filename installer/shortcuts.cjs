'use strict';

// Decide whether an installer-owned shortcut can be refreshed. Reading a link
// and a bounded ASAR header never starts the old application.
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { assertNoLinks } = require('./backend.cjs');
const { identifyLegacy } = require('./legacy.cjs');

const DEFAULT_DESCRIPTIONS = new Set([
  '',
  'FreeCut',
  '水管剪辑 FreeCut',
  '自由剪辑 FreeCut — 开源桌面视频编辑器',
  '水管剪辑 FreeCut — 全部功能永久免费的开源视频编辑器',
]);
const samePath = (left, right) => left.toLowerCase() === right.toLowerCase();
const canonical = async (value) => {
  if (typeof value !== 'string' || !value || !path.isAbsolute(value))
    throw Error('Shortcut path is not absolute.');
  await assertNoLinks(value);
  return fs.realpath(value);
};

async function defaultIcon(icon, iconIndex, executable) {
  if (Number(iconIndex ?? 0) !== 0) return false;
  // A Windows shortcut without an explicit icon inherits its target's icon.
  if (!icon) return true;
  if (typeof icon !== 'string' || !path.isAbsolute(icon)) return false;
  await assertNoLinks(icon);
  let resolved;
  try {
    resolved = await fs.realpath(icon);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = await canonical(path.dirname(icon)).catch((parentError) => {
      if (parentError.code === 'ENOENT') return path.resolve(path.dirname(icon));
      throw parentError;
    });
    resolved = path.join(parent, path.basename(icon));
  }
  if (samePath(resolved, executable)) return true;
  const directories = [
    path.join(path.dirname(executable), 'resources', 'freecut-installer', 'icons'),
  ];
  if (process.env.LOCALAPPDATA) {
    directories.push(path.join(await canonical(process.env.LOCALAPPDATA), 'FreeCut', 'icons'));
  }
  if (!directories.some((directory) => samePath(path.dirname(resolved), directory))) return false;
  const match = /^FreeCut-([a-f0-9]{64})\.ico$/i.exec(path.basename(resolved));
  if (!match) return false;
  const stat = await fs.stat(resolved).catch((error) => {
    // A successful upgrade removes the previous managed icon before shortcut
    // refresh. Its exact private directory and content-addressed name remain
    // identifiable; arbitrary missing/custom icon locations are still rejected.
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return true;
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return false;
  return (
    crypto
      .createHash('sha256')
      .update(await fs.readFile(resolved))
      .digest('hex') === match[1].toLowerCase()
  );
}

async function shortcutDecision({ file, executable, target, readShortcut }) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') return { operation: 'create' };
    throw error;
  }
  const preserve = (reason) => ({ operation: 'preserve', reason });
  try {
    if (!stat.isFile() || stat.isSymbolicLink()) return preserve('not-regular-link');
    if (path.extname(file).toLowerCase() !== '.lnk') return preserve('not-shell-link');
    await assertNoLinks(file);
    // Preserve execution options not exposed by Electron's readShortcutLink.
    const handle = await fs.open(file, 'r');
    let header;
    try {
      header = Buffer.alloc(76);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (bytesRead !== 76 || header.readUInt32LE(0) !== 76) return preserve('invalid-shell-link');
    } finally {
      await handle.close();
    }
    if (header.readUInt32LE(20) & 0x22000) return preserve('custom-execution-flags');
    if (header.readUInt32LE(60) !== 1 || header.readUInt16LE(64) !== 0)
      return preserve('custom-window-or-hotkey');

    const previous = readShortcut(file);
    if (previous.args || !DEFAULT_DESCRIPTIONS.has(previous.description ?? ''))
      return preserve('custom-arguments-or-description');
    const oldExecutable = await canonical(previous.target);
    const newExecutable = await canonical(executable);
    const newDirectory = await canonical(target);
    if (!samePath(path.dirname(newExecutable), newDirectory))
      return preserve('new-target-mismatch');
    if (path.basename(oldExecutable).toLowerCase() !== 'freecut.exe')
      return preserve('different-application');
    if (!samePath(oldExecutable, newExecutable)) {
      const identity = await identifyLegacy(path.dirname(oldExecutable), assertNoLinks);
      if (!identity) return preserve('unverified-old-application');
    }
    if (previous.cwd && !samePath(await canonical(previous.cwd), path.dirname(oldExecutable)))
      return preserve('custom-working-directory');
    if (!(await defaultIcon(previous.icon, previous.iconIndex, oldExecutable)))
      return preserve('custom-icon');
    return { operation: 'replace' };
  } catch {
    // Unreadable, stale, or ambiguous shortcuts are not evidence of ownership.
    return preserve('unverified-shortcut');
  }
}

module.exports = { shortcutDecision };
