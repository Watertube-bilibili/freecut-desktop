'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const DHT = require('hyperdht');
const createTestnet = require('hyperdht/testnet');
const { createRemoteTransport, networkCandidates, ERRORS } = require('./collaboration-remote.cjs');
const { createCollaborationService } = require('./collaboration.cjs');
const { address } = require('./collaboration-protocol.cjs');

const project = () => ({
  version: 1,
  id: 'remote-project',
  name: 'Remote timeline',
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
const invite = (value) => `freecut2:${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(check) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (check()) return;
    await pause(20);
  }
  assert.fail('Expected peer state did not arrive.');
}
async function fixture(action) {
  const testnet = await createTestnet(5);
  const instances = [],
    nodes = [];
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-remote-'));
  const options = {
    bootstrap: testnet.bootstrap,
    candidates: ['127.0.0.1'],
    timeouts: { network: 3000, bootstrap: 3000, announce: 5000, connect: 5000 },
    createNode: (opts) => {
      const node = new DHT({
        ...opts,
        ephemeral: true,
        firewalled: false,
        port: crypto.randomInt(20000, 60000),
      });
      nodes.push(node);
      return node;
    },
  };
  const transport = (overrides = {}) => {
    const value = createRemoteTransport({ ...options, ...overrides });
    instances.push(value);
    return value;
  };
  try {
    await action({ transport, directory, nodes });
  } finally {
    await Promise.allSettled(instances.map((value) => value.close()));
    await testnet.destroy();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
function request(port, method, body, headers = {}, route = '/') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: route, headers },
      (response) => {
        const chunks = [];
        response.on('error', reject);
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, data: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(Error('Test request timed out.')));
    req.end(body);
  });
}
test('remote invitations accept only a public peer key and room key; network selection excludes synthetic interfaces', () => {
  const value = { transport: 'dht', publicKey: 'b'.repeat(64), key: 'a'.repeat(48) };
  assert.deepEqual(address({ invite: invite(value) }), { ...value, transport: 'remote' });
  for (const invalid of [
    { ...value, secretKey: 'x' },
    { ...value, privateSeed: 'x' },
    { ...value, host: '127.0.0.1' },
    { ...value, publicKey: '../secret' },
    { ...value, key: 'short' },
    { ...value, transport: 'https' },
    null,
  ])
    assert.throws(() => address({ invite: invite(invalid) }), /Invalid invitation/);
  assert.throws(() => address({ invite: `freecut2:${'x'.repeat(600)}` }), /Invalid invitation/);
  const item = (address, internal = false) => ({ family: 'IPv4', address, internal });
  assert.deepEqual(
    networkCandidates({
      tun: [item('198.18.0.1')],
      dead: [item('169.254.2.1')],
      lo: [item('127.0.0.1', true)],
      lan: [item('192.168.5.8')],
      fallback: [item('10.1.2.3')],
    }),
    ['192.168.5.8', '10.1.2.3', '0.0.0.0'],
  );
});

test(
  'real DHT Noise transport carries a large HTTP body both ways and closes its loopback proxy',
  { timeout: 25000 },
  async () => {
    await fixture(async ({ transport, nodes }) => {
      const phases = [];
      const host = transport({ onPhase: (value) => phases.push(value) }),
        guest = transport();
      const listener = http.createServer((req, res) => {
        assert.equal(req.socket.localAddress, '127.0.0.1');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', Connection: 'close' });
        req.pipe(res);
      });
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      try {
        const room = await host.host({ targetPort: listener.address().port });
        assert.match(room.publicKey, /^[a-f0-9]{64}$/);
        assert.deepEqual(Object.keys(room), ['publicKey']);
        assert.ok(nodes[0].listening.values().next().value._announcer.relays.length > 0);
        const connection = await guest.join(room);
        assert.equal(connection.host, '127.0.0.1');
        const payload = crypto.randomBytes(3 * 1024 * 1024);
        const response = await request(connection.port, 'POST', payload, {
          'Content-Length': payload.length,
        });
        assert.equal(response.status, 200);
        assert.deepEqual(response.data, payload);
        assert.deepEqual(phases, ['network', 'announcing', 'ready']);
        await guest.close();
        await assert.rejects(request(connection.port, 'GET'), /ECONNREFUSED|ECONNRESET/);
        await host.close();
        assert.ok(nodes.every((node) => node.destroyed));
      } finally {
        listener.closeAllConnections();
        await new Promise((resolve) => listener.close(resolve));
      }
    });
  },
);

test(
  'remote collaboration preserves room authorization, bidirectional revisions, media hashes and downloaded files after leave',
  { timeout: 30000 },
  async () => {
    await fixture(async ({ transport, directory, nodes }) => {
      const services = [];
      const make = (label) => {
        const events = [],
          grants = new Map();
        const importPath = async (file) => {
          const canonical = await fs.realpath(file);
          let asset = grants.get(canonical);
          if (!asset) {
            asset = {
              id: crypto.randomUUID(),
              name: path.basename(file),
              kind: 'audio',
              duration: 1,
              path: canonical,
              url: `freecut-media://asset/${crypto.randomUUID()}`,
            };
            grants.set(canonical, asset);
          }
          return asset;
        };
        const service = createCollaborationService({
          userData: path.join(directory, label),
          importPath,
          resolveAsset: (asset) =>
            [...grants.values()].find((item) => item.id === asset.id || item.path === asset.path),
          emitProject: (event) => events.push(event),
          remoteFactory: (opts) => transport(opts),
        });
        services.push(service);
        return { service, events, importPath };
      };
      const host = make('host'),
        guest = make('guest'),
        stranger = make('stranger');
      try {
        const source = path.join(directory, 'remote.wav');
        const payload = crypto.randomBytes(1024 * 1024);
        await fs.writeFile(source, payload);
        const initial = project();
        initial.assets.push(await host.importPath(source));
        const state = await host.service.host({ project: initial, transport: 'remote', port: 1 });
        assert.equal(state.mode, 'hosting');
        assert.equal(state.transport, 'remote');
        assert.equal(state.phase, 'ready');
        assert.equal(state.port, 0);
        assert.deepEqual(state.addresses, []);
        assert.ok(state.invite.startsWith('freecut2:'));
        const room = address({ invite: state.invite });
        assert.deepEqual(Object.keys(room).sort(), ['key', 'publicKey', 'transport']);
        await assert.rejects(
          stranger.service.join({
            invite: invite({ ...room, transport: 'dht', key: 'f'.repeat(48) }),
          }),
          /Invalid room key/,
        );
        assert.equal(stranger.service.state().mode, 'disconnected');
        const opened = await guest.service.join({ invite: state.invite });
        assert.deepEqual(await fs.readFile(opened.project.assets[0].path), payload);
        assert.notEqual(opened.project.assets[0].path, source);
        const edited = structuredClone(opened.project);
        edited.name = 'Edited remotely';
        const update = await guest.service.publish({ project: edited, baseRevision: 0 });
        assert.equal(update.ok, true);
        assert.equal(update.revision, 1);
        await eventually(() =>
          host.events.some((event) => event.project.name === 'Edited remotely'),
        );
        edited.background = '#abcdef';
        await host.service.publish({ project: edited, baseRevision: 1 });
        await eventually(() => guest.events.some((event) => event.revision === 2));
        const downloaded = opened.project.assets[0].path;
        await host.service.leave();
        await eventually(() => guest.service.state().mode === 'disconnected');
        assert.deepEqual(await fs.readFile(downloaded), payload);
        const next = await host.service.host({ project: project(), transport: 'remote' });
        assert.notEqual(address({ invite: next.invite }).publicKey, room.publicKey);
        assert.notEqual(next.key, state.key);
      } finally {
        await Promise.allSettled(services.map((service) => service.dispose()));
      }
      assert.ok(nodes.every((node) => node.destroyed));
    });
  },
);

function fakeNode(overrides = {}) {
  const node = Object.assign(new EventEmitter(), {
    bind: async () => {},
    ping: async () => ({}),
    fullyBootstrapped: async () => {},
    destroy: async function () {
      this.destroyed = true;
    },
    ...overrides,
  });
  return node;
}
test('a resolved bootstrap promise without a real response cannot publish a ready room', async () => {
  const phases = [],
    nodes = [];
  const remote = createRemoteTransport({
    candidates: ['127.0.0.1'],
    bootstrap: [{ host: '127.0.0.1', port: 9 }],
    onPhase: (value) => phases.push(value),
    createNode: () => {
      const node = fakeNode({
        ping: async () => {
          throw Error('No response');
        },
      });
      nodes.push(node);
      return node;
    },
  });
  await assert.rejects(remote.host({ targetPort: 12345 }), { message: ERRORS.offline });
  assert.deepEqual(phases, ['network']);
  assert.ok(nodes.every((node) => node.destroyed));
});
test('an announce without acknowledgement cannot expose an invitation and cleans its listener', async () => {
  let closed = false;
  const server = Object.assign(new EventEmitter(), {
    listen: async () => {},
    _announcer: { relays: [] },
    relayAddresses: [{ host: '1.2.3.4', port: 1 }],
    close: async () => {
      closed = true;
    },
  });
  const node = fakeNode({ createServer: () => server });
  const remote = createRemoteTransport({
    candidates: ['127.0.0.1'],
    bootstrap: [{ host: '127.0.0.1', port: 9 }],
    createNode: () => node,
  });
  await assert.rejects(remote.host({ targetPort: 12345 }), { message: ERRORS.announce });
  assert.equal(closed, true);
  assert.equal(node.destroyed, true);
});
test('leaving while a peer handshake or network check is pending cancels and destroys all resources', async () => {
  for (const pending of ['network', 'connect']) {
    const stream = new PassThrough();
    const phases = [];
    const node = fakeNode({
      ping: pending === 'network' ? () => new Promise(() => {}) : async () => ({}),
      connect: () => stream,
    });
    const remote = createRemoteTransport({
      candidates: ['127.0.0.1'],
      bootstrap: [{ host: '127.0.0.1', port: 9 }],
      createNode: () => node,
      onPhase: (value) => phases.push(value),
    });
    const connecting = remote.join({ publicKey: 'a'.repeat(64) });
    const rejected = assert.rejects(connecting, { message: ERRORS.closed });
    await eventually(() => phases.includes(pending === 'network' ? 'network' : 'connecting'));
    await remote.close();
    await rejected;
    assert.equal(node.destroyed, true);
    if (pending === 'connect') assert.equal(stream.destroyed, true);
  }
});

test('service cancellation during remote setup retains no invitation and permits a new LAN room', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-remote-cancel-'));
  const nodes = [];
  const service = createCollaborationService({
    userData: directory,
    importPath: async () => {
      throw Error('No media expected');
    },
    resolveAsset: () => null,
    remoteFactory: (options) =>
      createRemoteTransport({
        ...options,
        candidates: ['127.0.0.1'],
        bootstrap: [{ host: '127.0.0.1', port: 9 }],
        createNode: () => {
          const node = fakeNode({ ping: () => new Promise(() => {}) });
          nodes.push(node);
          return node;
        },
      }),
  });
  try {
    for (const action of ['host', 'join']) {
      const pending =
        action === 'host'
          ? service.host({ project: project(), transport: 'remote' })
          : service.join({
              invite: invite({ transport: 'dht', publicKey: 'b'.repeat(64), key: 'a'.repeat(48) }),
            });
      const rejected = assert.rejects(pending, { message: ERRORS.closed });
      await eventually(() => service.state().phase === 'network');
      assert.equal(service.state().mode, 'connecting');
      assert.equal(service.state().invite, undefined);
      await service.leave();
      await rejected;
      assert.equal(service.state().mode, 'disconnected');
      assert.equal(service.state().phase, undefined);
      assert.ok(nodes.every((node) => node.destroyed));
    }
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const state = await service.host({ project: project(), transport: 'lan', port });
    assert.equal(state.mode, 'hosting');
    assert.ok(state.invite.startsWith('freecut1:'));
    assert.equal(state.transport, 'lan');
  } finally {
    await service.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test(
  'a nonexistent peer invitation fails without keeping its DHT node alive',
  { timeout: 15000 },
  async () => {
    await fixture(async ({ transport, nodes }) => {
      const remote = transport({ timeouts: { network: 3000, bootstrap: 3000, connect: 2000 } });
      await assert.rejects(remote.join({ publicKey: DHT.keyPair().publicKey.toString('hex') }), {
        message: ERRORS.connect,
      });
      assert.ok(nodes.every((node) => node.destroyed));
      await remote.close();
    });
  },
);

test(
  'native loading is deferred and a broken P2P addon cannot prevent ordinary LAN editing',
  { timeout: 15000 },
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-native-missing-'));
    const source = `
    const assert = require('node:assert/strict');
    const net = require('node:net');
    const Module = require('node:module');
    const load = Module._load;
    let attempts = 0;
    Module._load = function (id, ...rest) {
      if (id === 'hyperdht') { attempts++; throw Error('Simulated missing native addon'); }
      return Reflect.apply(load, this, [id, ...rest]);
    };
    const { createCollaborationService } = require(${JSON.stringify(path.join(__dirname, 'collaboration.cjs'))});
    assert.equal(attempts, 0);
    const service = createCollaborationService({userData:${JSON.stringify(directory)},resolveAsset:()=>null,importPath:async()=>{}});
    (async () => {
      const probe = net.createServer();
      await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
      const port = probe.address().port;
      await new Promise(resolve => probe.close(resolve));
      const state = await service.host({project:${JSON.stringify(project())},transport:'lan',port});
      assert.equal(state.mode, 'hosting'); assert.equal(attempts, 0);
      await service.leave();
      await assert.rejects(service.host({project:${JSON.stringify(project())},transport:'remote'}), /Internet collaboration is unavailable in this installation/);
      assert.equal(attempts, 1); assert.equal(service.state().mode, 'disconnected');
      await service.dispose();
    })().catch(error => { console.error(error); process.exitCode=1; });
  `;
    try {
      await promisify(execFile)(process.execPath, ['-e', source], {
        timeout: 10000,
        windowsHide: true,
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

test('cancellation remains bounded when a failed interface has stalled native teardown', async () => {
  let teardownStarted = false;
  const node = fakeNode({
    ping: async () => {
      throw Error('Offline interface');
    },
    destroy: () => {
      teardownStarted = true;
      return new Promise(() => {});
    },
  });
  const remote = createRemoteTransport({
    candidates: ['127.0.0.1'],
    bootstrap: [{ host: '127.0.0.1', port: 9 }],
    createNode: () => node,
    timeouts: { close: 50 },
  });
  const pending = remote.host({ targetPort: 12345 });
  const rejected = assert.rejects(pending, { message: ERRORS.closed });
  await eventually(() => teardownStarted);
  const start = Date.now();
  await remote.close();
  await rejected;
  assert.ok(Date.now() - start < 1000, 'Cancellation waited for stalled native cleanup');
});
