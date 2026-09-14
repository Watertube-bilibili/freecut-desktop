'use strict';
// Run after npm run build. Two real Electron applications use separate temporary
// profiles and a loopback room. Only native file-dialog choices are redirected;
// project edits, imports, room controls, transfers, and saves use the actual UI/IPC.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'freecut-collab-ui-'),
  );
  const report = { directory, checks: [], rendererErrors: [], screenshots: [], passed: false };
  const applications = [];
  const instances = [];
  async function check(name, action) {
    console.log(`RUN: ${name}`);
    await action();
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  }
  async function launch(label) {
    const profile = path.join(directory, `${label}-profile`);
    const bootstrap = path.join(directory, `${label}-launch.cjs`);
    await fs.mkdir(profile);
    await fs.writeFile(
      bootstrap,
      `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
    );
    const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    const app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 60000 });
    applications.push(app);
    await app.evaluate(({ dialog }) => {
      globalThis.__collabDialogs = { open: [], save: [], saved: [], messages: [] };
      dialog.showOpenDialog = async () => {
        const filePaths = globalThis.__collabDialogs.open.shift();
        if (!filePaths) throw Error('Unexpected open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showSaveDialog = async (_window, options) => {
        const filePath = globalThis.__collabDialogs.save.shift();
        if (!filePath) throw Error('Unexpected save dialog');
        globalThis.__collabDialogs.saved.push({ filePath, options });
        return { canceled: false, filePath };
      };
      dialog.showMessageBox = async (_window, options) => {
        globalThis.__collabDialogs.messages.push(options);
        return { response: 2, checkboxChecked: false };
      };
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    page.on('pageerror', (error) => report.rendererErrors.push(`${label}: ${error.message}`));
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('button', { name: /^新建项目/ }).click();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    const instance = { app, page, profile, label };
    instances.push(instance);
    return instance;
  }
  async function importImage(instance, file, addClip = true) {
    await instance.app.evaluate((_, file) => globalThis.__collabDialogs.open.push([file]), file);
    await instance.page.getByRole('button', { name: '导入素材', exact: true }).first().click();
    const card = instance.page.locator('.asset-card').filter({ hasText: path.basename(file) });
    await expect(card).toBeVisible();
    if (addClip) await card.dblclick();
  }
  async function save(instance, filename) {
    const target = path.join(directory, filename);
    await instance.app.evaluate((_, file) => globalThis.__collabDialogs.save.push(file), target);
    await instance.page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect.poll(() => fs.readFile(target, 'utf8').catch(() => '')).not.toBe('');
    return JSON.parse(await fs.readFile(target, 'utf8'));
  }
  async function screenshot(page, name) {
    const file = path.join(directory, `${name}.png`);
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  }
  const state = (instance) => instance.page.evaluate(() => window.freecut.collaboration.state());
  const previewPixel = (instance) =>
    instance.page
      .locator('canvas[aria-label="视频预览"]')
      .evaluate((canvas) =>
        Array.from(
          canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data,
        ),
      );

  try {
    const ffmpeg = path.join(
      root,
      'resources/ffmpeg',
      process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
    );
    const green = path.join(directory, 'shared-green.png');
    const blue = path.join(directory, 'shared-blue.png');
    for (const [file, color] of [
      [green, '0x22cc66'],
      [blue, '0x2255ee'],
    ]) {
      await run(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=${color}:s=320x180`,
          '-frames:v',
          '1',
          '-y',
          file,
        ],
        { windowsHide: true },
      );
    }
    const host = await launch('host');
    const client = await launch('client');
    const port = await unusedPort();
    let roomKey;
    await check('Host opens a real room and exposes its connection details', async () => {
      await host.page.getByLabel('工程名称', { exact: true }).fill('Shared demo');
      await importImage(host, green);
      await expect.poll(async () => (await previewPixel(host))[1]).toBeGreaterThan(150);
      await host.page.getByTitle('远程协作', { exact: true }).click();
      await host.page.getByLabel('你的昵称').fill('Host editor');
      await host.page.getByLabel('端口', { exact: true }).fill(String(port));
      await host.page.getByRole('button', { name: '开启房间并共享工程', exact: true }).click();
      await expect(host.page.getByText('房间已开启', { exact: true })).toBeVisible();
      roomKey = await host.page.getByLabel('房间密钥', { exact: true }).inputValue();
      assert.ok(roomKey.length >= 16);
      assert.equal((await state(host)).mode, 'hosting');
      assert.equal((await state(host)).port, port);
      await screenshot(host.page, 'host-room-chinese');
    });
    await check('IP/port/key join saves the local draft and downloads actual media', async () => {
      await client.page.getByLabel('工程名称', { exact: true }).fill('Unsaved local draft');
      const draft = path.join(directory, 'client-before-join.freecut');
      await client.app.evaluate((_, file) => globalThis.__collabDialogs.save.push(file), draft);
      await client.page.getByTitle('远程协作', { exact: true }).click();
      await client.page.getByRole('tab', { name: '加入房间', exact: true }).click();
      await client.page.getByLabel('你的昵称').fill('Guest editor');
      await client.page.getByLabel('主机 IP 地址', { exact: true }).fill('127.0.0.1');
      await client.page.getByLabel('端口', { exact: true }).fill(String(port));
      await client.page.getByLabel('房间密钥', { exact: true }).fill(roomKey);
      await client.page.getByRole('button', { name: '连接并加入房间', exact: true }).click();
      await expect(client.page.getByText('已加入协作', { exact: true })).toBeVisible();
      assert.equal(JSON.parse(await fs.readFile(draft, 'utf8')).name, 'Unsaved local draft');
      await expect.poll(async () => (await state(host)).peers.length).toBe(2);
      await host.page.keyboard.press('Escape');
      await client.page.keyboard.press('Escape');
      await expect(client.page.getByLabel('工程名称', { exact: true })).toHaveValue('Shared demo');
      const project = await save(client, 'client-joined.freecut');
      assert.equal(project.assets.length, 1);
      assert.notEqual(project.assets[0].path, green);
      assert.equal(path.dirname(project.assets[0].path), await fs.realpath(path.join(client.profile, 'collaboration')));
      assert.deepEqual(await fs.readFile(project.assets[0].path), await fs.readFile(green));
      await expect.poll(async () => (await previewPixel(client))[1]).toBeGreaterThan(150);
    });
    await check('Project and clip edits synchronize in both directions', async () => {
      await host.page.getByLabel('工程名称', { exact: true }).fill('Host rename');
      await expect(client.page.getByLabel('工程名称', { exact: true })).toHaveValue('Host rename');
      await client.page.getByLabel('工程名称', { exact: true }).fill('Guest rename');
      await expect(host.page.getByLabel('工程名称', { exact: true })).toHaveValue('Guest rename');
      await client.page.getByTitle('切换关键帧操作模式', { exact: true }).click();
      await client.page.getByRole('button', { name: '片段 shared-green.png', exact: true }).click();
      await client.page.getByLabel('片段时长', { exact: true }).fill('3');
      await expect.poll(async () => (await state(host)).revision).toBeGreaterThanOrEqual(3);
      await host.page.getByTitle('切换关键帧操作模式', { exact: true }).click();
      await host.page.getByRole('button', { name: '片段 shared-green.png', exact: true }).click();
      await expect(host.page.getByLabel('片段时长', { exact: true })).toHaveValue('3');
      await host.page.getByLabel('片段时长', { exact: true }).fill('4');
      await expect(client.page.getByLabel('片段时长', { exact: true })).toHaveValue('4');
    });
    await check('Guest-imported media uploads to the host and remains locally usable', async () => {
      await importImage(client, blue);
      await expect(
        host.page.locator('.asset-card').filter({ hasText: 'shared-blue.png' }),
      ).toBeVisible();
      await expect(
        host.page.getByRole('button', { name: '片段 shared-blue.png', exact: true }),
      ).toBeVisible();
      const project = await save(host, 'host-with-guest-media.freecut');
      const asset = project.assets.find((asset) => asset.name === 'shared-blue.png');
      assert.ok(asset);
      assert.notEqual(asset.path, blue);
      assert.equal(path.dirname(asset.path), await fs.realpath(path.join(host.profile, 'collaboration')));
      assert.deepEqual(await fs.readFile(asset.path), await fs.readFile(blue));
      const clientProject = await save(client, 'client-with-guest-media.freecut');
      assert.equal(clientProject.clips.length, project.clips.length);
      assert.deepEqual(clientProject.clips, project.clips);
    });
    await check('A paused timeline drag retains a simultaneous edit to another clip', async () => {
      const dragged = host.page.getByRole('button', { name: '片段 shared-green.png', exact: true });
      await dragged.scrollIntoViewIfNeeded();
      const box = await dragged.boundingBox();
      assert.ok(box);
      const origin = { x: box.x + Math.min(70, box.width / 2), y: box.y + box.height / 2 };
      await host.page.mouse.move(origin.x, origin.y);
      await host.page.mouse.down();
      try {
        await host.page.mouse.move(origin.x + 45, origin.y, { steps: 4 });
        // Deliberately exceed the collaboration debounce while keeping the pointer held.
        await host.page.waitForTimeout(400);
        assert.equal(await dragged.evaluate((element) => element.hasPointerCapture(1)), true);
        const before = (await state(host)).revision;
        await client.page
          .getByRole('button', { name: '片段 shared-blue.png', exact: true })
          .click();
        await client.page.getByLabel('片段时长', { exact: true }).fill('6');
        await expect.poll(async () => (await state(host)).revision).toBeGreaterThan(before);
        await host.page.mouse.move(origin.x + 95, origin.y, { steps: 4 });
      } finally {
        await host.page.mouse.up();
      }
      await host.page.getByRole('button', { name: '片段 shared-blue.png', exact: true }).click();
      await expect(host.page.getByLabel('片段时长', { exact: true })).toHaveValue('6');
      await client.page.getByRole('button', { name: '片段 shared-green.png', exact: true }).click();
      await expect
        .poll(async () =>
          Number(await client.page.getByLabel('开始时间', { exact: true }).inputValue()),
        )
        .toBeGreaterThan(0.5);
      const hostProject = await save(host, 'host-after-concurrent-drag.freecut');
      const clientProject = await save(client, 'client-after-concurrent-drag.freecut');
      assert.deepEqual(hostProject.clips, clientProject.clips);
      assert.equal(hostProject.clips.find((clip) => clip.name === 'shared-blue.png').duration, 6);
      assert.ok(hostProject.clips.find((clip) => clip.name === 'shared-green.png').start > 0.5);
    });
    await check('Real panel remains usable in desktop/mobile layouts and English', async () => {
      await screenshot(client.page, 'collaboration-editor-desktop');
      await client.page.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
      await client.page.getByTitle('远程协作', { exact: true }).click();
      await client.page.setViewportSize({ width: 1024, height: 720 });
      await screenshot(client.page, 'collaboration-room-mobile-layout');
      const bounds = await client.page.locator('.collab-dialog').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          width: element.clientWidth,
          scroll: element.scrollWidth,
          top: box.top,
          bottom: box.bottom,
          viewport: innerHeight,
        };
      });
      assert.ok(
        bounds.scroll <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.viewport,
      );
      await expect(
        client.page.getByRole('button', { name: '离开房间', exact: true }),
      ).toBeVisible();
      await client.page.keyboard.press('Escape');
      await client.page.locator('.editor-language').selectOption('en');
      await client.page.getByTitle('Remote collaboration', { exact: true }).click();
      await expect(
        client.page.getByRole('heading', { name: 'Remote collaboration', exact: true }),
      ).toBeVisible();
      assert.doesNotMatch(await client.page.getByRole('dialog').innerText(), /[\p{Script=Han}]/u);
      await screenshot(client.page, 'collaboration-room-english');
      await client.page
        .getByRole('button', { name: 'Close collaboration panel', exact: true })
        .focus();
      await client.page.keyboard.press('Shift+Tab');
      await expect(
        client.page.getByRole('button', { name: 'Leave room', exact: true }),
      ).toBeFocused();
      await client.page.keyboard.press('Tab');
      await expect(
        client.page.getByRole('button', { name: 'Close collaboration panel', exact: true }),
      ).toBeFocused();
    });
    await check('Explicit leaving keeps the project and downloaded media available', async () => {
      await client.page.getByRole('button', { name: 'Leave room', exact: true }).click();
      await expect.poll(async () => (await state(client)).mode).toBe('disconnected');
      await client.page.keyboard.press('Escape');
      await client.page.locator('.editor-language').selectOption('zh-CN');
      await expect(client.page.getByLabel('工程名称', { exact: true })).toHaveValue('Guest rename');
      await save(client, 'client-after-leave.freecut');
      await expect.poll(async () => (await state(host)).peers.length).toBe(1);
    });
    await check(
      'Generated invite code rejoins the room without typing its address or key',
      async () => {
        const invite = (await state(host)).invite;
        assert.match(invite, /^freecut1:/);
        await client.page.getByTitle('远程协作', { exact: true }).click();
        await client.page.getByRole('tab', { name: '加入房间', exact: true }).click();
        await client.page.getByRole('radio', { name: '邀请码', exact: true }).check();
        await client.page.getByLabel('粘贴邀请码', { exact: true }).fill(invite);
        await client.page.getByRole('button', { name: '连接并加入房间', exact: true }).click();
        await expect(client.page.getByText('已加入协作', { exact: true })).toBeVisible();
        await expect.poll(async () => (await state(host)).peers.length).toBe(2);
        await client.page.getByRole('button', { name: '离开房间', exact: true }).click();
        await expect.poll(async () => (await state(client)).mode).toBe('disconnected');
        await client.page.keyboard.press('Escape');
        await host.page.getByTitle('远程协作', { exact: true }).click();
        await host.page.getByRole('button', { name: '结束房间', exact: true }).click();
        await expect.poll(async () => (await state(host)).mode).toBe('disconnected');
        await host.page.keyboard.press('Escape');
        await expect(host.page.getByLabel('工程名称', { exact: true })).toHaveValue('Guest rename');
      },
    );
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.failure = error.message;
    report.states = [];
    for (const instance of instances) {
      report.states.push({
        label: instance.label,
        state: await state(instance).catch(() => null),
        dialog: await instance.page
          .locator('.collab-dialog')
          .innerText({ timeout: 1000 })
          .catch(() => ''),
      });
      await screenshot(instance.page, `${instance.label}-failure`).catch(() => {});
    }
    throw error;
  } finally {
    for (const app of applications.reverse())
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
