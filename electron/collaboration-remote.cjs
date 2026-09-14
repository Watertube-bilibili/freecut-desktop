'use strict';
// Only a fixed loopback collaboration listener is carried through Noise. This
// is not a general TCP/HTTP proxy and never accepts a destination from a peer.
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const DHT = require('hyperdht');
const { BOOTSTRAP_NODES } = require('hyperdht/lib/constants');

// Use the IP hints shipped by the pinned upstream package. Some DNS proxies
// return synthetic 198.18/15 addresses, which cannot bootstrap the UDP DHT.
const BOOTSTRAP = Object.freeze(
  BOOTSTRAP_NODES.map((value) => {
    const [host, location] = value.split('@');
    return Object.freeze({ host, port: Number(location.slice(location.lastIndexOf(':') + 1)) });
  }),
);
const PUBLIC_KEY = /^[a-f0-9]{64}$/;
const ERRORS = Object.freeze({
  offline:
    'Could not reach the peer network. Check your internet connection or try another network.',
  announce: 'The room could not be published on the peer network. Try another network.',
  connect:
    'Could not reach this room. Check the invitation and ask the host to keep the room open. Some networks block direct connections.',
  closed: 'Collaboration was closed.',
});

function networkCandidates(interfaces = os.networkInterfaces()) {
  const rank = (ip) =>
    /^192\.168\./.test(ip)
      ? 0
      : /^10\./.test(ip)
        ? 1
        : /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
          ? 2
          : 3;
  const addresses = [
    ...new Set(
      Object.values(interfaces)
        .flat()
        .filter(
          (item) =>
            item?.family === 'IPv4' &&
            !item.internal &&
            net.isIP(item.address) === 4 &&
            !/^(?:0\.|127\.|169\.254\.|198\.(?:18|19)\.)/.test(item.address) &&
            Number(item.address.split('.')[0]) < 224,
        )
        .map((item) => item.address),
    ),
  ];
  return [...addresses.sort((a, b) => rank(a) - rank(b)).slice(0, 3), '0.0.0.0'];
}

function deadline(promise, milliseconds, failure, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      fn(value);
    };
    const aborted = () => finish(reject, Error(ERRORS.closed));
    const timer = setTimeout(() => finish(reject, Error(failure)), milliseconds);
    signal?.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
    if (signal?.aborted) aborted();
  });
}

function createRemoteTransport({
  onPhase = () => {},
  bootstrap = BOOTSTRAP,
  candidates,
  timeouts = {},
  createNode,
} = {}) {
  // The overrides are dependency injection for isolated local DHT tests. No IPC
  // or invitation can supply bootstrap nodes, a bind address, or a TCP target.
  const abort = new AbortController();
  const signal = abort.signal;
  const nodes = new Set(),
    streams = new Set(),
    tcpSockets = new Set();
  const destroyingNodes = new Map();
  const peerStreams = new Map();
  let node,
    listener,
    proxy,
    warmStream,
    closing,
    started = false;
  const check = () => {
    if (signal.aborted) throw Error(ERRORS.closed);
  };
  const phase = (value) => {
    check();
    onPhase(value);
  };
  const track = (stream, collection = streams) => {
    collection.add(stream);
    stream.on('error', () => {});
    stream.once('close', () => collection.delete(stream));
    return stream;
  };
  function destroyNode(current) {
    if (!destroyingNodes.has(current))
      destroyingNodes.set(
        current,
        Promise.resolve()
          .then(() => current.destroy({ force: true }))
          .catch(() => {}),
      );
    return destroyingNodes.get(current);
  }
  async function initialize() {
    if (started) throw Error('This peer transport has already been started.');
    started = true;
    phase('network');
    const until = Date.now() + (timeouts.totalNetwork || 30000);
    const budget = (stage) => Math.max(1, Math.min(stage, until - Date.now()));
    for (const host of candidates || networkCandidates()) {
      check();
      if (Date.now() >= until) break;
      const trial = createNode
        ? createNode({ host, bootstrap })
        : new DHT({
            host,
            bootstrap,
            ephemeral: true,
            port: crypto.randomInt(20000, 60000),
          });
      nodes.add(trial);
      trial.on('error', () => {});
      try {
        await deadline(trial.bind(), budget(timeouts.network || 6000), ERRORS.offline, signal);
        // fullyBootstrapped() can resolve with zero replies. Require an actual
        // DHT protocol response before selecting this interface.
        await deadline(
          Promise.any(bootstrap.map((address) => trial.ping(address))),
          budget(timeouts.network || 6000),
          ERRORS.offline,
          signal,
        );
        await deadline(
          trial.fullyBootstrapped(),
          budget(timeouts.bootstrap || 15000),
          ERRORS.offline,
          signal,
        );
        check();
        node = trial;
        return;
      } catch {
        // Native teardown must not defeat cancellation or the total budget.
        await deadline(destroyNode(trial), budget(2000), ERRORS.offline, signal).catch(() => {});
        nodes.delete(trial);
        check();
      }
    }
    throw Error(ERRORS.offline);
  }
  function bridge(left, right) {
    // The duplex bridge provides bounded backpressure, including multi-GB
    // media; neither direction buffers the whole request or file in memory.
    let leftEnded = false,
      leftFinished = false,
      rightEnded = false,
      rightFinished = false;
    const destroy = () => {
      left.destroy();
      right.destroy();
    };
    left.once('error', destroy);
    right.once('error', destroy);
    left.once('end', () => {
      leftEnded = true;
    });
    left.once('finish', () => {
      leftFinished = true;
    });
    right.once('end', () => {
      rightEnded = true;
    });
    right.once('finish', () => {
      rightFinished = true;
    });
    left.once('close', () => {
      if (!leftEnded || !leftFinished) right.destroy();
    });
    right.once('close', () => {
      if (!rightEnded || !rightFinished) left.destroy();
    });
    // streamx.pipe() treats a normal Node TCP half-close as a failed pipeline
    // and can destroy the other direction before its final media bytes drain.
    // Bridge each half explicitly while still honoring each write high-water mark.
    const pump = (source, target) => {
      source.on('data', (chunk) => {
        if (!target.write(chunk)) source.pause();
      });
      target.on('drain', () => source.resume());
      source.once('end', () => target.end());
    };
    pump(left, right);
    pump(right, left);
  }
  async function openStream(publicKey) {
    check();
    const stream = track(node.connect(publicKey));
    try {
      await deadline(
        new Promise((resolve, reject) => {
          stream.once('open', resolve);
          stream.once('error', reject);
          stream.once('close', () => reject(Error(ERRORS.connect)));
        }),
        timeouts.connect || 45000,
        ERRORS.connect,
        signal,
      );
      check();
      if (!stream.remotePublicKey?.equals(publicKey)) throw Error(ERRORS.connect);
      return stream;
    } catch (failure) {
      stream.destroy();
      throw Error(signal.aborted ? ERRORS.closed : ERRORS.connect);
    }
  }
  async function host({ targetPort }) {
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)
      throw Error('Invalid local collaboration listener.');
    try {
      await initialize();
      phase('announcing');
      listener = node.createServer(
        {
          firewall: (publicKey) =>
            signal.aborted ||
            streams.size >= 24 ||
            (peerStreams.get(publicKey.toString('hex')) || 0) >= 6,
        },
        (stream) => {
          if (signal.aborted || streams.size >= 24) {
            stream.destroy();
            return;
          }
          const id = stream.remotePublicKey?.toString('hex');
          if (!id || (peerStreams.get(id) || 0) >= 6) {
            stream.destroy();
            return;
          }
          peerStreams.set(id, (peerStreams.get(id) || 0) + 1);
          track(stream);
          stream.once('close', () => {
            const count = (peerStreams.get(id) || 1) - 1;
            if (count) peerStreams.set(id, count);
            else peerStreams.delete(id);
          });
          const socket = track(
            net.connect({ host: '127.0.0.1', port: targetPort, allowHalfOpen: true }),
            tcpSockets,
          );
          socket.setNoDelay(true);
          socket.setTimeout(60000, () => socket.destroy());
          bridge(stream, socket);
        },
      );
      listener.on('error', () => {});
      await deadline(
        listener.listen(DHT.keyPair()),
        timeouts.announce || 30000,
        ERRORS.announce,
        signal,
      );
      check();
      // hyperdht 6.34.0 has no documented server.nodes getter. Its announcer
      // records a relay only after an ANNOUNCE acknowledgement (error === 0).
      // relayAddresses alone may contain our own public address without an ACK.
      if (!listener._announcer?.relays?.length) throw Error(ERRORS.announce);
      phase('ready');
      return { publicKey: listener.publicKey.toString('hex') };
    } catch (failure) {
      await close();
      throw failure;
    }
  }
  async function join({ publicKey }) {
    if (typeof publicKey !== 'string' || !PUBLIC_KEY.test(publicKey))
      throw Error('Invalid invitation.');
    const remoteKey = Buffer.from(publicKey, 'hex');
    try {
      await initialize();
      phase('connecting');
      warmStream = await openStream(remoteKey);
      proxy = net.createServer({ allowHalfOpen: true }, (socket) => {
        if (signal.aborted || tcpSockets.size >= 6) {
          socket.destroy();
          return;
        }
        track(socket, tcpSockets);
        socket.setNoDelay(true);
        socket.setTimeout(60000, () => socket.destroy());
        socket.pause();
        const ready =
          warmStream && !warmStream.destroyed ? Promise.resolve(warmStream) : openStream(remoteKey);
        warmStream = null;
        void ready
          .then((stream) => {
            if (signal.aborted || socket.destroyed) {
              stream.destroy();
              socket.destroy();
              return;
            }
            bridge(socket, stream);
            socket.resume();
          })
          .catch(() => socket.destroy());
      });
      proxy.maxConnections = 6;
      await deadline(
        new Promise((resolve, reject) => {
          proxy.once('error', reject);
          proxy.listen(0, '127.0.0.1', resolve);
        }),
        5000,
        ERRORS.connect,
        signal,
      );
      check();
      phase('ready');
      return { host: '127.0.0.1', port: proxy.address().port };
    } catch (failure) {
      await close();
      throw failure;
    }
  }
  function close() {
    if (closing) return closing;
    abort.abort();
    closing = (async () => {
      if (proxy) proxy.close();
      for (const socket of tcpSockets) socket.destroy();
      for (const stream of streams) stream.destroy();
      // Start Server.close before forcing the node down. Doing only force=true
      // leaves an announcer waiting in the background on failed joins/announces.
      const ending = listener ? [listener.close().catch(() => {})] : [];
      for (const current of nodes) ending.push(destroyNode(current));
      ending.push(...destroyingNodes.values());
      await deadline(Promise.allSettled(ending), timeouts.close || 5000, ERRORS.closed).catch(
        () => {},
      );
      nodes.clear();
      peerStreams.clear();
      warmStream = null;
    })();
    return closing;
  }
  return { host, join, close };
}

module.exports = { createRemoteTransport, networkCandidates, BOOTSTRAP, ERRORS };
