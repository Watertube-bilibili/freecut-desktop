'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const tar = require('tar');
const { verifyFile, extract, speechSpans, createAIService, registerAI, NATIVE } = require('./ai.cjs');

async function temp(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-ai-unit-'));
  t.after(async () => { assert(path.dirname(folder) === os.tmpdir()); await fs.rm(folder, { recursive: true, force: true }); });
  return folder;
}
function archive(name, content = 'hello', type = 'File', linkpath) {
  const bytes = Buffer.from(content);
  const header = new tar.Header({ path: name, mode: 0o644, size: type === 'File' ? bytes.length : 0, type, linkpath });
  header.encode();
  const body = type === 'File' ? Buffer.concat([bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]) : Buffer.alloc(0);
  return Buffer.concat([header.block, body, Buffer.alloc(1024)]);
}

test('download integrity rejects missing, truncated and modified content', async t => {
  const folder = await temp(t); const file = path.join(folder, 'model');
  const content = Buffer.from('known model bytes');
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const integrity = 'sha512-' + crypto.createHash('sha512').update(content).digest('base64');
  assert.equal(await verifyFile(file, { size: content.length, sha256 }), false);
  await fs.writeFile(file, content);
  assert.equal(await verifyFile(file, { size: content.length, sha256 }), true);
  assert.equal(await verifyFile(file, { size: content.length, integrity }), true);
  await fs.writeFile(file, Buffer.alloc(content.length));
  assert.equal(await verifyFile(file, { size: content.length, sha256 }), false);
  await fs.writeFile(file, content.subarray(1));
  assert.equal(await verifyFile(file, { size: content.length, sha256 }), false);
});

test('safe extraction accepts a valid gzip archive and strips its package root', async t => {
  const folder = await temp(t); const source = path.join(folder, 'good.tgz'); const output = path.join(folder, 'out');
  await fs.writeFile(source, zlib.gzipSync(archive('package/nested/example.txt')));
  await extract(source, output, false, new AbortController().signal);
  assert.equal(await fs.readFile(path.join(output, 'nested/example.txt'), 'utf8'), 'hello');
});

for (const [label, name, type, link] of [
  ['parent traversal', '../escaped.txt', 'File'],
  ['absolute path', '/escaped.txt', 'File'],
  ['Windows alternate stream', 'package/file.txt:stream', 'File'],
  ['Windows device', 'package/NUL', 'File'],
  ['symbolic link', 'package/link', 'SymbolicLink', '../escaped.txt'],
  ['hard link', 'package/link', 'Link', '../escaped.txt'],
]) test(`safe extraction rejects ${label} without crashing`, async t => {
  const folder = await temp(t); const source = path.join(folder, 'bad.tar');
  await fs.writeFile(source, archive(name, 'x', type, link));
  await assert.rejects(extract(source, path.join(folder, 'out'), false, new AbortController().signal), /不安全|链接/);
  assert.equal(await fs.stat(path.join(folder, 'escaped.txt')).catch(() => null), null);
});

test('silence produces no fabricated speech and long spans do not overlap', () => {
  assert.deepEqual(speechSpans(new Float32Array(16000 * 2), 16000), []);
  const tone = new Float32Array(16000 * 60); tone.fill(0.1);
  const spans = speechSpans(tone, 16000);
  assert.equal(spans.length, 5);
  assert.equal(spans[0].start, 0); assert.equal(spans.at(-1).end, tone.length);
  spans.forEach((span, i) => { assert(span.end - span.start <= 12 * 16000); if (i) assert(span.start >= spans[i - 1].end); });
});

test('every AI IPC method rejects an untrusted sender before touching input', async t => {
  const folder = await temp(t); const handlers = new Map(); let checks = 0;
  registerAI({ app: { getPath: () => folder, on: () => {} }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, validateSender: () => { checks++; throw Error('untrusted sender'); } });
  assert.equal(handlers.size, 5);
  for (const handler of handlers.values()) await assert.rejects(handler({}, undefined), /untrusted sender/);
  assert.equal(checks, 5);
  assert.deepEqual(await fs.readdir(folder), []);
});

test('bad download checksum retries three times without installing executable code', { skip: !NATIVE[`${process.platform}-${process.arch}`] }, async t => {
  const folder = await temp(t); let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return new Response(Buffer.alloc(11954), { status: 200, headers: { 'content-length': '11954' } }); });
  const service = createAIService({ app: { getPath: () => folder } });
  await assert.rejects(service.install('tts-zh', () => {}), /散列校验失败/);
  assert.equal(calls, 3);
  const status = await service.status(); assert.equal(status.runtimeReady, false); assert.equal(status.busy, false);
  const downloads = await fs.readdir(path.join(folder, 'ai/downloads'));
  assert.deepEqual(downloads, []);
});

test('cancel stops an active mocked download and removes incomplete files', { skip: !NATIVE[`${process.platform}-${process.arch}`] }, async t => {
  const folder = await temp(t);
  t.mock.method(global, 'fetch', async () => new Response(Buffer.alloc(11954), { status: 200, headers: { 'content-length': '11954' } }));
  const service = createAIService({ app: { getPath: () => folder } });
  await assert.rejects(service.install('tts-zh', info => { if (info.phase === 'downloading') service.cancel(); }), /已取消/);
  assert.equal((await service.status()).busy, false);
  assert.deepEqual(await fs.readdir(path.join(folder, 'ai/downloads')), []);
});
