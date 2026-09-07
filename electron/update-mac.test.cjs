'use strict';
// macOS CI executes real clang-built, ad-hoc signed .app bundles and the actual
// ditto/codesign/open/mv helper. No real FreeCut installation is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const run = require('node:util').promisify(execFile);
const { hashFile } = require('./updater.cjs');
async function stoppedPid() {
  const child = execFile('/usr/bin/true', []);
  const pid = child.pid;
  await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  return pid;
}
async function buildApp(directory, marker, minimumVersion = '11.0') {
  const app = path.join(directory, 'FreeCut.app');
  await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  const source = path.join(directory, 'main.c');
  await fs.writeFile(
    source,
    `#include <stdio.h>\nint main(void) { FILE *f=fopen(${JSON.stringify(marker)},"w"); if(!f)return 8; fputs("signed update application started",f); fclose(f); return 0; }\n`,
  );
  await run('/usr/bin/clang', [source, '-o', path.join(app, 'Contents', 'MacOS', 'FreeCut')]);
  await fs.writeFile(
    path.join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>FreeCut update regression fixture</string>
<key>CFBundleIdentifier</key><string>org.freecut.desktop</string>
<key>CFBundleExecutable</key><string>FreeCut</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.99.0</string>
<key>CFBundleVersion</key><string>0.99.0</string>
<key>LSMinimumSystemVersion</key><string>${minimumVersion}</string>
<key>LSUIElement</key><true/>
</dict></plist>`,
  );
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  return app;
}
test(
  'real macOS update helper installs a signed app, restores after LaunchServices refusal, and rejects tampering',
  { skip: process.platform !== 'darwin', timeout: 90000 },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-mac-update-'));
    t.after(async () => {
      assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
      await fs.rm(directory, { recursive: true, force: true });
    });
    for (const scenario of ['success', 'launch-refused', 'checksum-failure']) {
      await t.test(scenario, async () => {
        const fixture = path.join(directory, `中文 空格-${scenario}`);
        await fs.mkdir(fixture);
        const oldMarker = path.join(fixture, 'old-started.txt');
        const marker = path.join(fixture, 'updated-started.txt');
        const target = await buildApp(fixture, oldMarker);
        const executable = path.join(target, 'Contents', 'MacOS', 'FreeCut');
        const oldHash = await hashFile(executable);
        const next = await buildApp(
          path.join(fixture, 'next'),
          marker,
          scenario === 'launch-refused' ? '99.0' : '11.0',
        );
        const nextHash = await hashFile(path.join(next, 'Contents', 'MacOS', 'FreeCut'));
        const archive = path.join(fixture, 'update.zip');
        await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', '--norsrc', next, archive]);
        const digest = await hashFile(archive);
        const helperDirectory = path.join(fixture, 'helper');
        await fs.mkdir(helperDirectory);
        const helper = path.join(helperDirectory, 'apply.sh');
        await fs.copyFile(path.join(__dirname, 'update-mac.sh'), helper);
        const project = path.join(fixture, 'existing.freecut');
        await fs.writeFile(project, 'existing project remains');
        const operation = run(
          '/bin/bash',
          [
            helper,
            archive,
            target,
            String(await stoppedPid()),
            scenario === 'checksum-failure' ? '0'.repeat(64) : digest,
            '0.99.0',
            '--quiet',
          ],
          { timeout: 30000 },
        );
        if (scenario === 'success') {
          await operation;
          const deadline = Date.now() + 15000;
          while (
            await fs.access(marker).then(
              () => false,
              () => true,
            )
          ) {
            assert(Date.now() < deadline, 'Updated native application did not actually start');
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          assert.equal(await fs.readFile(marker, 'utf8'), 'signed update application started');
          assert.equal(await hashFile(executable), nextHash);
          await assert.rejects(fs.stat(archive), { code: 'ENOENT' });
          assert(!(await fs.readdir(fixture)).some((name) => name.startsWith('.freecut-update.')));
        } else {
          await assert.rejects(operation);
          assert.equal(await hashFile(executable), oldHash);
          assert.equal(await hashFile(archive), digest);
          await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
          if (scenario === 'launch-refused') {
            // A correctly signed app requiring macOS 99 passes signature checks but
            // real LaunchServices rejects it after replacement, exercising rollback.
            assert.match(
              await fs.readFile(path.join(helperDirectory, 'result.txt'), 'utf8'),
              /Previous application restored/,
            );
            const stages = (await fs.readdir(fixture)).filter((name) =>
              name.startsWith('.freecut-update.'),
            );
            assert.equal(stages.length, 1);
            assert.equal(
              await hashFile(
                path.join(fixture, stages[0], 'failed.app', 'Contents', 'MacOS', 'FreeCut'),
              ),
              nextHash,
            );
            await assert.rejects(fs.stat(path.join(fixture, stages[0], 'previous.app')), {
              code: 'ENOENT',
            });
          }
        }
        assert.equal(await fs.readFile(project, 'utf8'), 'existing project remains');
        await assert.rejects(fs.stat(oldMarker), { code: 'ENOENT' });
      });
    }
  },
);
