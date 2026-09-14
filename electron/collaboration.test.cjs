'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createCollaborationService } = require('./collaboration.cjs');
const {
  canonicalProject,
  validateManifest,
  address,
  mergeProjects,
  LIMITS,
} = require('./collaboration-protocol.cjs');
const copy = (value) => structuredClone(value);
const project = () => ({
  version: 1,
  id: 'room-project',
  name: 'Shared timeline',
  width: 1280,
  height: 720,
  fps: 30,
  background: '#101010',
  assets: [],
  clips: [],
  tracks: [
    { id: 'video', name: 'Video', kind: 'video', hidden: false, muted: false, locked: false },
  ],
});
const shape = (id) => ({
  id,
  name: id,
  kind: 'shape',
  trackId: 'video',
  start: 0,
  duration: 5,
  inPoint: 0,
  speed: 1,
  fadeIn: 0,
  fadeOut: 0,
  color: '#00ff00',
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 },
  effects: {
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    vignette: 0,
    pixelate: 0,
    chroma: false,
    chromaColor: '#00ff00',
    chromaThreshold: 80,
    flipX: false,
    flipY: false,
    mask: 'none',
    maskSize: 1,
  },
  keyframes: {},
});
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function eventually(check, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Expected synchronization did not arrive.');
}
function raw(port, method, route, key, peer, value, extra = {}) {
  return new Promise((resolve, reject) => {
    const body =
      value === undefined
        ? null
        : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: route,
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(peer ? { 'X-FreeCut-Peer': peer } : {}),
          ...(body ? { 'Content-Length': body.length } : {}),
          ...extra,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString() }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}
async function fixture(action) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-collaboration-'));
  const services = [];
  function peer(label) {
    const grants = new Map(),
      events = [],
      states = [];
    async function importPath(file) {
      const real = await fs.realpath(file);
      if (!grants.has(real))
        grants.set(real, {
          id: crypto.randomUUID(),
          name: path.basename(file),
          kind: 'audio',
          duration: 1,
          path: real,
          url: `freecut-media://asset/${crypto.randomUUID()}`,
        });
      return copy(grants.get(real));
    }
    function resolveAsset(asset) {
      if (!grants.has(asset.path)) throw Error('Media has not been imported.');
      return { path: asset.path };
    }
    const service = createCollaborationService({
      userData: path.join(directory, label),
      importPath,
      resolveAsset,
      emitProject: (event) => events.push(event),
      emitState: (state) => states.push(state),
    });
    services.push(service);
    return { service, events, states, importPath };
  }
  try {
    await action({ directory, peer });
  } finally {
    await Promise.all(services.map((service) => service.dispose()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test(
  'actual host and guest synchronize both ways, merge disjoint changes, and retain conflicting drafts',
  { timeout: 15000 },
  () =>
    fixture(async ({ peer }) => {
      const host = peer('host'),
        guest = peer('guest'),
        port = await unusedPort();
      const initial = project();
      initial.clips.push(shape('one'), shape('two'));
      const room = await host.service.host({ project: initial, port, name: 'Host' });
      assert.equal(room.mode, 'hosting');
      assert.match(room.key, /^[a-f0-9]{48}$/);
      const joined = await guest.service.join({
        host: '127.0.0.1',
        port,
        key: room.key,
        name: 'Guest',
      });
      assert.equal(joined.revision, 0);
      assert.equal(joined.project.clips.length, 2);
      assert.equal(guest.service.state().key, undefined);
      assert.equal(guest.service.state().invite, undefined);
      const hostEdit = copy(initial);
      hostEdit.clips[0].transform.x = 0.4;
      const first = await host.service.publish({ project: hostEdit, baseRevision: 0 });
      assert.equal(first.ok, true);
      const guestEdit = copy(joined.project);
      guestEdit.clips[1].transform.rotation = 12;
      const second = await guest.service.publish({ project: guestEdit, baseRevision: 0 });
      assert.equal(second.ok, true);
      assert.equal(second.project.clips[0].transform.x, 0.4);
      assert.equal(second.project.clips[1].transform.rotation, 12);
      assert.equal(second.originId, guest.service.state().peerId);
      assert.equal(host.events.at(-1).originId, guest.service.state().peerId);
      assert.equal(host.events.at(-1).project.clips[1].transform.rotation, 12);
      const conflict = copy(initial);
      conflict.clips[0].transform.x = 0.9;
      const rejected = await guest.service.publish({ project: conflict, baseRevision: 0 });
      assert.equal(rejected.ok, false);
      assert(rejected.conflicts.some((item) => item.endsWith('.x')));
      assert.equal(conflict.clips[0].transform.x, 0.9);
      assert.equal(host.service.state().revision, 2);
      await guest.service.leave();
      assert.equal(host.service.state().peers.length, 1);
      await host.service.leave();
      const reused = net.createServer();
      await new Promise((resolve) => reused.listen(port, '127.0.0.1', resolve));
      await new Promise((resolve) => reused.close(resolve));
    }),
);

test(
  'media is authorized, hashed and streamed in both directions; local copies survive leaving',
  { timeout: 15000 },
  () =>
    fixture(async ({ directory, peer }) => {
      const host = peer('host'),
        guest = peer('guest'),
        port = await unusedPort();
      const source = path.join(directory, 'private-source.wav');
      await fs.writeFile(source, Buffer.alloc(128 * 1024, 7));
      const initial = project();
      initial.assets.push(await host.importPath(source));
      const room = await host.service.host({ project: initial, port });
      const joined = await guest.service.join({
        invite: `freecut1:${Buffer.from(JSON.stringify({ host: '127.0.0.1', port, key: room.key })).toString('base64url')}`,
      });
      assert.notEqual(joined.project.assets[0].path, source);
      assert(
        joined.project.assets[0].path.startsWith(path.join(directory, 'guest', 'collaboration')),
      );
      assert.deepEqual(await fs.readFile(joined.project.assets[0].path), await fs.readFile(source));
      const remoteFile = path.join(directory, 'guest-import.wav');
      await fs.writeFile(remoteFile, Buffer.alloc(65536, 21));
      joined.project.assets.push(await guest.importPath(remoteFile));
      const published = await guest.service.publish({ project: joined.project, baseRevision: 0 });
      assert.equal(published.ok, true);
      const received = host.events.at(-1).project.assets[1];
      assert(received.path.startsWith(path.join(directory, 'host', 'collaboration')));
      assert.deepEqual(await fs.readFile(received.path), await fs.readFile(remoteFile));
      // Raw room protocol never contains host paths or local media access tokens.
      const rawJoin = await raw(port, 'POST', '/v1/join', room.key, null, {
        name: 'Read protocol',
      });
      assert.equal(rawJoin.status, 200);
      assert(!rawJoin.text.includes(source));
      assert(!rawJoin.text.includes('freecut-media://'));
      await host.service.leave();
      await eventually(() => guest.service.state().mode === 'disconnected');
      assert.deepEqual(await fs.readFile(joined.project.assets[0].path), await fs.readFile(source));
      assert.equal(
        (await fs.readdir(path.join(directory, 'guest', 'collaboration'))).some((name) =>
          name.startsWith('.incoming-'),
        ),
        false,
      );
    }),
);

test(
  'room rejects wrong keys, browser origins, traversal, undeclared uploads and oversized or path-bearing projects',
  { timeout: 15000 },
  () =>
    fixture(async ({ peer }) => {
      const host = peer('host'),
        guest = peer('guest'),
        port = await unusedPort();
      const room = await host.service.host({ project: project(), port });
      await assert.rejects(
        guest.service.join({ host: '127.0.0.1', port, key: '0'.repeat(48) }),
        /key|browser/,
      );
      assert.equal(
        (
          await raw(
            port,
            'POST',
            '/v1/join',
            room.key,
            null,
            {},
            { Origin: 'https://hostile.example' },
          )
        ).status,
        403,
      );
      const joined = JSON.parse((await raw(port, 'POST', '/v1/join', room.key, null, {})).text);
      const id = joined.peerId;
      for (const route of [
        '/v1/media/../../private.wav',
        '/v1/media/%2e%2e%2fprivate.wav',
        '/etc/passwd',
        '/v1/media/' + 'a'.repeat(64) + '.wav',
      ])
        assert.equal((await raw(port, 'GET', route, room.key, id)).status, 404);
      assert.equal(
        (await raw(port, 'PUT', '/v1/media/' + 'a'.repeat(64) + '.wav', room.key, id, 'steal'))
          .status,
        403,
      );
      const forged = project();
      forged.assets.push({
        id: 'evil',
        name: 'private.wav',
        kind: 'audio',
        duration: 1,
        url: '',
        path: path.resolve('private.wav'),
      });
      assert.equal(
        (await raw(port, 'POST', '/v1/prepare', room.key, id, { project: forged, media: [] }))
          .status,
        400,
      );
      assert.equal(
        (
          await raw(port, 'POST', '/v1/prepare', room.key, id, {
            project: project(),
            media: [],
            padding: 'x'.repeat(LIMITS.project + 131073),
          })
        ).status,
        400,
      );
      const source = project();
      source.assets.push({
        id: 'evil',
        name: 'private.wav',
        kind: 'audio',
        duration: 1,
        url: '',
        path: path.resolve('private.wav'),
      });
      await assert.rejects(host.service.publish({ project: source, baseRevision: 0 }), /imported/);
      assert.equal(host.service.state().revision, 0);
    }),
);

test(
  'binding an occupied port fails cleanly and a stopped room cannot expose previous room media',
  { timeout: 15000 },
  () =>
    fixture(async ({ directory, peer }) => {
      const host = peer('host'),
        other = peer('other'),
        port = await unusedPort();
      const source = path.join(directory, 'previous-room.wav');
      await fs.writeFile(source, Buffer.from('previous room private media'));
      const initial = project();
      initial.assets.push(await host.importPath(source));
      await host.service.host({ project: initial, port });
      await assert.rejects(other.service.host({ project: project(), port }), /already in use/);
      assert.equal(other.service.state().mode, 'disconnected');
      await host.service.leave();
      const room = await host.service.host({ project: project(), port });
      const joined = JSON.parse((await raw(port, 'POST', '/v1/join', room.key, null, {})).text);
      const forged = canonicalProject(initial),
        hash = crypto
          .createHash('sha256')
          .update(await fs.readFile(source))
          .digest('hex');
      const manifest = [
        { id: forged.assets[0].id, hash, ext: '.wav', size: (await fs.stat(source)).size },
      ];
      const check = JSON.parse(
        (
          await raw(port, 'POST', '/v1/prepare', room.key, joined.peerId, {
            project: forged,
            media: manifest,
          })
        ).text,
      );
      assert.deepEqual(check.missing, [`${hash}.wav`]);
      assert.equal(
        (
          await raw(port, 'POST', '/v1/publish', room.key, joined.peerId, {
            project: forged,
            media: manifest,
            baseRevision: 0,
          })
        ).status,
        400,
      );
      assert.equal(
        (await raw(port, 'GET', `/v1/media/${hash}.wav`, room.key, joined.peerId)).status,
        404,
      );
    }),
);

test('wire limits, fixed IPv4 destinations and three-way edit/delete conflicts', () => {
  for (const host of [
    'https://example.com',
    'localhost',
    '127.0.0.1/path',
    '0.0.0.0',
    '239.1.2.3',
    '::1',
  ])
    assert.throws(() => address({ host, port: 45823, key: 'a'.repeat(48) }));
  assert.throws(() => address({ host: '127.0.0.1', port: 80, key: 'a'.repeat(48) }));
  const value = project();
  value.assets.push({ id: 'a', name: 'a.wav', kind: 'audio', duration: 1, url: '' });
  assert.throws(() =>
    validateManifest(value, [
      { id: 'a', hash: 'a'.repeat(64), size: LIMITS.asset + 1, ext: '.wav' },
    ]),
  );
  assert.throws(() =>
    validateManifest(value, [{ id: 'a', hash: 'a'.repeat(64), size: 1, ext: '/../wav' }]),
  );
  const base = project();
  base.clips.push(shape('one'));
  const deleted = copy(base);
  deleted.clips = [];
  const edited = copy(base);
  edited.clips[0].duration = 2;
  assert.equal(mergeProjects(base, deleted, edited).conflicts.length, 1);
  assert.equal(mergeProjects(base, base, deleted).project.clips.length, 0);
});

test(
  'simultaneous joins stay bounded; invalid uploads never become readable or published',
  { timeout: 15000 },
  () =>
    fixture(async ({ directory, peer }) => {
      const host = peer('host'),
        port = await unusedPort();
      const room = await host.service.host({ project: project(), port });
      const joins = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          raw(port, 'POST', '/v1/join', room.key, null, { name: `Editor ${index}` }),
        ),
      );
      assert.equal(joins.filter((result) => result.status === 200).length, 7);
      assert.equal(joins.filter((result) => result.status === 429).length, 5);
      assert.equal(host.service.state().peers.length, 8);
      const joined = JSON.parse(joins.find((result) => result.status === 200).text);
      const value = project();
      value.assets.push({ id: 'audio', name: 'audio.wav', kind: 'audio', url: '', duration: 1 });
      const manifest = [{ id: 'audio', hash: 'a'.repeat(64), size: 16, ext: '.wav' }];
      const prepared = await raw(port, 'POST', '/v1/prepare', room.key, joined.peerId, {
        project: value,
        media: manifest,
      });
      assert.equal(prepared.status, 200);
      const uploaded = await raw(
        port,
        'PUT',
        `/v1/media/${manifest[0].hash}.wav`,
        room.key,
        joined.peerId,
        'not correct hash',
      );
      assert.equal(uploaded.status, 400);
      assert.equal(
        (await raw(port, 'GET', `/v1/media/${manifest[0].hash}.wav`, room.key, joined.peerId))
          .status,
        404,
      );
      assert.equal(host.service.state().revision, 0);
      assert.deepEqual(await fs.readdir(path.join(directory, 'host', 'collaboration')), []);
    }),
);

test(
  'leaving cancels an active upload and removes partial files; the same service can host again',
  { timeout: 15000 },
  () =>
    fixture(async ({ directory, peer }) => {
      const host = peer('host'),
        port = await unusedPort();
      const room = await host.service.host({ project: project(), port });
      const joined = JSON.parse((await raw(port, 'POST', '/v1/join', room.key, null, {})).text);
      const value = project();
      value.assets.push({ id: 'audio', name: 'audio.wav', kind: 'audio', url: '', duration: 1 });
      const manifest = [{ id: 'audio', hash: 'b'.repeat(64), size: 1024 * 1024, ext: '.wav' }];
      await raw(port, 'POST', '/v1/prepare', room.key, joined.peerId, {
        project: value,
        media: manifest,
      });
      const upload = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/v1/media/${manifest[0].hash}.wav`,
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${room.key}`,
          'X-FreeCut-Peer': joined.peerId,
          'Content-Length': manifest[0].size,
        },
      });
      upload.on('error', () => {});
      upload.write(Buffer.alloc(4096, 1));
      await eventually(() => host.service.state().mode === 'hosting');
      // Wait for the first bytes to reach the owned temporary file, not a timer
      // guessed from a particular machine's disk speed.
      const cacheDirectory = path.join(directory, 'host', 'collaboration');
      for (let count = 0; count < 100; count++) {
        if (
          (await fs.readdir(cacheDirectory).catch(() => [])).some((name) =>
            name.startsWith('.incoming-'),
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert((await fs.readdir(cacheDirectory)).some((name) => name.startsWith('.incoming-')));
      await host.service.dispose();
      upload.destroy();
      for (let count = 0; count < 100; count++) {
        if (!(await fs.readdir(cacheDirectory)).some((name) => name.startsWith('.incoming-')))
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(await fs.readdir(cacheDirectory), []);
      const next = await host.service.host({ project: project(), port });
      assert.equal(next.mode, 'hosting');
      assert.notEqual(next.key, room.key);
    }),
);

test(
  'individually valid duration and keyframe edits cannot merge into an invalid room project',
  { timeout: 15000 },
  () =>
    fixture(async ({ peer }) => {
      const host = peer('host'),
        guest = peer('guest');
      const initial = project();
      initial.clips.push(shape('one'));
      const room = await host.service.host({ project: initial, port: await unusedPort() });
      await guest.service.join({ host: '127.0.0.1', port: room.port, key: room.key });
      const shortened = copy(initial);
      shortened.clips[0].duration = 2;
      assert.equal((await host.service.publish({ project: shortened, baseRevision: 0 })).ok, true);
      const animated = copy(initial);
      animated.clips[0].keyframes.x = [{ id: 'late', time: 4, value: 0.2, easing: 'linear' }];
      const result = await guest.service.publish({ project: animated, baseRevision: 0 });
      assert.equal(result.ok, false);
      assert.deepEqual(result.conflicts, ['project.references']);
      assert.equal(host.service.state().revision, 1);
      assert.equal(result.project.clips[0].duration, 2);
      assert.equal(animated.clips[0].keyframes.x[0].time, 4, 'local draft was not altered');
    }),
);

const ffmpeg =
  process.env.FREECUT_TEST_FFMPEG ||
  path.resolve('resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
test(
  'downloaded media uses real import grants and exports locally after the host leaves',
  { skip: !require('node:fs').existsSync(ffmpeg), timeout: 30000 },
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-collaboration-export-'));
    const { createMediaLibrary } = require('./media.cjs');
    const { createExporter } = require('./export.cjs');
    const mediaHost = createMediaLibrary(ffmpeg),
      mediaGuest = createMediaLibrary(ffmpeg);
    const host = createCollaborationService({
      userData: path.join(directory, 'host'),
      resolveAsset: mediaHost.resolveAsset,
      importPath: mediaHost.importPath,
    });
    const guest = createCollaborationService({
      userData: path.join(directory, 'guest'),
      resolveAsset: mediaGuest.resolveAsset,
      importPath: mediaGuest.importPath,
    });
    const exporter = createExporter({
      ffmpegPath: ffmpeg,
      resolveAsset: mediaGuest.resolveAsset,
      temporaryRoot: directory,
      emitProgress: () => {},
    });
    try {
      // One second of ordinary PCM WAV, generated without a test download.
      const wav = Buffer.alloc(44 + 16000 * 2);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(16000, 24);
      wav.writeUInt32LE(32000, 28);
      wav.writeUInt16LE(2, 32);
      wav.writeUInt16LE(16, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(32000, 40);
      for (let sample = 0; sample < 16000; sample++)
        wav.writeInt16LE(
          Math.round(Math.sin((sample / 16000) * Math.PI * 880) * 8000),
          44 + sample * 2,
        );
      const file = path.join(directory, 'tone.wav');
      await fs.writeFile(file, wav);
      const initial = project();
      initial.assets.push(await mediaHost.importPath(file));
      initial.clips.push({
        ...shape('sound'),
        kind: 'audio',
        assetId: initial.assets[0].id,
        duration: 1,
      });
      const room = await host.host({ project: initial, port: await unusedPort() });
      const joined = await guest.join({ host: '127.0.0.1', port: room.port, key: room.key });
      assert.equal(joined.project.assets[0].kind, 'audio');
      assert(mediaGuest.resolveAsset(joined.project.assets[0]).hasAudio);
      await host.leave();
      const output = path.join(directory, 'guest-after-host-left.mp4');
      const job = await exporter.begin(
        {
          project: joined.project,
          width: 32,
          height: 32,
          fps: 10,
          duration: 1,
          quality: 'medium',
          format: 'mp4',
          pipeline: 'auto',
          frameFormat: 'rgba',
        },
        output,
      );
      assert.equal(job.pipeline, 'native');
      await exporter.finish(job.jobId);
      const restored = await mediaGuest.importPath(output);
      assert.equal(restored.kind, 'video');
      assert(restored.duration >= 1);
      const { stdout } = await require('node:util').promisify(
        require('node:child_process').execFile,
      )(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          output,
          '-map',
          '0:a:0',
          '-ac',
          '1',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { encoding: 'buffer', windowsHide: true },
      );
      let energy = 0;
      for (let index = 0; index < stdout.length; index += 4)
        energy += stdout.readFloatLE(index) ** 2;
      assert(Math.sqrt(energy / (stdout.length / 4)) > 0.1, 'the exported shared audio is audible');
    } finally {
      await exporter.dispose();
      await Promise.all([host.dispose(), guest.dispose()]);
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
