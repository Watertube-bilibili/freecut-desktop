'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const REPOSITORY = 'Watertube-bilibili/freecut-desktop';
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100`;
const HOSTS = new Set([
  'api.github.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
]);

function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?$/.exec(value || '');
  if (!match || value.length > 100) return null;
  return { core: match.slice(1, 4).map(Number), pre: match[4]?.split('.') };
}
function compareVersions(a, b) {
  const av = versionParts(a),
    bv = versionParts(b);
  if (!av || !bv) throw Error('版本号无效。');
  for (let i = 0; i < 3; i++)
    if (av.core[i] !== bv.core[i]) return Math.sign(av.core[i] - bv.core[i]);
  if (!av.pre || !bv.pre) return av.pre ? -1 : bv.pre ? 1 : 0;
  for (let i = 0; i < Math.max(av.pre.length, bv.pre.length); i++) {
    const x = av.pre[i],
      y = bv.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x),
      yn = /^\d+$/.test(y);
    if (xn && yn) return Math.sign(Number(x) - Number(y));
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
function safeUrl(input) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !HOSTS.has(url.hostname)
  )
    throw Error('更新下载地址不属于可信的 GitHub 服务。');
  return url.href;
}
function selectRelease(releases, { currentVersion, platform, arch, portable }) {
  if (!Array.isArray(releases) || releases.length > 100)
    throw Error('GitHub 返回了无效的版本列表。');
  const suffix =
    platform === 'win32' && arch === 'x64'
      ? `win-x64-${portable ? 'Portable' : 'Setup'}.exe`
      : platform === 'darwin' && ['arm64', 'x64'].includes(arch)
        ? `mac-${arch}.zip`
        : null;
  if (!suffix) throw Error('当前系统暂不支持自动更新。');
  const sorted = releases
    .filter(
      (r) =>
        !r.draft && versionParts(r.tag_name) && compareVersions(r.tag_name, currentVersion) > 0,
    )
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  for (const release of sorted) {
    const version = versionParts(release.tag_name).core.join('.');
    const name = `FreeCut-${version}-${suffix}`;
    const assets = (release.assets || []).filter((a) => a.name === name && a.state === 'uploaded');
    if (assets.length !== 1) continue;
    const asset = assets[0];
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 * 1024 * 1024)
      throw Error('更新文件大小无效。');
    const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`;
    if (asset.browser_download_url !== expected) throw Error('更新文件不属于 FreeCut 官方仓库。');
    if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest || ''))
      throw Error('更新文件缺少 GitHub SHA-256 校验值，请稍后重试。');
    return {
      version: release.tag_name,
      name,
      url: safeUrl(expected),
      size: asset.size,
      sha256: asset.digest.slice(7),
    };
  }
  return null;
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function fetchTrusted(url, { fetchImpl = fetch, signal, headers = {} } = {}) {
  for (let redirects = 0; redirects < 8; redirects++) {
    const response = await fetchImpl(safeUrl(url), {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'FreeCut-Updater', ...headers },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('下载跳转地址缺失。');
      url = new URL(location, url).href;
      continue;
    }
    return response;
  }
  throw Error('下载跳转次数过多。');
}
async function readBounded(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const part of response.body || []) {
    size += part.byteLength;
    if (size > limit) throw Error('更新响应超过允许大小。');
    chunks.push(Buffer.from(part));
  }
  return Buffer.concat(chunks);
}
async function downloadAsset(
  asset,
  directory,
  { fetchImpl = fetch, signal, progress = () => {} } = {},
) {
  if (
    typeof asset.name !== 'string' ||
    path.basename(asset.name) !== asset.name ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > 1024 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(asset.sha256 || '')
  )
    throw Error('更新文件信息无效。');
  signal?.throwIfAborted();
  await fsp.mkdir(directory, { recursive: true });
  const destination = path.join(directory, asset.name);
  if (
    await hashFile(destination).then(
      (hash) => hash === asset.sha256,
      () => false,
    )
  )
    return destination;
  const temporary = `${destination}.${asset.sha256.slice(0, 16)}.partial`;
  const previous = await fsp.lstat(temporary).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous && (!previous.isFile() || previous.isSymbolicLink()))
    throw Error('更新缓存文件类型无效。');
  let offset = previous && previous.size <= asset.size ? previous.size : 0;
  const file = await fsp.open(temporary, offset ? 'r+' : 'w');
  try {
    while (offset < asset.size) {
      const end = Math.min(offset + 4 * 1024 * 1024, asset.size) - 1;
      let bytes, error;
      for (let attempt = 0; attempt < 3; attempt++) {
        signal?.throwIfAborted();
        bytes = undefined;
        try {
          const timeout = AbortSignal.timeout(90000);
          const response = await fetchTrusted(asset.url, {
            fetchImpl,
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
            headers: { Range: `bytes=${offset}-${end}`, 'Accept-Encoding': 'identity' },
          });
          // A server may ignore Range only for the initial response. Never append a full body to partial data.
          if (response.status === 200 && offset === 0) {
            // Keep memory bounded even when a proxy ignores Range on a large installer.
            if (asset.size > 4 * 1024 * 1024) {
              await response.body?.cancel();
              throw Error('更新服务器没有提供分段下载，请稍后重试。');
            }
            bytes = await readBounded(response, asset.size);
            if (bytes.length !== asset.size) throw Error('更新文件未完整下载。');
          } else {
            if (
              response.status !== 206 ||
              response.headers.get('content-range') !== `bytes ${offset}-${end}/${asset.size}`
            ) {
              await response.body?.cancel();
              throw Error(`更新服务器响应异常（HTTP ${response.status}）。`);
            }
            bytes = await readBounded(response, end - offset + 1);
            if (bytes.length !== end - offset + 1) throw Error('更新下载中断，将自动重试。');
          }
          break;
        } catch (e) {
          bytes = undefined;
          error = e;
          if (signal?.aborted) throw e;
        }
      }
      if (!bytes) throw error;
      let written = 0;
      while (written < bytes.length) {
        const result = await file.write(bytes, written, bytes.length - written, offset + written);
        if (!result.bytesWritten) throw Error('无法写入更新文件，请检查磁盘空间。');
        written += result.bytesWritten;
      }
      offset += bytes.length;
      progress(offset / asset.size);
    }
    await file.sync();
  } finally {
    await file.close();
  }
  if ((await hashFile(temporary)) !== asset.sha256) {
    await fsp.unlink(temporary).catch(() => {});
    throw Error('更新文件校验失败，已丢弃损坏的下载。请重试。');
  }
  signal?.throwIfAborted();
  await fsp.rename(temporary, destination);
  return destination;
}
function createUpdater({
  userData,
  currentVersion,
  platform = process.platform,
  arch = process.arch,
  portable = false,
  enabled = true,
  fetchImpl = fetch,
  emit = () => {},
}) {
  const directory = path.join(userData, 'updates');
  const prefs = path.join(directory, 'preferences.json');
  let automatic = true,
    running = null,
    controller = null,
    downloaded = null;
  try {
    automatic = JSON.parse(fs.readFileSync(prefs, 'utf8')).automatic !== false;
  } catch {}
  let state = {
    phase: enabled ? 'idle' : 'disabled',
    automatic,
    currentVersion,
    repository: REPOSITORY,
    progress: 0,
    message: enabled ? '自动检查 GitHub Release' : '开发预览不安装更新',
  };
  const publish = (update) => {
    state = { ...state, ...update };
    emit({ ...state });
    return { ...state };
  };
  async function check() {
    if (!enabled || ['ready', 'installing'].includes(state.phase)) return { ...state };
    if (running) return running;
    controller = new AbortController();
    running = (async () => {
      try {
        publish({ phase: 'checking', message: '正在检查 FreeCut GitHub Release…', progress: 0 });
        const response = await fetchTrusted(RELEASES_URL, {
          fetchImpl,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok)
          throw Error(
            response.status === 403 || response.status === 429
              ? 'GitHub 请求暂时受限，请稍后重试。'
              : `检查更新失败（HTTP ${response.status}）。`,
          );
        const releases = JSON.parse(
          (await readBounded(response, 8 * 1024 * 1024)).toString('utf8'),
        );
        const asset = selectRelease(releases, { currentVersion, platform, arch, portable });
        if (!asset)
          return publish({
            phase: 'latest',
            message: '当前已是最新版本。',
            checkedAt: new Date().toISOString(),
          });
        publish({ phase: 'downloading', version: asset.version, message: '发现新版，正在下载…' });
        const file = await downloadAsset(asset, directory, {
          fetchImpl,
          signal: controller.signal,
          progress: (progress) => publish({ progress }),
        });
        controller.signal.throwIfAborted();
        downloaded = { ...asset, file };
        return publish({ phase: 'ready', progress: 1, message: '新版已下载并校验，准备安装。' });
      } catch (error) {
        return publish({
          phase: controller?.signal.aborted ? 'idle' : 'error',
          message: controller?.signal.aborted
            ? '已暂停更新。'
            : `更新未完成：${error.cause?.code || error.message || '网络连接失败'}。可稍后重试。`,
        });
      } finally {
        controller = null;
        running = null;
      }
    })();
    return running;
  }
  return {
    state: () => ({ ...state }),
    check,
    async setAutomatic(value) {
      if (typeof value !== 'boolean') throw Error('更新设置无效。');
      await fsp.mkdir(directory, { recursive: true });
      await fsp.writeFile(prefs, JSON.stringify({ automatic: value }));
      automatic = value;
      if (!value) controller?.abort();
      return publish({ automatic });
    },
    async prepareInstall() {
      if (!downloaded || !['ready', 'installing'].includes(state.phase))
        throw Error('更新文件尚未准备完成。');
      if ((await hashFile(downloaded.file).catch(() => null)) !== downloaded.sha256) {
        downloaded = null;
        publish({ phase: 'error', message: '更新文件发生变化，请重新检查更新。' });
        throw Error('更新文件校验失败。');
      }
      return { ...downloaded };
    },
    installing: () => publish({ phase: 'installing', message: '正在准备关闭并安装更新…' }),
    deferred: () => publish({ phase: 'ready', message: '已保留当前工程。新版可在方便时安装。' }),
    failed: (error) =>
      publish({
        phase: downloaded ? 'ready' : 'error',
        message: `暂时无法安装：${error.message}。`,
      }),
    dispose: () => controller?.abort(),
  };
}
module.exports = {
  REPOSITORY,
  compareVersions,
  selectRelease,
  safeUrl,
  fetchTrusted,
  downloadAsset,
  hashFile,
  createUpdater,
};
