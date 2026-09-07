'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { download, createAIService, NATIVE } = require('./ai.cjs');

const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function fixture(t, size = 4 * 1024 * 1024 + 32768) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-model-download-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true }); });
  const bytes = Buffer.alloc(size, 0x45), spec = { name: 'model.bin', url: 'https://huggingface.co/test/pinned-model.bin', size, sha256: hash(bytes) };
  const final = path.join(directory, hash(spec.url).slice(0, 20) + '-model.bin');
  return { directory, bytes, spec, final, partial: final + '.part' };
}
async function receivedPrefixBarrier(file, expected, signal) {
  while (true) {
    signal.throwIfAborted();
    const actual = await fs.readFile(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (actual?.length === expected.length) {
      assert.deepEqual(actual, expected);
      return;
    }
    if (actual) assert(actual.length < expected.length, 'the interrupted response wrote no extra bytes');
    await new Promise(resolve => setImmediate(resolve));
  }
}
function reply(bytes, options, partialOnFailure = null, ignoreRange = false) {
  const range = new Headers(options.headers).get('Range');
  let start = 0, end = bytes.length - 1;
  if (range && !ignoreRange) [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range).map(Number);
  const selected = bytes.subarray(start, end + 1);
  const body = partialOnFailure ? new ReadableStream({ start(controller) {
    const prefix = selected.subarray(0, Math.min(65536, selected.length));
    controller.enqueue(prefix);
    // Trigger this test's connection reset only after the real destination
    // contains the received prefix. A timer could fire before the stream opens
    // its file under concurrent rendering/build load, legitimately resuming at 0.
    receivedPrefixBarrier(partialOnFailure, bytes.subarray(0, start + prefix.length), options.signal)
      .then(() => controller.error(Object.assign(Error('Connection reset during transfer'), { code: 'ECONNRESET' })))
      .catch(error => controller.error(error));
  } }) : selected;
  return new Response(body, { status: range && !ignoreRange ? 206 : 200, headers: range && !ignoreRange ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {} });
}

test('a large interrupted model resumes from the received prefix and verifies the complete SHA-256', { timeout: 30000 }, async t => {
  const h = await fixture(t), ranges = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { ranges.push(new Headers(options.headers).get('Range')); return reply(h.bytes, options, ranges.length === 1 ? h.partial : null); });
  const output = await download(h.spec, h.directory, () => {}, t.signal);
  assert.equal(output, h.final); assert.deepEqual(await fs.readFile(output), h.bytes);
  assert.equal(ranges[0], `bytes=0-${4 * 1024 * 1024 - 1}`);
  assert.equal(ranges[1], `bytes=65536-${h.bytes.length - 1}`);
  assert.equal(ranges.length, 2);
});

test('exhausted connection retries retain the verified-length prefix for a later attempt', { timeout: 30000 }, async t => {
  const h = await fixture(t, 512 * 1024); let fail = true; const ranges = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { ranges.push(new Headers(options.headers).get('Range')); return reply(h.bytes, options, fail ? h.partial : null); });
  await assert.rejects(download(h.spec, h.directory, () => {}, t.signal), /已下载部分已保留/);
  const size = (await fs.stat(h.partial)).size;
  assert.equal(size, 3 * 65536); assert.equal(await fs.stat(h.final).catch(() => null), null);
  fail = false;
  await download(h.spec, h.directory, () => {}, t.signal);
  assert.equal(ranges.at(-1), `bytes=${size}-${h.bytes.length - 1}`);
  assert.deepEqual(await fs.readFile(h.final), h.bytes);
});

test('an incorrect Content-Range is rejected without overwriting the cached prefix', async t => {
  const h = await fixture(t, 512); await fs.writeFile(h.partial, h.bytes.subarray(0, 64));
  t.mock.method(globalThis, 'fetch', async () => new Response(h.bytes, { status: 206, headers: { 'content-range': 'bytes 0-511/512' } }));
  await assert.rejects(download(h.spec, h.directory, () => {}, new AbortController().signal), /分段范围不一致/);
  assert.equal((await fs.stat(h.partial)).size, 64); assert.equal(await fs.stat(h.final).catch(() => null), null);
});

test('a server ignoring Range safely restarts instead of appending duplicate bytes', async t => {
  const h = await fixture(t, 512); await fs.writeFile(h.partial, h.bytes.subarray(0, 64)); const ranges = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { ranges.push(new Headers(options.headers).get('Range')); return reply(h.bytes, options, false, true); });
  await download(h.spec, h.directory, () => {}, new AbortController().signal);
  assert.deepEqual(ranges, ['bytes=64-511', null]); assert.deepEqual(await fs.readFile(h.final), h.bytes);
});

test('a checksum mismatch cannot become a ready model even when every byte was received', async t => {
  const h = await fixture(t, 512); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(Buffer.alloc(512)); });
  await assert.rejects(download(h.spec, h.directory, () => {}, new AbortController().signal), /散列校验失败/);
  assert.equal(calls, 3); assert.deepEqual(await fs.readdir(h.directory), []);
});

test('same-size runtime corruption is reported as unavailable before native loading and records diagnostics', { skip: !NATIVE[`${process.platform}-${process.arch}`] }, async t => {
  const h = await fixture(t, 1);
  async function receipt(folder, name, bytes) {
    await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, name), bytes);
    await fs.writeFile(path.join(folder, 'installed.json'), JSON.stringify({ version: '1.13.7', files: [{ name, size: bytes.length, sha256: hash(bytes) }] }));
  }
  const runtime = path.join(h.directory, 'ai', `runtime-1.13.7-${process.platform}-${process.arch}`), model = path.join(h.directory, 'ai', 'asr-sensevoice-v1');
  await receipt(runtime, 'library.bin', Buffer.from('original')); await receipt(model, 'model.bin', Buffer.from('original'));
  const service = createAIService({ app: { getPath: () => h.directory }, validateMediaPath: value => value });
  assert.equal((await service.status()).runtimeReady, true);
  await fs.writeFile(path.join(runtime, 'library.bin'), 'modified');
  const status = await service.status(); assert.equal(status.runtimeReady, false); assert.equal(status.models[0].installed, true);
  await assert.rejects(service.transcribe({ modelId: 'asr-sensevoice', path: 'fixture.wav', inPoint: 0, duration: 1, language: 'zh' }, () => {}), /语音引擎文件缺失或损坏.*校验/);
  const log = JSON.parse((await fs.readFile(path.join(h.directory, 'ai', 'diagnostics.jsonl'), 'utf8')).trim());
  assert.equal(log.operation, 'transcribe'); assert.equal(log.modelId, 'asr-sensevoice'); assert.equal(log.result, 'failed');
  assert.equal(log.phase, '准备'); assert.match(log.error, /语音引擎/);
});
