'use strict';
// Derived media is private runtime state. Never write its URLs into a Project.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { INPUT_SECURITY, parseProbe } = require('./media.cjs');
const MAX_BINS = 2048, MAX_THUMBNAILS = 8, MAX_BYTES = 2 * 1024 ** 3, MAX_ENTRIES = 256;
const LEAF = /^(?:metadata\.json|waveform\.json|proxy-(?:540|720)(?:\.part)?\.mp4|thumb-\d{2}\.jpg)$/;
const KEY = /^[a-f0-9]{64}$/;
const fail = (message) => new Error(message);

function createMediaCache({ userData, ffmpegPath, resolveAsset, importPath }) {
  if (!path.isAbsolute(userData) || typeof resolveAsset !== 'function' || typeof importPath !== 'function') throw fail('缓存配置无效。');
  const configPath = path.join(userData, 'media-cache.json');
  let directory, owner, active, disposed = false, usedBytes = 0, locked = false;
  const entries = new Map(), jobs = [], listeners = new Set();
  const snapshot = () => ({ directory: directory || '', usedBytes, maxBytes: MAX_BYTES, jobs: jobs.map(({ child, source, ...job }) => ({ ...job })), entries: [...entries.values()].map(entry => structuredClone(entry)) });
  const emit = () => { const value = snapshot(); for (const listener of listeners) { try { listener(value); } catch {} } };
  const ready = initialize();
  async function initialize() {
    await fs.mkdir(userData, { recursive: true });
    let config;
    try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch {}
    owner = /^[a-f0-9-]{36}$/.test(config?.owner) ? config.owner : crypto.randomUUID();
    const parent = typeof config?.parent === 'string' && path.isAbsolute(config.parent) ? config.parent : userData;
    try { directory = await ownDirectory(parent); }
    catch (error) { if (parent === userData) throw error; directory = await ownDirectory(userData); }
    await saveConfig(path.dirname(directory));
    await scan();
  }
  async function saveConfig(parent) {
    const temporary = `${configPath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ version: 1, owner, parent }));
    await fs.rename(temporary, configPath);
  }
  async function ownDirectory(parent) {
    if (typeof parent !== 'string' || !path.isAbsolute(parent) || parent.length > 32768) throw fail('缓存目录无效。');
    const canonical = await fs.realpath(parent);
    if (!(await fs.stat(canonical)).isDirectory()) throw fail('缓存目录无效。');
    const candidate = path.join(canonical, 'FreeCut-MediaCache');
    await fs.mkdir(candidate, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if ((await fs.lstat(candidate)).isSymbolicLink() || await fs.realpath(candidate) !== candidate) throw fail('缓存目录不能是符号链接。');
    const marker = path.join(candidate, '.freecut-owner');
    let current;
    try { current = await fs.readFile(marker, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!current) {
      if ((await fs.readdir(candidate)).length) throw fail('此目录含有其他文件，请选择另一个缓存位置。');
      await fs.writeFile(marker, owner, { flag: 'wx' });
    } else if (current !== owner) throw fail('此缓存目录属于另一个安装，请选择其他位置。');
    return candidate;
  }
  async function assertRoot() {
    if (!directory || (await fs.lstat(directory)).isSymbolicLink() || await fs.realpath(directory) !== directory || await fs.readFile(path.join(directory, '.freecut-owner'), 'utf8') !== owner) throw fail('缓存目录已改变，请重新选择缓存位置。');
  }
  async function folder(key, create = false) {
    if (!KEY.test(key)) throw fail('缓存索引无效。');
    await assertRoot();
    const target = path.join(directory, key);
    if (create) await fs.mkdir(target, { recursive: false }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) throw fail('缓存路径无效。');
    return target;
  }
  async function regular(file) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || await fs.realpath(file) !== file) throw fail('缓存文件无效。');
    return stat;
  }
  async function outputPath(target, leaf) {
    if (!LEAF.test(leaf) || path.dirname(target) !== directory) throw fail('缓存路径无效。');
    await folder(path.basename(target));
    const file = path.join(target, leaf);
    try { await regular(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return file;
  }
  async function sourceFor(asset) {
    if (!asset || typeof asset.path !== 'string' || asset.path.length > 32768) throw fail('请选择已导入的本地素材。');
    const authorized = await resolveAsset(asset);
    if (!authorized || !['video', 'audio', 'image'].includes(authorized.kind)) throw fail('素材尚未授权。');
    const canonical = await fs.realpath(authorized.path);
    if (canonical !== authorized.path) throw fail('素材路径已改变，请重新导入。');
    const stat = await fs.stat(canonical);
    if (!stat.isFile() || !stat.size) throw fail('素材不可用。');
    if (canonical === directory || canonical.startsWith(directory + path.sep)) throw fail('缓存文件不能作为原始素材。');
    const key = crypto.createHash('sha256').update(JSON.stringify([canonical, stat.size, stat.mtimeMs, stat.ctimeMs, stat.dev, stat.ino])).digest('hex');
    return { key, asset: { ...asset, path: canonical }, path: canonical, kind: authorized.kind, hasAudio: authorized.hasAudio };
  }
  async function scan() {
    await assertRoot();
    const records = [];
    usedBytes = 0;
    for (const name of await fs.readdir(directory)) {
      if (!KEY.test(name)) continue;
      try {
        const location = await folder(name);
        let size = 0, accessed = 0;
        for (const leaf of await fs.readdir(location)) {
          if (!LEAF.test(leaf)) continue;
          try { const stat = await regular(path.join(location, leaf)); size += stat.size; accessed = Math.max(accessed, stat.mtimeMs); } catch {}
        }
        records.push({ key: name, size, accessed }); usedBytes += size;
      } catch {}
    }
    return records;
  }
  async function removeEntry(key) {
    const target = await folder(key);
    // Deliberately not recursive: never delete unknown files or follow links.
    for (const leaf of await fs.readdir(target)) if (LEAF.test(leaf)) {
      const file = path.join(target, leaf);
      try { await regular(file); await fs.unlink(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.rmdir(target).catch(error => { if (!['ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; });
    entries.delete(key);
  }
  async function enforceBudget(protectedKey) {
    const records = (await scan()).sort((a, b) => a.accessed - b.accessed);
    let count = records.length;
    for (const record of records) {
      if (usedBytes <= MAX_BYTES && count <= MAX_ENTRIES) break;
      if (record.key === protectedKey || jobs.some(job => job.source.key === record.key && ['queued', 'running'].includes(job.state))) continue;
      await removeEntry(record.key); usedBytes -= record.size; count--;
    }
    if (usedBytes > MAX_BYTES) {
      if (protectedKey) await removeEntry(protectedKey);
      await scan();
      throw fail('缓存空间已满，请清理缓存后重试。');
    }
  }
  function execute(job, args, onData, probe = false) {
    return new Promise((resolve, reject) => {
      if (job.state === 'cancelled' || disposed) return reject(fail('缓存任务已取消。'));
      const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-threads', '2', '-filter_threads', '1', ...args], { windowsHide: true, stdio: ['ignore', onData ? 'pipe' : 'ignore', 'pipe'] });
      job.child = child;
      let stderr = '', progressBuffer = '';
      const timer = setTimeout(() => child.kill(), probe ? 30000 : 2 * 60 * 60 * 1000);
      if (onData) child.stdout.on('data', onData);
      child.stderr.on('data', data => {
        stderr = (stderr + data.toString()).slice(-65536);
        progressBuffer = (progressBuffer + data.toString()).slice(-4096);
        const times = [...progressBuffer.matchAll(/out_time_us=(\d+)/g)];
        if (times.length && job.duration) { const next = Math.min(.99, Number(times.at(-1)[1]) / 1e6 / job.duration); if (next > job.progress + .01) { job.progress = next; emit(); } }
        if (progressBuffer.includes('\n')) progressBuffer = progressBuffer.slice(progressBuffer.lastIndexOf('\n') + 1);
      });
      child.once('error', () => { clearTimeout(timer); reject(fail('内置 FFmpeg 不可用。')); });
      child.once('close', code => {
        clearTimeout(timer); job.child = undefined;
        if (job.state === 'cancelled' || disposed) reject(fail('缓存任务已取消。'));
        else if (code !== 0 && !probe) reject(fail('缓存生成失败，请检查素材格式和可用磁盘空间。'));
        else resolve(stderr);
      });
    });
  }
  async function hydrate(source) {
    let entry = entries.get(source.key);
    if (entry) return entry;
    try {
      const target = await folder(source.key), metadataFile = path.join(target, 'metadata.json');
      if ((await regular(metadataFile)).size > 8192) return;
      const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'));
      if (metadata.sourceKey !== source.key || metadata.assetPath !== source.path || !Number.isFinite(metadata.duration) || metadata.duration <= 0) return;
      entry = { sourceKey: source.key, assetPath: source.path, name: source.asset.name, duration: metadata.duration };
      if ([540, 720].includes(metadata.proxyHeight)) {
        const file = path.join(target, `proxy-${metadata.proxyHeight}.mp4`); await regular(file);
        const proxy = await importPath(file);
        entry.proxy = { url: proxy.url, width: proxy.width, height: metadata.proxyHeight, duration: proxy.duration };
      }
      if (metadata.waveform) {
        const file = path.join(target, 'waveform.json');
        if ((await regular(file)).size <= 65536) {
          const bins = JSON.parse(await fs.readFile(file, 'utf8'));
          if (Array.isArray(bins) && bins.length <= MAX_BINS && bins.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) entry.waveform = { bins, duration: entry.duration };
        }
      }
      if (Number.isInteger(metadata.thumbnails) && metadata.thumbnails > 0 && metadata.thumbnails <= MAX_THUMBNAILS) {
        entry.thumbnails = [];
        for (let index = 0; index < metadata.thumbnails; index++) {
          const file = path.join(target, `thumb-${String(index + 1).padStart(2, '0')}.jpg`); await regular(file);
          entry.thumbnails.push({ url: (await importPath(file)).url, time: index * entry.duration / metadata.thumbnails });
        }
      }
      entries.set(source.key, entry); return entry;
    } catch { return; }
  }
  async function writeMetadata(target, entry) {
    await fs.writeFile(await outputPath(target, 'metadata.json'), JSON.stringify({ sourceKey: entry.sourceKey, assetPath: entry.assetPath, duration: entry.duration, proxyHeight: entry.proxy?.height, waveform: Boolean(entry.waveform), thumbnails: entry.thumbnails?.length || 0 }));
  }
  async function processJob(job) {
    const latest = await sourceFor(job.source.asset);
    if (latest.key !== job.source.key) throw fail('素材已发生变化，请重新生成缓存。');
    const target = await folder(latest.key, true);
    const info = parseProbe(await execute(job, [...INPUT_SECURITY, '-i', latest.path], undefined, true), latest.path);
    job.duration = info.duration;
    if (info.duration > 24 * 3600) throw fail('缓存支持最长 24 小时的素材。');
    const entry = await hydrate(latest) || { sourceKey: latest.key, assetPath: latest.path, name: latest.asset.name, duration: info.duration };
    const input = ['-y', ...INPUT_SECURITY, '-i', latest.path];
    if (job.type === 'proxy') {
      if (info.kind !== 'video') throw fail('仅视频素材需要代理。');
      const height = job.height, temporary = await outputPath(target, `proxy-${height}.part.mp4`), output = await outputPath(target, `proxy-${height}.mp4`);
      await execute(job, [...input, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `scale=w='min(iw,${height * 2})':h='min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2`, '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '25', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-fs', String(MAX_BYTES / 2), '-progress', 'pipe:2', temporary]);
      await fs.rename(temporary, output);
      const proxy = await importPath(output);
      if (Math.abs(proxy.duration - info.duration) > .12) { await fs.unlink(output); throw fail('代理时长与原片不一致，请检查磁盘空间。'); }
      entry.proxy = { url: proxy.url, width: proxy.width, height, duration: proxy.duration };
    } else if (job.type === 'waveform') {
      const count = Math.min(MAX_BINS, Math.max(1, Math.ceil(info.duration * 32))), bins = new Array(count).fill(0);
      if (info.hasAudio) {
        let sample = 0, tail = Buffer.alloc(0);
        await execute(job, [...input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '1000', '-c:a', 'pcm_s16le', '-f', 's16le', '-progress', 'pipe:2', 'pipe:1'], data => {
          const pcm = tail.length ? Buffer.concat([tail, data]) : data, limit = pcm.length - pcm.length % 2;
          for (let offset = 0; offset < limit; offset += 2, sample++) { const index = Math.min(count - 1, Math.floor(sample / (info.duration * 1000) * count)); bins[index] = Math.max(bins[index], Math.abs(pcm.readInt16LE(offset)) / 32768); }
          tail = limit < pcm.length ? pcm.subarray(limit) : Buffer.alloc(0);
        });
      }
      entry.waveform = { bins: bins.map(value => Math.round(value * 10000) / 10000), duration: info.duration };
      await fs.writeFile(await outputPath(target, 'waveform.json'), JSON.stringify(entry.waveform.bins));
    } else {
      if (info.kind === 'audio') throw fail('音频素材没有缩略图。');
      const count = info.kind === 'image' ? 1 : Math.min(MAX_THUMBNAILS, Math.max(1, Math.ceil(info.duration / 3)));
      for (let index = 1; index <= count; index++) await outputPath(target, `thumb-${String(index).padStart(2, '0')}.jpg`);
      await execute(job, [...input, '-an', '-sn', '-dn', '-vf', `${info.kind === 'image' ? '' : `fps=${count / info.duration},`}scale=160:160:force_original_aspect_ratio=decrease`, '-frames:v', String(count), '-threads', '2', '-q:v', '5', path.join(target, 'thumb-%02d.jpg')]);
      entry.thumbnails = [];
      for (let index = 0; index < count; index++) {
        const file = path.join(target, `thumb-${String(index + 1).padStart(2, '0')}.jpg`);
        try { await regular(file); entry.thumbnails.push({ url: (await importPath(file)).url, time: index * info.duration / count }); } catch { break; }
      }
      if (!entry.thumbnails.length) throw fail('无法生成缩略图。');
    }
    if (job.state === 'cancelled' || disposed) throw fail('缓存任务已取消。');
    if ((await sourceFor(latest.asset)).key !== latest.key) throw fail('素材已发生变化，请重新生成缓存。');
    await writeMetadata(target, entry); entries.set(latest.key, entry);
    await enforceBudget(latest.key);
  }
  async function pump() {
    if (active || disposed || locked) return;
    const job = jobs.find(item => item.state === 'queued');
    if (!job) return;
    active = job; job.state = 'running'; emit();
    try { await processJob(job); if (job.state !== 'cancelled') { job.state = 'complete'; job.progress = 1; } }
    catch (error) { if (job.state !== 'cancelled') { job.state = 'failed'; job.error = error.message; } }
    finally {
      if (job.state === 'failed' || job.state === 'cancelled') {
        // Preserve already completed artifact types, but remove incomplete files.
        try { const target = await folder(job.source.key); for (const leaf of await fs.readdir(target)) if (/\.part\.mp4$/.test(leaf) && LEAF.test(leaf)) { await regular(path.join(target, leaf)); await fs.unlink(path.join(target, leaf)); } } catch {}
      }
      active = undefined; await scan().catch(() => {}); emit(); void pump();
    }
  }
  async function status() {
    await ready;
    // Revalidate originals before exposing runtime proxies, including on project reload.
    for (const [key, entry] of entries) {
      try { if ((await sourceFor({ path: entry.assetPath, name: entry.name })).key !== key) entries.delete(key); } catch { entries.delete(key); }
    }
    return snapshot();
  }
  async function request(input) {
    await ready;
    if (disposed || locked) throw fail('缓存暂不可用。');
    if (!input || !['proxy', 'waveform', 'thumbnails'].includes(input.type) || (input.height !== undefined && ![540, 720].includes(input.height))) throw fail('缓存请求无效。');
    const source = await sourceFor(input.asset);
    if (input.type === 'proxy' && source.kind !== 'video') throw fail('仅视频素材需要代理。');
    for (const [key, entry] of entries) if (entry.assetPath === source.path && key !== source.key) entries.delete(key);
    const entry = await hydrate(source), height = input.type === 'proxy' ? input.height || 540 : undefined;
    if (entry?.[input.type] && (input.type !== 'proxy' || entry.proxy.height === height)) return snapshot();
    if (jobs.some(job => job.source.key === source.key && job.type === input.type && job.height === height && ['queued', 'running'].includes(job.state))) return snapshot();
    if (jobs.filter(job => ['queued', 'running'].includes(job.state)).length >= 128) throw fail('缓存队列已满，请稍后重试。');
    if (locked || disposed) throw fail('缓存暂不可用。');
    while (jobs.length >= 160) { const index = jobs.findIndex(job => !['queued', 'running'].includes(job.state)); if (index < 0) break; jobs.splice(index, 1); }
    jobs.push({ id: crypto.randomUUID(), assetPath: source.path, name: source.asset.name, type: input.type, height, source, state: 'queued', progress: 0 });
    emit(); void pump(); return snapshot();
  }
  async function cancel(id) {
    await ready;
    if (typeof id !== 'string') throw fail('缓存任务无效。');
    const job = jobs.find(item => item.id === id);
    if (job && ['queued', 'running'].includes(job.state)) { job.state = 'cancelled'; job.child?.kill(); emit(); }
    return snapshot();
  }
  async function clear() {
    await ready;
    if (active || jobs.some(job => job.state === 'queued')) throw fail('请先取消缓存任务，等待结束后再清理。');
    if (locked) throw fail('缓存暂不可用。');
    locked = true;
    try { for (const record of await scan()) await removeEntry(record.key); entries.clear(); await scan(); emit(); return snapshot(); }
    finally { locked = false; }
  }
  async function setDirectory(parent) {
    await ready;
    if (active || jobs.some(job => job.state === 'queued') || locked) throw fail('请先取消缓存任务，等待结束后再更换位置。');
    locked = true;
    try { const next = await ownDirectory(parent); await saveConfig(path.dirname(next)); directory = next; entries.clear(); await scan(); emit(); return snapshot(); }
    finally { locked = false; }
  }
  function cancelAll() {
    for (const job of jobs) if (['queued', 'running'].includes(job.state)) { job.state = 'cancelled'; job.child?.kill(); }
    emit();
  }
  return { status, request, cancel, clear, setDirectory, cancelAll, onProgress(listener) { listeners.add(listener); return () => listeners.delete(listener); }, dispose() { disposed = true; cancelAll(); listeners.clear(); } };
}
module.exports = { createMediaCache, MAX_BINS, MAX_THUMBNAILS, MAX_BYTES };
