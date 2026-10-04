'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRecovery } = require('./recovery.cjs');
const { validateProject } = require('./export.cjs');

async function fixture(t, limits) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-recovery-test-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const mediaPath = path.join(userData, 'selected.mp4');
  const authorized = new Set([mediaPath]);
  const imports = [];
  const options = {
    userData, validateProject, limits,
    resolveAsset: asset => {
      if (!authorized.has(asset.path)) throw Error('Not authorized');
      return { path: asset.path, kind: 'video' };
    },
    importPath: async file => {
      imports.push(file);
      if (!authorized.has(file)) throw Error('Missing media');
      return { id: crypto.randomUUID(), path: file, url: 'freecut-media://asset/new-token', name: 'selected.mp4', kind: 'video', duration: 12 };
    },
  };
  const project = {
    version: 1, id: 'project-one', name: '恢复测试', width: 1920, height: 1080, fps: 30, background: '#000000',
    assets: [{ id: 'asset-one', name: 'selected.mp4', kind: 'video', duration: 12, path: mediaPath, url: 'freecut-media://asset/old-token', thumbnail: 'data:discard-me', extra: 'discard-me' }],
    clips: [], tracks: [{ id: 'video', name: 'Video', kind: 'video', muted: false, hidden: false, locked: false }],
  };
  return { userData, project, mediaPath, imports, authorized, options, service: createRecovery(options) };
}

test('restarts preserve revisions, normalize media and restore fresh access tokens without changing original projects', async t => {
  const f = await fixture(t);
  const original = path.join(f.userData, 'manual.freecut');
  await fs.writeFile(original, 'original manual project');
  const first = await f.service.snapshot({ project: f.project, sessionId: 'one', dirty: true });
  const project = { ...f.project, name: 'Second edit' };
  const second = await f.service.snapshot({ project, sessionId: 'one' });
  assert.notEqual(first.entry.id, second.entry.id);
  const stored = JSON.parse(await fs.readFile(path.join(f.userData, 'recovery-v1', `${first.entry.id}.json`), 'utf8'));
  assert.equal(stored.project.assets[0].url, '');
  assert.equal(stored.project.assets[0].thumbnail, undefined);
  assert.equal(stored.project.assets[0].extra, undefined);
  const restarted = createRecovery(f.options);
  const list = await restarted.list();
  assert.equal(list.entries.length, 2);
  assert.equal(list.entries[0].id, second.entry.id);
  const restored = await restarted.restore(first.entry.id);
  assert.equal(restored.name, f.project.name);
  assert.equal(restored.assets[0].id, 'asset-one');
  assert.equal(restored.assets[0].url, 'freecut-media://asset/new-token');
  assert.deepEqual(f.imports, [f.mediaPath]);
  assert.equal((await restarted.list()).entries.length, 2, 'restoring never consumes the recovery copy');
  assert.equal(await fs.readFile(original, 'utf8'), 'original manual project');
});

test('clean and fresh empty workspaces leave previous sessions untouched; deleting all content in an existing session is recoverable', async t => {
  const f = await fixture(t);
  await f.service.snapshot({ project: f.project, sessionId: 'old' });
  const empty = { ...f.project, assets: [], clips: [] };
  assert.equal((await f.service.snapshot({ project: empty, sessionId: 'fresh', dirty: false })).status, 'clean');
  assert.equal((await f.service.snapshot({ project: empty, sessionId: 'fresh' })).status, 'empty');
  assert.equal((await f.service.list()).entries.length, 1);
  assert.equal((await f.service.snapshot({ project: empty, sessionId: 'old' })).status, 'saved');
  assert.equal((await f.service.list()).entries.length, 2);
  assert.equal((await f.service.snapshot({ project: { ...empty, name: 'Custom empty project' }, sessionId: 'edited-empty', dirty: true })).status, 'saved');
});

test('duplicate content is deduplicated and host-approved missing media is preserved across restart', async t => {
  const f = await fixture(t);
  const first = await f.service.snapshot({ project: f.project, sessionId: 'one' });
  assert.equal((await f.service.snapshot({ project: f.project, sessionId: 'one' })).status, 'unchanged');
  f.authorized.clear();
  const restored = await createRecovery(f.options).restore(first.entry.id);
  assert.equal(restored.assets[0].missing, true);
  assert.equal(restored.assets[0].path, f.mediaPath);
  assert.equal(restored.assets[0].url, '');
  const hostOpened = createRecovery(f.options);
  hostOpened.authorizeProject(restored);
  assert.equal((await hostOpened.snapshot({ project: restored, sessionId: 'opened' })).status, 'saved');
});

test('unauthorized paths, malformed schema and traversal IDs are rejected without reading external files', async t => {
  const f = await fixture(t);
  const unauthorized = structuredClone(f.project);
  unauthorized.assets[0].path = path.join(f.userData, 'never-selected.mp4');
  await assert.rejects(f.service.snapshot({ project: unauthorized, sessionId: 'one' }), /Not authorized/);
  const relative = structuredClone(f.project);
  relative.assets[0].path = '../outside.mp4';
  await assert.rejects(f.service.snapshot({ project: relative, sessionId: 'one' }));
  const malformed = { ...f.project, tracks: null };
  await assert.rejects(f.service.snapshot({ project: malformed, sessionId: 'one' }));
  await assert.rejects(f.service.snapshot({ project: f.project, sessionId: '' }));
  await assert.rejects(f.service.remove('../../manual.freecut'));
  await assert.rejects(f.service.restore('../../manual.freecut'));
  assert.equal((await f.service.list()).entries.length, 0);
  assert.deepEqual(f.imports, []);
});

test('corruption and abandoned atomic-write temporaries are isolated from valid records', async t => {
  const f = await fixture(t);
  const good = await f.service.snapshot({ project: f.project, sessionId: 'one' });
  const directory = path.join(f.userData, 'recovery-v1');
  await fs.writeFile(path.join(directory, `${crypto.randomUUID()}.json`), '{broken');
  await fs.writeFile(path.join(directory, '.interrupted.tmp'), '{partial');
  const badId = crypto.randomUUID();
  const tampered = JSON.parse(await fs.readFile(path.join(directory, `${good.entry.id}.json`), 'utf8'));
  tampered.id = badId;
  tampered.project.name = 'tampered';
  await fs.writeFile(path.join(directory, `${badId}.json`), JSON.stringify(tampered));
  const result = await createRecovery(f.options).list();
  assert.equal(result.entries.length, 1);
  assert.equal(result.issues, 2);
  assert.equal((await f.service.restore(good.entry.id)).id, f.project.id);
  await assert.rejects(f.service.restore(badId), /无法读取/);
});

test('revisions are bounded while the latest unsaved copy of another session survives', async t => {
  const f = await fixture(t, { maxRevisions: 2, maxEntries: 3 });
  const old = await f.service.snapshot({ project: f.project, sessionId: 'old' });
  for (let i = 0; i < 6; i++) await f.service.snapshot({ project: { ...f.project, name: `edit ${i}` }, sessionId: 'current' });
  const result = await f.service.list();
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries.filter(entry => entry.sessionId === 'current').length, 2);
  assert.ok(result.entries.some(entry => entry.id === old.entry.id));
  assert.equal(result.entries[0].name, 'edit 5');
});

test('full protected-session quota rejects new writes; explicit deletion permits retry', async t => {
  const f = await fixture(t, { maxEntries: 2 });
  const old = await f.service.snapshot({ project: f.project, sessionId: 'old' });
  await f.service.snapshot({ project: f.project, sessionId: 'second' });
  await assert.rejects(f.service.snapshot({ project: f.project, sessionId: 'third' }), error => error.code === 'RECOVERY_QUOTA');
  assert.equal((await f.service.list()).entries.length, 2);
  await f.service.remove(old.entry.id);
  assert.equal((await f.service.snapshot({ project: f.project, sessionId: 'third' })).status, 'saved');
});

test('individual size and total byte quotas reject oversized snapshots before changing existing copies', async t => {
  const f = await fixture(t);
  await f.service.snapshot({ project: f.project, sessionId: 'old' });
  const small = createRecovery({ ...f.options, limits: { maxSnapshotBytes: 20 } });
  await assert.rejects(small.snapshot({ project: f.project, sessionId: 'small' }), error => error.code === 'RECOVERY_SIZE');
  const quota = createRecovery({ ...f.options, limits: { maxBytes: 20 } });
  await assert.rejects(quota.snapshot({ project: f.project, sessionId: 'small' }), error => error.code === 'RECOVERY_QUOTA');
  assert.equal((await f.service.list()).entries.length, 1);
});

test('queued calls snapshot immutable inputs, continue after rejection, and preserve new edits when an older revision is saved', async t => {
  const f = await fixture(t);
  let release;
  let blocking = true;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createRecovery({ ...f.options, now: () => new Date('2026-01-01T00:00:00Z'), resolveAsset: async asset => {
    if (blocking) { blocking = false; await gate; }
    return f.options.resolveAsset(asset);
  } });
  const firstInput = structuredClone(f.project);
  const first = service.snapshot({ project: firstInput, sessionId: 'one' });
  firstInput.name = 'mutated after call';
  const invalid = service.snapshot({ project: { ...f.project, version: 100 }, sessionId: 'one' });
  const invalidHandled = assert.rejects(invalid);
  const secondInput = { ...f.project, name: 'later edit' };
  const second = service.snapshot({ project: secondInput, sessionId: 'one' });
  const markSaved = service.markSaved({ project: f.project, sessionId: 'one' });
  release();
  const [a, b] = await Promise.all([first, second, invalidHandled, markSaved]);
  const result = await service.list();
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries.find(entry => entry.id === a.entry.id).name, f.project.name);
  assert.equal(result.entries.find(entry => entry.id === a.entry.id).saved, true);
  assert.equal(result.entries.find(entry => entry.id === b.entry.id).saved, false);
  assert.equal(result.entries[0].id, b.entry.id, 'same-clock writes maintain order');
  await service.remove(a.entry.id);
  await service.flush();
  assert.equal((await service.list()).entries.length, 1);
});
