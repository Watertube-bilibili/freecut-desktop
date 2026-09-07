'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  compareVersions,
  selectRelease,
  safeUrl,
  fetchTrusted,
  downloadAsset,
  createUpdater,
} = require('./updater.cjs');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const data = Buffer.from('a verified package, containing only test data');
const asset = {
  name: 'FreeCut-0.4.0-win-x64-Setup.exe',
  state: 'uploaded',
  size: data.length,
  digest: `sha256:${hash(data)}`,
  browser_download_url:
    'https://github.com/Watertube-bilibili/freecut-desktop/releases/download/v0.4.0-preview.1/FreeCut-0.4.0-win-x64-Setup.exe',
};
const release = { tag_name: 'v0.4.0-preview.1', draft: false, prerelease: true, assets: [asset] };
const options = {
  currentVersion: 'v0.3.0-preview.1',
  platform: 'win32',
  arch: 'x64',
  portable: false,
};
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-update-test-'));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    return fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
function rangeResponse(input, init, bytes = data) {
  if (input.includes('api.github.com')) return new Response(JSON.stringify([release]));
  const match = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
  const start = Number(match[1]),
    end = Number(match[2]);
  return new Response(bytes.subarray(start, end + 1), {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` },
  });
}
test('versions compare numeric components and prerelease order; current tag is not an update', () => {
  for (const [a, b] of [
    ['0.10.0', '0.9.0'],
    ['v0.3.0-preview.10', 'v0.3.0-preview.2'],
    ['0.3.0', '0.3.0-preview.1'],
  ])
    assert(compareVersions(a, b) > 0);
  assert.equal(compareVersions('v0.3.0-preview.1', '0.3.0-preview.1'), 0);
  assert.equal(selectRelease([release], { ...options, currentVersion: release.tag_name }), null);
});
test('selects only the intended repo, platform, channel artifact and trusted digest', () => {
  assert.equal(selectRelease([release], options).name, asset.name);
  assert.equal(selectRelease([release], { ...options, portable: true }), null);
  assert.equal(selectRelease([{ ...release, draft: true }], options), null);
  for (const change of [
    { digest: null },
    { browser_download_url: asset.browser_download_url.replace('Watertube-bilibili', 'attacker') },
    { size: 1e12 },
  ]) {
    assert.throws(() =>
      selectRelease([{ ...release, assets: [{ ...asset, ...change }] }], options),
    );
  }
});
test('redirects cannot leave HTTPS GitHub infrastructure', async () => {
  for (const url of [
    'http://github.com/a',
    'https://github.com.attacker.com/a',
    'https://u:p@github.com/a',
    'https://github.com:444/a',
  ])
    assert.throws(() => safeUrl(url));
  let calls = 0;
  await assert.rejects(
    fetchTrusted(asset.browser_download_url, {
      fetchImpl: async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { location: 'https://untrusted.example/update.exe' },
        });
      },
    }),
  );
  assert.equal(calls, 1);
});
test('resumes a verified download prefix and verifies the full SHA before ready', async (t) => {
  const dir = await temporary(t),
    chosen = selectRelease([release], options);
  await fs.writeFile(
    path.join(dir, `${chosen.name}.${chosen.sha256.slice(0, 16)}.partial`),
    data.subarray(0, 7),
  );
  let firstRange;
  const file = await downloadAsset(chosen, dir, {
    fetchImpl: async (url, init) => {
      firstRange ??= init.headers.Range;
      return rangeResponse(url, init);
    },
  });
  assert.equal(firstRange, `bytes=7-${data.length - 1}`);
  assert.deepEqual(await fs.readFile(file), data);
});
test('corrupt file never becomes executable ready artifact', async (t) => {
  const dir = await temporary(t),
    chosen = selectRelease([release], options);
  await assert.rejects(
    downloadAsset(chosen, dir, {
      fetchImpl: async (url, init) => rangeResponse(url, init, Buffer.alloc(data.length, 1)),
    }),
    /校验失败/,
  );
  assert.deepEqual(await fs.readdir(dir), []);
});
test('wrong range or ignored resumed range cannot silently corrupt or execute a download', async (t) => {
  const dir = await temporary(t),
    chosen = selectRelease([release], options);
  const partial = path.join(dir, `${chosen.name}.${chosen.sha256.slice(0, 16)}.partial`);
  await fs.writeFile(partial, data.subarray(0, 5));
  await assert.rejects(downloadAsset(chosen, dir, { fetchImpl: async () => new Response(data) }));
  assert.deepEqual(await fs.readFile(partial), data.subarray(0, 5));
});
test('download failures stay nonfatal; retries complete; toggles persist', async (t) => {
  const userData = await temporary(t);
  let online = false,
    calls = 0;
  const updater = createUpdater({
    ...options,
    userData,
    fetchImpl: async (url, init) => {
      calls++;
      if (!online) throw Error('offline');
      return rangeResponse(url, init);
    },
  });
  assert.equal((await updater.check()).phase, 'error');
  online = true;
  const [a, b] = await Promise.all([updater.check(), updater.check()]);
  assert.equal(a.phase, 'ready');
  assert.equal(b.phase, 'ready');
  assert.equal(calls, 3);
  const prepared = await updater.prepareInstall();
  await fs.writeFile(prepared.file, 'tampered');
  await assert.rejects(updater.prepareInstall(), /校验失败/);
  assert.equal(updater.state().phase, 'error');
  await updater.setAutomatic(false);
  assert.equal(createUpdater({ ...options, userData }).state().automatic, false);
});
test('development and test profiles never fetch or auto install', async (t) => {
  const updater = createUpdater({
    userData: await temporary(t),
    ...options,
    enabled: false,
    fetchImpl: () => {
      throw Error('must not fetch');
    },
  });
  assert.equal((await updater.check()).phase, 'disabled');
  await assert.rejects(updater.prepareInstall());
});
test('short response retries never commit the failed body to the partial file', async (t) => {
  const dir = await temporary(t),
    chosen = selectRelease([release], options);
  let calls = 0;
  await assert.rejects(
    downloadAsset(chosen, dir, {
      fetchImpl: async () => {
        calls++;
        return new Response(data.subarray(0, 3), {
          status: 206,
          headers: { 'content-range': `bytes 0-${data.length - 1}/${data.length}` },
        });
      },
    }),
    /下载中断/,
  );
  assert.equal(calls, 3);
  assert.equal(
    (await fs.stat(path.join(dir, `${chosen.name}.${chosen.sha256.slice(0, 16)}.partial`))).size,
    0,
  );
});
test('large ignored Range responses are cancelled without buffering the installer', async (t) => {
  const dir = await temporary(t),
    chosen = { ...selectRelease([release], options), size: 5000000 };
  let cancelled = 0;
  await assert.rejects(
    downloadAsset(chosen, dir, {
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
        ),
    }),
    /分段下载/,
  );
  assert.equal(cancelled, 3);
});
test('cancelling after final chunk cannot publish a ready executable', async (t) => {
  const dir = await temporary(t),
    chosen = selectRelease([release], options),
    controller = new AbortController();
  await assert.rejects(
    downloadAsset(chosen, dir, {
      fetchImpl: async (url, init) => rangeResponse(url, init),
      signal: controller.signal,
      progress: () => controller.abort(),
    }),
    { name: 'AbortError' },
  );
  await assert.rejects(fs.stat(path.join(dir, chosen.name)), { code: 'ENOENT' });
});
test('a removed ready artifact returns to recoverable error and can download again', async (t) => {
  const userData = await temporary(t);
  const updater = createUpdater({
    ...options,
    userData,
    fetchImpl: async (url, init) => rangeResponse(url, init),
  });
  assert.equal((await updater.check()).phase, 'ready');
  await fs.unlink((await updater.prepareInstall()).file);
  await assert.rejects(updater.prepareInstall(), /校验失败/);
  assert.equal(updater.failed(Error('missing file')).phase, 'error');
  assert.equal((await updater.check()).phase, 'ready');
  assert.deepEqual(await fs.readFile((await updater.prepareInstall()).file), data);
});
test('download metadata cannot escape the update directory', async (t) => {
  const dir = await temporary(t),
    chosen = selectRelease([release], options);
  await assert.rejects(downloadAsset({ ...chosen, name: '../other.exe' }, dir), /文件信息无效/);
});
