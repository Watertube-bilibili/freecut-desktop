'use strict';
// Rooms open only through host(). Remote rooms carry loopback HTTP over Noise;
// explicit LAN rooms use direct HTTP for trusted networks.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  LIMITS,
  ID,
  canonicalProject,
  validateManifest,
  address,
  mergeProjects,
} = require('./collaboration-protocol.cjs');
const { MEDIA_EXTENSIONS } = require('./media.cjs');
// Ordinary editing and LAN rooms must keep working even if a damaged install
// is missing a platform-specific P2P native addon. Load it only on explicit use.
function createRemoteTransport(options) {
  let remote;
  try {
    remote = require('./collaboration-remote.cjs');
  } catch {
    throw Error(
      'Internet collaboration is unavailable in this installation. Reinstall the latest version to restore it.',
    );
  }
  return remote.createRemoteTransport(options);
}
const clone = (value) => structuredClone(value);
const nameOf = (value) =>
  (typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 40)
    : '') || 'Editor';
const fileKey = (entry) => `${entry.hash}${entry.ext}`;
function localAddresses() {
  const rank = (ip) =>
    /^192\.168\./.test(ip)
      ? 0
      : /^10\./.test(ip)
        ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
          ? 2
          : /^198\.(18|19)\./.test(ip)
            ? 5
            : /^169\.254\./.test(ip)
              ? 6
              : 3;
  const addresses = [
    ...new Set(
      Object.values(os.networkInterfaces())
        .flat()
        .filter((item) => item?.family === 'IPv4' && !item.internal)
        .map((item) => item.address),
    ),
  ];
  // VPN/proxy adapters may appear first in Windows' inventory. Prefer an
  // ordinary LAN address for the invitation; retain all addresses for manual use.
  return [...addresses.sort((a, b) => rank(a) - rank(b)), '127.0.0.1'];
}
function json(response, status, data) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Connection: response.req?.headers.connection === 'keep-alive' ? 'keep-alive' : 'close',
  });
  response.end(JSON.stringify(data));
}
async function readJSON(stream, maximum = LIMITS.project + 131072) {
  const advertised = Number(stream.headers['content-length']);
  if (advertised > maximum) throw Error('Request exceeds the size limit.');
  let size = 0;
  const chunks = [];
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maximum) throw Error('Request exceeds the size limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Error('Invalid JSON request.');
  }
}
function createCollaborationStorage(userData) {
  let anchor;
  const comparable = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  return async () => {
    // System profile parents may legitimately be aliases (/var on macOS,
    // runner Temp paths or differently cased drive letters on Windows).
    // Resolve that trusted parent first, then inspect our own child directly.
    await fsp.mkdir(userData, { recursive: true });
    const canonical = await fsp.realpath(userData);
    if (anchor && comparable(anchor) !== comparable(canonical))
      throw Error('Collaboration profile location changed.');
    anchor ??= canonical;
    const requested = path.join(anchor, 'collaboration');
    try {
      await fsp.mkdir(requested);
    } catch (failure) {
      if (failure.code !== 'EEXIST') throw failure;
    }
    const entry = await fsp.lstat(requested);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw Error('Collaboration storage must not be a symbolic link.');
    const root = await fsp.realpath(requested);
    const parent = await fsp.realpath(path.dirname(root));
    if (comparable(parent) !== comparable(anchor))
      throw Error('Collaboration storage is outside its profile.');
    return root;
  };
}
function createCollaborationService({
  userData,
  resolveAsset,
  importPath,
  emitState = () => {},
  emitProject = () => {},
  remoteFactory = createRemoteTransport,
}) {
  const storage = createCollaborationStorage(userData);
  let mode = 'disconnected',
    peerId = crypto.randomUUID(),
    revision = 0,
    sequence = 0;
  let port = 45823,
    key,
    endpoint,
    server,
    snapshot,
    stopped = false,
    remoteJoined = false,
    generation = 0;
  let transport = 'lan',
    phase,
    remoteTransport,
    remotePublicKey,
    remoteAgent;
  let name = 'Editor',
    message = '',
    error,
    transferring = false,
    pollTask,
    cleanup,
    serial = Promise.resolve();
  const peers = new Map(),
    history = new Map(),
    cache = new Map(),
    preparedFiles = new Map(),
    pending = new Map();
  const roomFiles = new Set();
  const activePeers = new Map();
  const polls = new Map(),
    requests = new Set(),
    streams = new Set(),
    sockets = new Set();
  let transferCount = 0,
    storedBytes = 0;
  const state = () => ({
    mode,
    transport,
    ...(phase ? { phase } : {}),
    peerId,
    revision,
    addresses:
      transport === 'remote'
        ? []
        : mode === 'hosting'
          ? localAddresses()
          : endpoint
            ? [endpoint.host]
            : [],
    port: transport === 'remote' ? 0 : port,
    peers: [...peers.values()].map(({ id, name: peerName }) => ({ id, name: peerName })),
    ...(mode === 'hosting'
      ? {
          key,
          invite:
            transport === 'remote'
              ? `freecut2:${Buffer.from(JSON.stringify({ transport: 'dht', publicKey: remotePublicKey, key })).toString('base64url')}`
              : `freecut1:${Buffer.from(JSON.stringify({ host: localAddresses()[0], port, key })).toString('base64url')}`,
        }
      : {}),
    message,
    ...(error ? { error } : {}),
    transferring,
  });
  function update(patch = {}) {
    if (Object.hasOwn(patch, 'message')) message = patch.message;
    if (Object.hasOwn(patch, 'error')) error = patch.error;
    if (Object.hasOwn(patch, 'transferring')) transferring = patch.transferring;
    emitState(state());
  }
  function remoteFor(activeGeneration) {
    return remoteFactory({
      onPhase(value) {
        if (generation !== activeGeneration) return;
        phase = value;
        const messages = {
          network: 'Checking internet connectivity…',
          announcing: 'Publishing encrypted room invitation…',
          connecting: 'Connecting to the encrypted room…',
        };
        update(messages[value] ? { message: messages[value] } : {});
      },
    });
  }
  const exclusive = (action) => {
    const next = serial.then(action, action);
    serial = next.catch(() => {});
    return next;
  };
  function envelope() {
    return { ...snapshot, peers: state().peers, sequence };
  }
  function metadata() {
    return { revision, peers: state().peers, sequence };
  }
  async function withPeerTransfer(id, action) {
    activePeers.set(id, (activePeers.get(id) || 0) + 1);
    try {
      return await action();
    } finally {
      activePeers.set(id, (activePeers.get(id) || 1) - 1);
      if (!activePeers.get(id)) activePeers.delete(id);
      if (peers.has(id)) peers.get(id).seen = Date.now();
    }
  }
  function wake() {
    sequence++;
    for (const [id, wait] of polls) {
      clearTimeout(wait.timer);
      polls.delete(id);
      json(wait.response, 200, envelope());
    }
    update();
  }
  async function storeStream(input, entry, expectedHash, activeGeneration) {
    if (transferCount >= LIMITS.transfers) throw Error('Too many simultaneous media transfers.');
    if (storedBytes + entry.size > LIMITS.room)
      throw Error('This room has reached its 32 GB media limit.');
    const root = await storage();
    const disk = await fsp.statfs(root);
    if (generation !== activeGeneration) throw Error('Collaboration was closed.');
    if (disk.bavail * disk.bsize < entry.size + 256 * 1024 ** 2)
      throw Error('Not enough free disk space for shared media (256 MB reserve required).');
    if (storedBytes + entry.size > LIMITS.room || transferCount >= LIMITS.transfers)
      throw Error('The room media transfer limit was reached.');
    const temporary = path.join(root, `.incoming-${crypto.randomUUID()}`);
    let bytes = 0;
    const hash = crypto.createHash('sha256');
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > entry.size || bytes > LIMITS.asset || generation !== activeGeneration)
          return callback(Error('Media transfer was cancelled or exceeds its limit.'));
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    transferCount++;
    storedBytes += entry.size; // Reserve quota before accepting simultaneous uploads.
    streams.add(input);
    try {
      await pipeline(input, meter, fs.createWriteStream(temporary, { flags: 'wx' }));
      const digest = hash.digest('hex');
      if (bytes !== entry.size || (expectedHash && digest !== expectedHash))
        throw Error('Media download failed integrity verification.');
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      const result = { ...entry, hash: digest };
      const destination = path.join(root, fileKey(result));
      // Reusing an existing content-addressed cache also verifies its contents:
      // the freshly streamed file replaces it, never trusting a stale filename.
      await fsp.rename(temporary, destination).catch(async (failure) => {
        if (failure.code !== 'EEXIST' && failure.code !== 'EPERM') throw failure;
        const present = await fsp.lstat(destination);
        if (!present.isFile() || present.isSymbolicLink())
          throw Error('Invalid collaboration cache file.');
        await fsp.rm(destination);
        await fsp.rename(temporary, destination);
      });
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      if (cache.has(fileKey(result))) storedBytes -= entry.size;
      cache.set(fileKey(result), { ...result, path: destination });
      roomFiles.add(fileKey(result));
      return result;
    } catch (failure) {
      storedBytes -= entry.size;
      throw failure;
    } finally {
      transferCount--;
      streams.delete(input);
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }
  async function prepare(project, activeGeneration) {
    const wire = canonicalProject(project);
    const media = [];
    for (const asset of project.assets) {
      if (asset.missing) continue;
      // Never accept renderer or peer paths without the existing import grant.
      const authorized = resolveAsset(asset);
      if (!authorized?.path) throw Error('Import missing media before sharing this project.');
      const stat = await fsp.stat(authorized.path);
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      const ext = path.extname(authorized.path).toLowerCase();
      if (
        !stat.isFile() ||
        !MEDIA_EXTENSIONS.has(ext) ||
        stat.size <= 0 ||
        stat.size > LIMITS.asset
      )
        throw Error('Shared media must be a supported file no larger than 8 GB.');
      const fingerprint = `${authorized.path}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`;
      let item = preparedFiles.get(fingerprint);
      if (!item || !cache.has(fileKey(item))) {
        item = await storeStream(
          fs.createReadStream(authorized.path),
          { size: stat.size, ext },
          null,
          activeGeneration,
        );
        preparedFiles.set(fingerprint, item);
      }
      media.push({ id: asset.id, hash: item.hash, size: item.size, ext: item.ext });
      roomFiles.add(fileKey(item));
    }
    validateManifest(wire, media);
    return { project: wire, media };
  }
  async function materialize(value, activeGeneration) {
    const project = canonicalProject(value.project, true);
    const manifest = validateManifest(project, value.media);
    for (const entry of manifest) {
      let record = cache.get(fileKey(entry));
      if (!record || !roomFiles.has(fileKey(entry))) {
        const response = await request('GET', `/v1/media/${fileKey(entry)}`);
        if (Number(response.headers['content-length']) !== entry.size) {
          response.destroy();
          throw Error('Unexpected shared media length.');
        }
        await storeStream(response, entry, entry.hash, activeGeneration);
        record = cache.get(fileKey(entry));
      }
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      const restored = await importPath(record.path);
      const stat = await fsp.stat(record.path);
      preparedFiles.set(`${record.path}\0${stat.size}\0${stat.mtimeMs}\0${stat.ctimeMs}`, record);
      const asset = project.assets.find((item) => item.id === entry.id);
      Object.assign(asset, restored, { id: asset.id, name: asset.name, missing: false });
      if (restored.kind === 'audio') {
        delete asset.width;
        delete asset.height;
        for (const clip of project.clips)
          if (clip.assetId === asset.id && clip.kind === 'video') clip.kind = 'audio';
      }
    }
    return project;
  }
  function request(method, route, body) {
    const target = endpoint;
    const currentGeneration = generation;
    if (!target) return Promise.reject(Error('Not connected.'));
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          host: target.host,
          port: target.port,
          path: route,
          method,
          agent: remoteAgent || false,
          headers: {
            Authorization: `Bearer ${target.key}`,
            'X-FreeCut-Peer': peerId,
            ...(bytes
              ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length }
              : {}),
          },
        },
        (response) => {
          response.setTimeout(30000, () => response.destroy(Error('Media transfer timed out.')));
          if (generation !== currentGeneration) {
            response.destroy();
            reject(Error('Collaboration was closed.'));
            return;
          }
          if (response.statusCode !== 200) {
            void readJSON(response, 4096).then(
              (data) =>
                reject(Error(data.error || `Host rejected the request (${response.statusCode}).`)),
              () => reject(Error(`Host rejected the request (${response.statusCode}).`)),
            );
            return;
          }
          resolve(response);
        },
      );
      requests.add(req);
      req.setTimeout(30000, () => req.destroy(Error('The host did not respond.')));
      req.on('error', reject);
      req.on('close', () => requests.delete(req));
      req.end(bytes);
    });
  }
  const requestJSON = async (method, route, body) => readJSON(await request(method, route, body));
  async function upload(entry, activeGeneration) {
    const target = endpoint;
    const record = cache.get(fileKey(entry));
    if (!target || !record) throw Error('Shared media is unavailable.');
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: target.host,
          port: target.port,
          path: `/v1/media/${fileKey(entry)}`,
          method: 'PUT',
          agent: remoteAgent || false,
          headers: {
            Authorization: `Bearer ${target.key}`,
            'X-FreeCut-Peer': peerId,
            'Content-Length': entry.size,
            'Content-Type': 'application/octet-stream',
          },
        },
        (response) => {
          void readJSON(response, 4096).then((data) => {
            if (response.statusCode === 200 && generation === activeGeneration) resolve();
            else reject(Error(data.error || 'Media upload failed.'));
          }, reject);
        },
      );
      requests.add(req);
      req.setTimeout(30000, () => req.destroy(Error('Media upload timed out.')));
      req.on('error', reject);
      req.on('close', () => requests.delete(req));
      const input = fs.createReadStream(record.path);
      streams.add(input);
      void pipeline(input, req)
        .catch(reject)
        .finally(() => streams.delete(input));
    });
  }
  async function accept(value, originId, activeGeneration) {
    const incoming = { project: canonicalProject(value.project, true), media: value.media };
    validateManifest(incoming.project, incoming.media);
    if (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0)
      throw Error('Invalid base revision.');
    const base = history.get(value.baseRevision);
    if (!base) return { ok: false, ...envelope(), conflicts: ['history-expired'] };
    const merged = mergeProjects(
      { project: base.project, media: base.media },
      { project: snapshot.project, media: snapshot.media },
      incoming,
    );
    if (merged.conflicts.length) return { ok: false, ...envelope(), conflicts: merged.conflicts };
    try {
      canonicalProject(merged.project.project, true);
      validateManifest(merged.project.project, merged.project.media);
    } catch {
      return { ok: false, ...envelope(), conflicts: ['project.references'] };
    }
    for (const item of merged.project.media) {
      const record = cache.get(fileKey(item));
      if (!record || !roomFiles.has(fileKey(item)) || record.size !== item.size)
        throw Error('Upload the shared media before publishing.');
    }
    const project = await materialize(merged.project, activeGeneration);
    if (generation !== activeGeneration) throw Error('Collaboration was closed.');
    revision++;
    snapshot = { ...merged.project, revision, originId };
    history.set(revision, clone(snapshot));
    while (history.size > LIMITS.history) history.delete(history.keys().next().value);
    emitProject({ project, revision, originId });
    wake();
    return { ok: true, ...envelope() };
  }
  function authorized(request) {
    if (request.headers.origin !== undefined || request.headers['sec-fetch-site'] !== undefined)
      return false;
    const expected = Buffer.from(`Bearer ${key}`);
    const actual = Buffer.from(
      typeof request.headers.authorization === 'string' ? request.headers.authorization : '',
    );
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  async function serve(req, response) {
    if (!authorized(req)) {
      json(response, 403, { error: 'Invalid room key or browser request.' });
      req.resume();
      return;
    }
    const activeGeneration = generation;
    const route = req.url;
    if (req.method === 'POST' && route === '/v1/join') {
      if (peers.size >= LIMITS.peers) {
        json(response, 429, { error: 'This room already has 8 editors.' });
        req.resume();
        return;
      }
      const data = await readJSON(req, 512);
      if (peers.size >= LIMITS.peers) {
        json(response, 429, { error: 'This room already has 8 editors.' });
        return;
      }
      const id = crypto.randomUUID();
      peers.set(id, { id, name: nameOf(data.name), seen: Date.now() });
      wake();
      json(response, 200, { ...envelope(), peerId: id });
      return;
    }
    const id = req.headers['x-freecut-peer'];
    if (typeof id !== 'string' || !ID.test(id) || !peers.has(id) || id === peerId) {
      json(response, 403, { error: 'Join the room before accessing its project.' });
      req.resume();
      return;
    }
    peers.get(id).seen = Date.now();
    if (req.method === 'POST' && route === '/v1/leave') {
      peers.delete(id);
      pending.delete(id);
      if (polls.has(id)) {
        clearTimeout(polls.get(id).timer);
        json(polls.get(id).response, 410, { error: 'You left the room.' });
        polls.delete(id);
      }
      wake();
      json(response, 200, { ok: true });
      req.resume();
      return;
    }
    const poll = /^\/v1\/events\?since=(\d+)&sequence=(\d+)$/.exec(route);
    if (req.method === 'GET' && poll) {
      if (+poll[1] !== revision || +poll[2] !== sequence) {
        json(response, 200, envelope());
        return;
      }
      if (polls.has(id)) {
        json(response, 429, { error: 'Only one update stream is allowed per editor.' });
        return;
      }
      const timer = setTimeout(() => {
        polls.delete(id);
        json(response, 200, metadata());
      }, 15000);
      polls.set(id, { response, timer });
      response.once('close', () => {
        if (polls.get(id)?.response === response) {
          clearTimeout(timer);
          polls.delete(id);
        }
      });
      return;
    }
    if (req.method === 'POST' && route === '/v1/prepare') {
      await withPeerTransfer(id, async () => {
        const value = await readJSON(req);
        const project = canonicalProject(value.project, true);
        const manifest = validateManifest(project, value.media);
        pending.set(id, { media: manifest, expires: Date.now() + 2 * 60 * 60 * 1000 });
        json(response, 200, {
          missing: manifest.filter((entry) => !roomFiles.has(fileKey(entry))).map(fileKey),
        });
      });
      return;
    }
    const asset = /^\/v1\/media\/([a-f0-9]{64})(\.[a-z0-9]{2,5})$/.exec(route);
    if (asset && req.method === 'PUT') {
      const entry =
        pending.get(id)?.expires > Date.now() &&
        pending.get(id).media.find((entry) => fileKey(entry) === asset[1] + asset[2]);
      if (!entry || Number(req.headers['content-length']) !== entry.size) {
        json(response, 403, { error: 'Media was not declared in the shared project.' });
        req.resume();
        return;
      }
      if (roomFiles.has(fileKey(entry))) {
        req.resume();
        json(response, 200, { ok: true });
        return;
      }
      await withPeerTransfer(id, () => storeStream(req, entry, entry.hash, activeGeneration));
      json(response, 200, { ok: true });
      return;
    }
    if (asset && req.method === 'GET') {
      const record = cache.get(asset[1] + asset[2]);
      const shared =
        record &&
        [...history.values()].some((value) =>
          value.media.some((entry) => fileKey(entry) === asset[1] + asset[2]),
        );
      if (!shared) {
        json(response, 404, { error: 'Media is not shared by this project.' });
        return;
      }
      if (transferCount >= LIMITS.transfers) {
        json(response, 429, { error: 'Too many simultaneous media transfers.' });
        return;
      }
      if ((await fsp.realpath(record.path)) !== record.path) throw Error('Shared media changed.');
      if (transferCount >= LIMITS.transfers) {
        json(response, 429, { error: 'Too many simultaneous media transfers.' });
        return;
      }
      const input = fs.createReadStream(record.path);
      streams.add(input);
      transferCount++;
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': record.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      try {
        await withPeerTransfer(id, () => pipeline(input, response));
      } finally {
        streams.delete(input);
        transferCount--;
      }
      return;
    }
    if (req.method === 'POST' && route === '/v1/publish') {
      await withPeerTransfer(id, async () => {
        const value = await readJSON(req);
        const result = await exclusive(() => accept(value, id, activeGeneration));
        json(response, 200, result);
      });
      return;
    }
    req.resume();
    json(response, 404, { error: 'Unknown collaboration endpoint.' });
  }
  async function leave() {
    const wasJoined = remoteJoined;
    remoteJoined = false;
    // Invalidate the old poll before its 410 response can race this explicit
    // departure and incorrectly report a connection failure to the renderer.
    generation++;
    stopped = true;
    if (wasJoined && endpoint) {
      // Best effort leave; never keep application shutdown waiting for a peer.
      const notify = requestJSON('POST', '/v1/leave', {}).catch(() => {});
      await Promise.race([
        notify,
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 300);
          timer.unref();
        }),
      ]);
    }
    clearInterval(cleanup);
    cleanup = undefined;
    for (const wait of polls.values()) {
      clearTimeout(wait.timer);
      json(wait.response, 410, {
        error: 'The host closed this room. Your local project is retained.',
      });
    }
    polls.clear();
    for (const request of requests) request.destroy(Error('Collaboration was closed.'));
    for (const stream of streams) stream.destroy(Error('Collaboration was closed.'));
    const previous = server;
    server = null;
    if (previous) {
      previous.close();
      previous.closeAllConnections();
    }
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    remoteAgent?.destroy();
    remoteAgent = undefined;
    const previousRemote = remoteTransport;
    remoteTransport = undefined;
    remotePublicKey = undefined;
    phase = undefined;
    await previousRemote?.close();
    mode = 'disconnected';
    endpoint = undefined;
    key = undefined;
    snapshot = undefined;
    peers.clear();
    history.clear();
    pending.clear();
    roomFiles.clear();
    activePeers.clear();
    revision = 0;
    sequence = 0;
    update({
      message: 'Disconnected. Downloaded media remains available on this computer.',
      error: undefined,
      transferring: false,
    });
    return state();
  }
  async function host(options) {
    if (mode !== 'disconnected') throw Error('Leave the current room before opening another.');
    if (options.transport !== undefined && !['lan', 'remote'].includes(options.transport))
      throw Error('Invalid collaboration transport.');
    transport = options.transport || 'lan';
    const desiredPort = transport === 'remote' ? 0 : (options.port ?? 45823);
    if (
      transport === 'lan' &&
      (!Number.isInteger(desiredPort) || desiredPort < 1024 || desiredPort > 65535)
    )
      throw Error('Use a port between 1024 and 65535.');
    const activeGeneration = ++generation;
    stopped = false;
    mode = 'connecting';
    name = nameOf(options.name);
    peerId = crypto.randomUUID();
    port = desiredPort;
    update({ message: 'Preparing project media…', error: undefined, transferring: true });
    try {
      const prepared = await prepare(options.project, activeGeneration);
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      key = crypto.randomBytes(24).toString('hex');
      snapshot = { ...prepared, revision: 0, originId: peerId };
      history.set(0, clone(snapshot));
      peers.set(peerId, { id: peerId, name });
      const listener = http.createServer(
        { maxHeaderSize: 8192, requestTimeout: 2 * 60 * 60 * 1000, headersTimeout: 10000 },
        (req, res) => {
          void serve(req, res).catch(() => {
            json(res, 400, { error: 'Invalid request or unavailable project media.' });
            req.resume();
          });
        },
      );
      listener.maxConnections = 24;
      listener.keepAliveTimeout = 60000;
      listener.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.setTimeout(60000, () => socket.destroy());
      });
      server = listener;
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(port, transport === 'remote' ? '127.0.0.1' : '0.0.0.0', resolve);
      });
      if (generation !== activeGeneration) {
        listener.close();
        throw Error('Collaboration was closed.');
      }
      port = listener.address().port;
      if (transport === 'remote') {
        remoteTransport = remoteFor(activeGeneration);
        const result = await remoteTransport.host({ targetPort: port });
        if (generation !== activeGeneration) throw Error('Collaboration was closed.');
        remotePublicKey = result.publicKey;
      }
      mode = 'hosting';
      cleanup = setInterval(() => {
        let changed = false;
        for (const [id, member] of peers)
          if (
            id !== peerId &&
            Date.now() - member.seen > 90000 &&
            !polls.has(id) &&
            !activePeers.has(id)
          ) {
            peers.delete(id);
            pending.delete(id);
            changed = true;
          }
        if (changed) wake();
      }, 30000);
      cleanup.unref();
      update({
        message:
          transport === 'remote'
            ? 'Encrypted room open. Share the invitation with your collaborators.'
            : 'Room open. Share the IP address, port, and key over a trusted connection.',
        transferring: false,
      });
      return state();
    } catch (failure) {
      const detail =
        failure.code === 'EADDRINUSE'
          ? 'This port is already in use. Choose another port.'
          : failure.message;
      if (generation === activeGeneration) {
        await leave();
        update({ error: detail });
      }
      throw Error(detail);
    }
  }
  function updatePeers(value) {
    if (
      !Array.isArray(value) ||
      value.length > LIMITS.peers ||
      value.some(
        (item) =>
          !item || !ID.test(item.id) || typeof item.name !== 'string' || item.name.length > 40,
      )
    )
      throw Error('Invalid room members.');
    peers.clear();
    for (const item of value) peers.set(item.id, { id: item.id, name: item.name });
  }
  async function receive(value, activeGeneration, force = false) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !ID.test(value.originId))
      throw Error('Invalid collaboration revision.');
    if (value.revision < revision && !force) return null;
    canonicalProject(value.project, true);
    validateManifest(value.project, value.media);
    const project = await materialize(value, activeGeneration);
    if (generation !== activeGeneration || (value.revision < revision && !force)) return null;
    revision = value.revision;
    sequence = value.sequence;
    snapshot = { project: value.project, media: value.media, revision, originId: value.originId };
    updatePeers(value.peers);
    update({ transferring: false });
    const event = { project, revision, originId: value.originId };
    emitProject(event);
    return event;
  }
  async function poll(activeGeneration) {
    try {
      while (!stopped && generation === activeGeneration && mode === 'joined') {
        const value = await requestJSON('GET', `/v1/events?since=${revision}&sequence=${sequence}`);
        if (generation !== activeGeneration) return;
        updatePeers(value.peers);
        if (value.revision > revision) await exclusive(() => receive(value, activeGeneration));
        sequence = Math.max(sequence, value.sequence || 0);
        update();
      }
    } catch (failure) {
      if (generation !== activeGeneration || stopped) return;
      await leave();
      update({
        error: failure.message,
        message: 'Connection lost. Your local project and downloaded media are retained.',
      });
    }
  }
  async function join(options) {
    if (mode !== 'disconnected') throw Error('Leave the current room before joining another.');
    const target = address(options);
    const activeGeneration = ++generation;
    stopped = false;
    mode = 'connecting';
    transport = target.transport === 'remote' ? 'remote' : 'lan';
    endpoint = transport === 'lan' ? target : undefined;
    port = target.port || 0;
    peerId = crypto.randomUUID();
    name = nameOf(options.name);
    update({
      message: 'Connecting and downloading project media…',
      error: undefined,
      transferring: true,
    });
    try {
      if (transport === 'remote') {
        remoteTransport = remoteFor(activeGeneration);
        const tunnel = await remoteTransport.join({ publicKey: target.publicKey });
        if (generation !== activeGeneration) throw Error('Collaboration was closed.');
        endpoint = { ...tunnel, key: target.key };
        remoteAgent = new http.Agent({
          keepAlive: true,
          maxSockets: 6,
          maxFreeSockets: 4,
          keepAliveMsecs: 15000,
        });
      }
      const value = await requestJSON('POST', '/v1/join', { name });
      if (!ID.test(value.peerId)) throw Error('Invalid room response.');
      peerId = value.peerId;
      remoteJoined = true;
      const event = await receive(value, activeGeneration, true);
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      mode = 'joined';
      update({ message: 'Connected. Edits synchronize with the host.', transferring: false });
      pollTask = poll(activeGeneration);
      return event;
    } catch (failure) {
      if (generation === activeGeneration) {
        await leave();
        update({ error: failure.message });
      }
      throw failure;
    }
  }
  async function publish(options) {
    if (mode !== 'hosting' && mode !== 'joined')
      throw Error('Open or join a room before sharing edits.');
    const activeGeneration = generation;
    return exclusive(async () => {
      if (generation !== activeGeneration) throw Error('Collaboration was closed.');
      update({ transferring: true, error: undefined });
      try {
        const prepared = await prepare(options.project, activeGeneration);
        let result;
        if (mode === 'hosting')
          result = await accept(
            { ...prepared, baseRevision: options.baseRevision },
            peerId,
            activeGeneration,
          );
        else {
          const check = await requestJSON('POST', '/v1/prepare', prepared);
          if (
            !Array.isArray(check.missing) ||
            check.missing.length > LIMITS.assets ||
            check.missing.some((key) => !prepared.media.some((entry) => fileKey(entry) === key))
          )
            throw Error('Invalid upload request from host.');
          for (const item of prepared.media)
            if (check.missing.includes(fileKey(item))) await upload(item, activeGeneration);
          result = await requestJSON('POST', '/v1/publish', {
            ...prepared,
            baseRevision: options.baseRevision,
          });
        }
        if (!result.ok) {
          const project = await materialize(result, activeGeneration);
          return {
            ok: false,
            project,
            revision: result.revision,
            conflicts: Array.isArray(result.conflicts)
              ? result.conflicts.slice(0, 64)
              : ['conflict'],
          };
        }
        const event =
          mode === 'hosting'
            ? {
                project: await materialize(result, activeGeneration),
                revision: result.revision,
                originId: result.originId,
              }
            : await receive(result, activeGeneration);
        return { ok: true, ...event };
      } finally {
        if (generation === activeGeneration) update({ transferring: false });
      }
    });
  }
  async function dispose() {
    await leave();
    await pollTask?.catch(() => {});
    await serial;
  }
  return { state, host, join, leave, publish, dispose };
}
module.exports = { createCollaborationService, createCollaborationStorage };
