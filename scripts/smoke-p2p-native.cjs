'use strict';
// Launch the real Electron main process, optionally the packaged executable.
// Both peers and bootstrap nodes are local, with a fresh disposable profile.
// No public DHT, user files, real room keys or network configuration are used.
const { _electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('Packaged native verification exceeded its time limit')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'freecut-native-smoke-'),
  );
  const executablePath = process.env.FREECUT_EXECUTABLE || process.env.FREECUT_TEST_EXE;
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  delete env.PORTABLE_EXECUTABLE_FILE;
  delete env.NODE_PATH;
  const report = { directory, packagedRequested: Boolean(executablePath), passed: false };
  let application;
  try {
    application = await _electron.launch({
      executablePath,
      args: [...(executablePath ? [] : [root]), `--user-data-dir=${directory}`],
      cwd: directory,
      env,
      timeout: 60000,
    });
    const verification = application.evaluate(async ({ app, dialog }, packagedRequested) => {
      const require = process
        .getBuiltinModule('node:module')
        .createRequire(`${app.getAppPath()}/package.json`);
      const path = require('node:path');
      const fs = require('node:fs/promises');
      const http = require('node:http');
      const crypto = require('node:crypto');
      const assert = require('node:assert/strict');
      const requireApp = require('node:module').createRequire(
        path.join(app.getAppPath(), 'package.json'),
      );
      if (packagedRequested)
        assert.equal(app.isPackaged, true, 'Expected the actual packaged application');
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      const loaded = {};
      for (const dependency of ['hyperdht', 'udx-native', 'sodium-native']) {
        const resolved = requireApp.resolve(dependency);
        assert.ok(
          resolved.startsWith(app.getAppPath() + path.sep),
          `Loaded ${dependency} outside the application`,
        );
        loaded[dependency] = requireApp(`${dependency}/package.json`).version;
      }
      const nativeFiles = [];
      if (app.isPackaged) {
        for (const dependency of ['udx-native', 'sodium-native']) {
          const folder = path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            dependency,
            'prebuilds',
            `${process.platform}-${process.arch}`,
          );
          const files = (await fs.readdir(folder)).filter((file) => file.endsWith('.node'));
          assert.ok(files.length, `${dependency} has no unpacked native addon for this platform`);
          for (const file of files) {
            const target = path.join(folder, file);
            assert.ok((await fs.stat(target)).size > 0);
            nativeFiles.push(path.relative(process.resourcesPath, target));
          }
        }
      }
      const DHT = requireApp('hyperdht');
      const createTestnet = requireApp('hyperdht/testnet');
      const { createRemoteTransport } = requireApp('./electron/collaboration-remote.cjs');
      const testnet = await createTestnet(5);
      const peers = [],
        nodes = [];
      const phases = [];
      const peer = () => {
        const value = createRemoteTransport({
          candidates: ['127.0.0.1'],
          bootstrap: testnet.bootstrap,
          timeouts: { network: 5000, bootstrap: 5000, announce: 10000, connect: 10000 },
          onPhase: (phase) => phases.push(phase),
          createNode: (options) => {
            const node = new DHT({
              ...options,
              ephemeral: true,
              firewalled: false,
              port: crypto.randomInt(20000, 60000),
            });
            nodes.push(node);
            return node;
          },
        });
        peers.push(value);
        return value;
      };
      const payload = crypto.randomBytes(3 * 1024 * 1024);
      const listener = http.createServer((req, res) => {
        assert.equal(req.socket.localAddress, '127.0.0.1');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', Connection: 'close' });
        req.pipe(res);
      });
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      try {
        const host = peer(),
          guest = peer();
        const room = await host.host({ targetPort: listener.address().port });
        const target = await guest.join(room);
        const received = await new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: target.host,
              port: target.port,
              path: '/',
              method: 'POST',
              headers: { 'Content-Length': payload.length },
            },
            (response) => {
              const chunks = [];
              assert.equal(response.statusCode, 200);
              response.on('data', (chunk) => chunks.push(chunk));
              response.on('error', reject);
              response.on('end', () => resolve(Buffer.concat(chunks)));
            },
          );
          req.on('error', reject);
          req.setTimeout(15000, () =>
            req.destroy(Error('Packaged native HTTP transfer timed out')),
          );
          req.end(payload);
        });
        assert.deepEqual(received, payload, 'Encrypted HTTP payload was truncated or corrupted');
        await Promise.all(peers.map((value) => value.close()));
        assert.ok(
          nodes.every((node) => node.destroyed),
          'Peer nodes were not destroyed',
        );
        assert.equal(phases.filter((value) => value === 'ready').length, 2);
        return {
          packaged: app.isPackaged,
          electron: process.versions.electron,
          node: process.versions.node,
          napi: process.versions.napi,
          platform: process.platform,
          arch: process.arch,
          loaded,
          nativeFiles,
          transferredEachDirection: payload.length,
          hash: crypto.createHash('sha256').update(received).digest('hex'),
          peersClosed: true,
          phases,
        };
      } finally {
        await Promise.allSettled(peers.map((value) => value.close()));
        listener.closeAllConnections();
        await new Promise((resolve) => listener.close(resolve));
        await testnet.destroy();
      }
    }, Boolean(executablePath));
    report.result = await bounded(verification, 60000);
    assert.equal(report.result.transferredEachDirection, 3 * 1024 * 1024);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || error.message;
    process.exitCode = 1;
  } finally {
    await application?.close().catch(() => {});
    const target = path.join(directory, 'native-report.json');
    await fs.writeFile(target, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ report: target, ...report }));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
