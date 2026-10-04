'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { MEDIA_EXTENSIONS, restoreMediaAsset } = require('./media.cjs');

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sessionValid = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const keyOf = record => `${record.sessionId}\0${record.project.id}`;
const fingerprint = project => crypto.createHash('sha256').update(JSON.stringify(project)).digest('hex');
const validPath = value => typeof value === 'string' && value.length <= 32768 && !value.includes('\0') && path.isAbsolute(value) && MEDIA_EXTENSIONS.has(path.extname(value).toLowerCase());
const recoveryError = (message, code) => Object.assign(new Error(message), { code });

/** Host-owned recovery copies. The renderer never chooses a file or import path. */
function createRecovery({ userData, validateProject, resolveAsset, importPath, limits = {}, now = () => new Date() }) {
  if (!path.isAbsolute(userData) || typeof validateProject !== 'function' || typeof resolveAsset !== 'function' || typeof importPath !== 'function') throw new TypeError('Recovery host configuration is invalid.');
  const directory = path.join(userData, 'recovery-v1');
  const maxEntries = limits.maxEntries ?? 40;
  const maxRevisions = limits.maxRevisions ?? 8;
  const maxBytes = limits.maxBytes ?? 128 * 1024 * 1024;
  const maxSnapshotBytes = limits.maxSnapshotBytes ?? 16 * 1024 * 1024;
  if (![maxEntries, maxRevisions, maxBytes, maxSnapshotBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new TypeError('Recovery limits are invalid.');
  let queue = Promise.resolve();
  const authorizedPaths = new Set();
  const enqueue = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const filename = id => {
    if (typeof id !== 'string' || !ID.test(id)) throw recoveryError('恢复记录无效。', 'RECOVERY_ID');
    return path.join(directory, `${id}.json`);
  };
  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.lstat(directory)).isSymbolicLink()) throw recoveryError('恢复目录无效。', 'RECOVERY_DIRECTORY');
  }
  async function atomicWrite(id, body) {
    await ensureDirectory();
    const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(body, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await fs.rename(temporary, filename(id));
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  function authorizeProject(project) {
    // Only call after the host has accepted an explicitly opened project.
    validateProject(project);
    for (const asset of project.assets) if (validPath(asset.path)) authorizedPaths.add(path.normalize(asset.path));
  }
  async function normalize(project) {
    validateProject(project);
    const normalized = structuredClone(project);
    normalized.assets = [];
    for (const input of project.assets) {
      let resolved = null;
      if (input.path) {
        if (!validPath(input.path)) throw recoveryError('恢复副本中的素材路径无效。', 'RECOVERY_PATH');
        try { resolved = await resolveAsset(input); }
        catch (error) { if (!authorizedPaths.has(path.normalize(input.path))) throw error; }
        if (resolved?.path && !validPath(resolved.path)) throw recoveryError('恢复副本中的素材路径无效。', 'RECOVERY_PATH');
        if (!resolved?.path && !authorizedPaths.has(path.normalize(input.path))) throw recoveryError('素材尚未通过导入授权，无法创建恢复副本。', 'RECOVERY_AUTH');
      }
      const asset = {
        id: input.id, name: input.name, kind: resolved?.kind || input.kind, url: '',
        duration: Number.isFinite(input.duration) && input.duration >= 0 ? input.duration : 0,
      };
      if (input.path) {
        asset.path = path.normalize(resolved?.path || input.path);
        authorizedPaths.add(asset.path);
      }
      if (Number.isFinite(input.width) && input.width > 0) asset.width = input.width;
      if (Number.isFinite(input.height) && input.height > 0) asset.height = input.height;
      if (input.missing || !asset.path) asset.missing = true;
      normalized.assets.push(asset);
    }
    validateProject(normalized);
    return normalized;
  }
  function validateRecord(record, id) {
    if (!record || record.version !== 1 || record.id !== id || !sessionValid(record.sessionId) ||
      typeof record.saved !== 'boolean' || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt)) ||
      typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest)) throw Error('Invalid recovery record.');
    validateProject(record.project);
    for (const asset of record.project.assets) {
      if (asset.url !== '' || asset.thumbnail !== undefined || (asset.path && !validPath(asset.path))) throw Error('Invalid recovery media reference.');
    }
    if (fingerprint(record.project) !== record.digest) throw Error('Recovery checksum mismatch.');
    return record;
  }
  async function read(id) {
    await ensureDirectory();
    const file = filename(id);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxSnapshotBytes) throw Error('Invalid recovery file.');
    return { ...validateRecord(JSON.parse(await fs.readFile(file, 'utf8')), id), bytes: stat.size };
  }
  async function scan() {
    await ensureDirectory();
    const records = [];
    let issues = 0;
    for (const file of await fs.readdir(directory)) {
      if (!file.endsWith('.json')) continue;
      const id = file.slice(0, -5);
      if (!ID.test(id)) { issues++; continue; }
      try { records.push(await read(id)); } catch { issues++; }
    }
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { records, issues };
  }
  function summary(record) {
    return {
      id: record.id, sessionId: record.sessionId, projectId: record.project.id,
      name: record.project.name, createdAt: record.createdAt, saved: record.saved,
      clipCount: record.project.clips.length, assetCount: record.project.assets.length,
      duration: record.project.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0),
      bytes: record.bytes,
    };
  }
  function planRetention(records, fresh) {
    const latest = new Map();
    for (const record of [fresh, ...records]) if (!latest.has(keyOf(record))) latest.set(keyOf(record), record.id);
    const kept = [fresh, ...records];
    const removed = [];
    const counts = new Map();
    for (const record of kept) counts.set(keyOf(record), (counts.get(keyOf(record)) || 0) + 1);
    // First remove oldest revisions of the same session; never remove its newest unsaved copy.
    for (let index = kept.length - 1; index > 0; index--) {
      const record = kept[index], key = keyOf(record);
      if (counts.get(key) > maxRevisions && latest.get(key) !== record.id) {
        kept.splice(index, 1); removed.push(record); counts.set(key, counts.get(key) - 1);
      }
    }
    let bytes = kept.reduce((sum, record) => sum + record.bytes, 0);
    const candidates = kept.slice(1).filter(record => record.saved || latest.get(keyOf(record)) !== record.id)
      .sort((a, b) => Number(b.saved) - Number(a.saved) || a.createdAt.localeCompare(b.createdAt));
    for (const record of candidates) {
      if (kept.length <= maxEntries && bytes <= maxBytes) break;
      kept.splice(kept.indexOf(record), 1); removed.push(record); bytes -= record.bytes;
    }
    if (kept.length > maxEntries || bytes > maxBytes) throw recoveryError('恢复空间已满，请在恢复记录中删除不再需要的副本。', 'RECOVERY_QUOTA');
    return removed;
  }
  function snapshot(request) {
    // Clone at invocation so callers cannot mutate an already queued revision.
    const input = structuredClone(request);
    return enqueue(async () => {
      if (!input || !sessionValid(input.sessionId)) throw recoveryError('恢复会话无效。', 'RECOVERY_SESSION');
      if (input.dirty === false) return { status: 'clean' };
      const project = await normalize(input.project);
      const { records } = await scan();
      const latest = records.find(record => record.sessionId === input.sessionId && record.project.id === project.id);
      const digest = fingerprint(project);
      if (latest?.digest === digest) return { status: 'unchanged', entry: summary(latest) };
      // A clean or fresh empty workspace must never supersede an earlier recovery.
      if (!project.assets.length && !project.clips.length && !latest && input.dirty !== true) return { status: 'empty' };
      const createdAt = new Date(Math.max(now().getTime(), records.length ? Date.parse(records[0].createdAt) + 1 : 0)).toISOString();
      const record = { version: 1, id: crypto.randomUUID(), sessionId: input.sessionId, createdAt, saved: false, digest, project };
      const body = JSON.stringify(record);
      const bytes = Buffer.byteLength(body);
      if (bytes > maxSnapshotBytes) throw recoveryError('恢复副本过大，请手动保存工程。', 'RECOVERY_SIZE');
      const evicted = planRetention(records, { ...record, bytes });
      await atomicWrite(record.id, body);
      for (const old of evicted) await fs.rm(filename(old.id), { force: true });
      return { status: 'saved', entry: summary({ ...record, bytes }) };
    });
  }
  return {
    authorizeProject,
    snapshot,
    list: () => enqueue(async () => { const { records, issues } = await scan(); return { entries: records.map(summary), issues }; }),
    restore: id => enqueue(async () => {
      let record;
      try { record = await read(id); } catch { throw recoveryError('恢复记录无法读取，可能已损坏或删除。', 'RECOVERY_READ'); }
      const project = structuredClone(record.project);
      authorizeProject(project);
      for (const asset of project.assets) {
        if (!asset.path) { asset.missing = true; continue; }
        try { restoreMediaAsset(project, asset, await importPath(asset.path)); }
        catch { asset.url = ''; delete asset.thumbnail; asset.missing = true; }
      }
      return project;
    }),
    remove: id => enqueue(async () => { await ensureDirectory(); await fs.rm(filename(id), { force: true }); }),
    markSaved: request => {
      const input = structuredClone(request);
      return enqueue(async () => {
        if (!input || !sessionValid(input.sessionId)) throw recoveryError('恢复会话无效。', 'RECOVERY_SESSION');
        const project = await normalize(input.project);
        const digest = fingerprint(project);
        const { records } = await scan();
        const matched = records.find(record => record.sessionId === input.sessionId && record.project.id === project.id && record.digest === digest);
        if (!matched) return;
        for (const record of records) {
          if (record.sessionId !== input.sessionId || record.project.id !== project.id || record.createdAt > matched.createdAt || record.saved) continue;
          const { bytes: _bytes, ...saved } = record;
          await atomicWrite(record.id, JSON.stringify({ ...saved, saved: true }));
        }
      });
    },
    flush: () => queue,
  };
}

module.exports = { createRecovery };
