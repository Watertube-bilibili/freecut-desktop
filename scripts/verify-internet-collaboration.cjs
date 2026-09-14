'use strict';
// Optional two-machine verification of the production room service. Generated
// WAV media only; no project or asset from a user's library is ever opened.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createCollaborationService } = require('../electron/collaboration.cjs');
const output = path.resolve(process.env.FREECUT_NETWORK_QA_OUTPUT || '.cache/internet-link');
const mode = process.argv[2];
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await check(); if (value) return value; await pause(100); }
  throw Error(label);
}
function wav(seconds, frequency) {
  const count = 16000 * seconds, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i * frequency * 2 * Math.PI / 16000) * 1500), 44 + i * 2);
  return bytes;
}
const hostMedia = wav(40, 440), guestMedia = wav(30, 660);
const initial = () => ({ version: 1, id: 'internet-qa', name: 'Generated Internet collaboration test',
  width: 1280, height: 720, fps: 30, background: '#101010', assets: [], clips: [],
  tracks: [{ id: 'audio', name: 'Audio', kind: 'audio', hidden: false, muted: false, locked: false }] });
async function main() {
  assert(['host', 'join'].includes(mode));
  await fs.mkdir(output, { recursive: true });
  const runDirectory = await fs.mkdtemp(path.join(output, `${mode}-room-`));
  const report = { mode, platform: process.platform, arch: process.arch, started: new Date().toISOString(), passed: false };
  const grants = new Map(), events = [];
  const importPath = async file => {
    const canonical = await fs.realpath(file);
    if (!grants.has(canonical)) {
      const bytes = await fs.readFile(canonical);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      grants.set(canonical, { id: crypto.randomUUID(), name: path.basename(canonical), kind: 'audio',
        duration: (bytes.length - 44) / 32000, path: canonical, url: `freecut-media://asset/${crypto.randomUUID()}` });
    }
    return grants.get(canonical);
  };
  let lastPhase;
  const service = createCollaborationService({ userData: runDirectory, importPath,
    resolveAsset: asset => [...grants.values()].find(item => item.id === asset.id || item.path === asset.path),
    emitProject: event => events.push(event),
    emitState: state => {
      const phase = `${state.mode}/${state.phase || ''}`;
      if (phase !== lastPhase) { lastPhase = phase; console.log(`${new Date().toISOString()} ${phase}`); }
    },
  });
  // The process deadline also bounds unexpected native cleanup regressions.
  const guard = setTimeout(() => { console.error('Internet room test exceeded its process deadline'); process.exit(1); }, mode === 'host' ? 16 * 60000 : 4 * 60000);
  try {
    if (mode === 'host') {
      const source = path.join(runDirectory, 'host-generated.wav'); await fs.writeFile(source, hostMedia);
      const project = initial(); project.assets.push(await importPath(source));
      const state = await service.host({ project, transport: 'remote', name: 'Synthetic QA host' });
      assert.equal(state.mode, 'hosting'); assert.match(state.invite, /^freecut2:/);
      await fs.writeFile(path.join(output, 'connection.json'), JSON.stringify({ invite: state.invite }));
      console.log('Internet room ready; invitation saved only to the local test file.');
      const edited = await until(() => events.find(event => event.project.name === 'Edited on another machine'), 15 * 60000, 'No remote edit received');
      assert.equal(edited.project.assets.length, 2);
      const incoming = edited.project.assets.find(asset => asset.name === 'guest-generated.wav');
      assert(incoming); assert.equal(digest(await fs.readFile(incoming.path)), digest(guestMedia));
      const updated = structuredClone(edited.project); updated.background = '#123456';
      const result = await service.publish({ project: updated, baseRevision: edited.revision }); assert.equal(result.ok, true);
      await until(() => events.find(event => event.project.name === 'Remote change verified'), 60000, 'No guest acknowledgement received');
      report.uploadBytes = hostMedia.length; report.downloadBytes = guestMedia.length;
      // Give the final HTTP response time to reach the guest before teardown.
      await pause(2000);
    } else {
      const invite = process.env.FREECUT_NETWORK_QA_PEER;
      assert.match(invite || '', /^freecut2:/);
      const start = Date.now();
      const event = await service.join({ invite, name: 'Synthetic QA guest' });
      report.joinMilliseconds = Date.now() - start;
      assert.equal(event.project.assets.length, 1);
      const downloaded = event.project.assets[0].path;
      assert.equal(digest(await fs.readFile(downloaded)), digest(hostMedia));
      const source = path.join(runDirectory, 'guest-generated.wav'); await fs.writeFile(source, guestMedia);
      const edited = structuredClone(event.project); edited.assets.push(await importPath(source)); edited.name = 'Edited on another machine';
      const result = await service.publish({ project: edited, baseRevision: event.revision }); assert.equal(result.ok, true);
      const incoming = await until(() => events.find(item => item.project.background === '#123456'), 60000, 'Host change did not synchronize');
      const acknowledged = structuredClone(incoming.project); acknowledged.name = 'Remote change verified';
      assert.equal((await service.publish({ project: acknowledged, baseRevision: incoming.revision })).ok, true);
      await service.leave(); assert.equal(digest(await fs.readFile(downloaded)), digest(hostMedia));
      report.uploadBytes = guestMedia.length; report.downloadBytes = hostMedia.length;
      report.totalMilliseconds = Date.now() - start;
    }
    report.mediaHashesVerified = true; report.bidirectionalEdits = true; report.passed = true;
  } catch (error) { report.error = error.message; throw error; }
  finally {
    await fs.writeFile(path.join(output, `${mode}-room-report.json`), JSON.stringify(report, null, 2));
    await service.dispose(); clearTimeout(guard);
  }
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
