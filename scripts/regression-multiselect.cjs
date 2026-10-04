'use strict';
// Run after npm run build. Real Electron workbench and captured pointer gestures;
// only native file dialogs are queued. All fixtures and profiles are temporary.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');
// macOS reserves Control-click for the context menu; Command is its editor modifier.
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const modifierLabel = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
async function main() {
  const screenshotsOnly = process.argv.includes('--screenshots-only');
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-multiselect-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const base = {
    kind: 'shape',
    name: 'Shape',
    start: 1,
    duration: 2,
    inPoint: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
    color: '#528871',
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
  };
  const fixture = {
    version: 1,
    id: 'multiselect-regression',
    name: 'Multi selection regression',
    width: 640,
    height: 360,
    fps: 30,
    background: '#13251e',
    assets: [],
    tracks: ['v0', 'v1', 'v2', 'locked', 'audio'].map((id) => ({
      id,
      name: id,
      kind: id === 'audio' ? 'audio' : 'video',
      muted: false,
      hidden: false,
      locked: id === 'locked',
    })),
    clips: [
      {
        ...base,
        id: 'one',
        name: 'First animated clip',
        trackId: 'v0',
        keyframes: {
          x: [
            { id: 'kf-a', time: 0, value: 0, easing: 'bezier', curve: [0.2, 0.5, 0.7, 1] },
            { id: 'kf-b', time: 2, value: 100, easing: 'linear' },
          ],
        },
      },
      { ...base, id: 'two', name: 'Second clip', trackId: 'v1', start: 4 },
      { ...base, id: 'later', name: 'Later clip', trackId: 'v2', start: 12 },
      { ...base, id: 'protected', name: 'Locked clip', trackId: 'locked', start: 2 },
    ],
  };
  if (screenshotsOnly) {
    const video = path.join(directory, 'Synthetic mint studio.mp4');
    const audio = path.join(directory, 'Synthetic rhythm.wav');
    const ffmpeg = require('ffmpeg-static');
    execFileSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=0x183d36:s=640x360:r=24:d=14,drawgrid=w=64:h=64:t=1:c=0x36564d,drawbox=x=340:y=55:w=220:h=250:c=0x84cdb0@0.35:t=fill,drawbox=x=360:y=75:w=180:h=210:c=0x183d36:t=fill',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        video,
      ],
      { windowsHide: true },
    );
    execFileSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=330:duration=14',
        '-af',
        'volume=0.4+0.3*sin(2*PI*t):eval=frame',
        audio,
      ],
      { windowsHide: true },
    );
    fixture.name = '多轨剪辑演示 · Synthetic media';
    fixture.assets = [
      {
        id: 'synthetic-video',
        name: 'Synthetic mint studio.mp4',
        kind: 'video',
        url: '',
        path: video,
        duration: 14,
        width: 640,
        height: 360,
      },
      {
        id: 'synthetic-audio',
        name: 'Synthetic rhythm.wav',
        kind: 'audio',
        url: '',
        path: audio,
        duration: 14,
      },
    ];
    fixture.tracks = fixture.tracks.slice(0, 3).map((track, index) => ({
      ...track,
      name: ['标题', '画面', '音频'][index],
      kind: index === 2 ? 'audio' : index === 0 ? 'overlay' : 'video',
    }));
    fixture.clips = [
      {
        ...base,
        id: 'one',
        name: 'MAKE YOUR NEXT CUT',
        kind: 'text',
        trackId: 'v0',
        start: 1,
        duration: 7,
        transform: { ...base.transform, x: -60, y: 0 },
        text: {
          text: 'MAKE YOUR\nNEXT CUT.',
          fontSize: 48,
          color: '#d8f7e9',
          background: 'transparent',
          align: 'left',
          bold: true,
          stroke: false,
        },
        keyframes: {
          x: [
            { id: 'key-in', time: 0, value: -80, easing: 'bezier', curve: [0.2, 0.5, 0.7, 1] },
            { id: 'key-out', time: 2, value: -60, easing: 'linear' },
          ],
        },
      },
      {
        ...base,
        id: 'two',
        name: 'Synthetic mint studio',
        kind: 'video',
        assetId: 'synthetic-video',
        trackId: 'v1',
        start: 0,
        duration: 14,
      },
      {
        ...base,
        id: 'later',
        name: 'Synthetic rhythm',
        kind: 'audio',
        assetId: 'synthetic-audio',
        trackId: 'v2',
        start: 0,
        duration: 14,
      },
    ];
  }
  const fixturePath = path.join(directory, 'selection.freecut');
  await fs.writeFile(fixturePath, JSON.stringify(fixture));
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
  );
  const env = { ...process.env, FREECUT_DISABLE_UPDATES: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  const report = {
    directory,
    platform: process.platform,
    modifier,
    checks: [],
    rendererErrors: [],
    passed: false,
  };
  let app,
    page,
    saved = 0;
  const check = async (name, action) => {
    console.log('RUN: ' + name);
    await action();
    report.checks.push(name);
    console.log('PASS: ' + name);
  };
  const save = async () => {
    const file = path.join(directory, `saved-${++saved}.freecut`);
    await app.evaluate((_, file) => globalThis.__selectionDialogs.save.push(file), file);
    await page.keyboard.press(`${modifier}+s`);
    await expect
      .poll(async () => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 15000 })
      .not.toBe('');
    // File creation precedes the renderer's completed-save acknowledgement; wait for its busy gate.
    await expect(page.locator('.close-backdrop')).toHaveCount(0);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const selected = async () =>
    (
      await page
        .locator('.timeline-clip.selected')
        .evaluateAll((els) => els.map((e) => e.dataset.clipId))
    ).sort();
  const selectPair = async () => {
    await clip('one').click({ position: { x: 25, y: 20 } });
    await clip('two').click({ modifiers: ['Shift'], position: { x: 25, y: 20 } });
    await expect.poll(selected).toEqual(['one', 'two']);
  };
  const undo = async () => {
    await page.keyboard.press(`${modifier}+z`);
  };
  const redo = async () => {
    await page.keyboard.press(`${modifier}+Shift+z`);
  };
  const trackBox = (id) => page.locator(`.track-lane[data-track-id="${id}"]`).boundingBox();
  const drag = async (id, dx, targetTrack, finish = 'release') => {
    const box = await clip(id).boundingBox();
    const destination = targetTrack ? await trackBox(targetTrack) : null;
    assert(box);
    const x = box.x + 22,
      y = box.y + 23;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, destination ? destination.y + 28 : y, { steps: 8 });
    if (finish === 'escape') await page.keyboard.press('Escape');
    if (finish === 'cancel')
      await page.locator('.timeline-inner').evaluate((element) =>
        element.dispatchEvent(
          new PointerEvent('pointercancel', {
            pointerId: window.__selectionPointerId,
            bubbles: true,
          }),
        ),
      );
    await page.mouse.up();
  };
  try {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 60000 });
    await app.evaluate(({ dialog }) => {
      globalThis.__selectionDialogs = { open: [], save: [] };
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: globalThis.__selectionDialogs.open.shift(),
      });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: globalThis.__selectionDialogs.save.shift(),
      });
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    await app.evaluate((_, file) => globalThis.__selectionDialogs.open.push([file]), fixturePath);
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(page.locator('.project-title')).toHaveValue(fixture.name);
    await page.evaluate(() =>
      document.addEventListener(
        'pointerdown',
        (event) => {
          window.__selectionPointerId = event.pointerId;
        },
        true,
      ),
    );
    const resize = page.getByRole('separator', { name: '调整时间线高度', exact: true });
    await resize.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
    const baseline = await save();
    const initialBox = await clip('one').boundingBox();
    const zoom = initialBox.width / fixture.clips[0].duration;
    if (!screenshotsOnly) {
      await check(
        `Shift and ${modifierLabel} toggle multiple clips without changing the project`,
        async () => {
          await selectPair();
          await clip('one').click({ modifiers: [modifier], position: { x: 25, y: 20 } });
          await expect.poll(selected).toEqual(['two']);
          await clip('one').click({ modifiers: [modifier], position: { x: 25, y: 20 } });
          await expect.poll(selected).toEqual(['one', 'two']);
          assert.deepEqual(await save(), baseline);
          await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
        },
      );
      await check(
        'Focused Space selects clips without playing; editor Space still plays',
        async () => {
          const playback = page.getByTitle('播放 / 暂停 Space', { exact: true });
          const paused = async () => {
            await expect(playback.locator('.lucide-play')).toBeVisible();
            await expect(playback.locator('.lucide-pause')).toHaveCount(0);
          };
          await paused();
          await clip('one').focus();
          await page.keyboard.press('Space');
          await expect.poll(selected).toEqual(['one']);
          await paused();
          await clip('two').focus();
          await page.keyboard.press('Shift+Space');
          await expect.poll(selected).toEqual(['one', 'two']);
          await paused();
          await page.keyboard.press('Shift+Space');
          await expect.poll(selected).toEqual(['one']);
          await paused();
          await clip('two').focus();
          await page.keyboard.press('Enter');
          await expect.poll(selected).toEqual(['two']);
          await paused();
          // A focusable, non-button editor surface exercises the global shortcut without a native button click.
          await page.locator('.track-header[data-track-id="v0"]').focus();
          await page.keyboard.press('Space');
          await expect(playback.locator('.lucide-pause')).toBeVisible();
          await page.keyboard.press('Space');
          await paused();
          assert.deepEqual(await save(), baseline);
          await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
        },
      );
      await check(
        'Empty-lane marquee selects intersected tracks without seeking or recording edits',
        async () => {
          const a = await trackBox('v0'),
            b = await trackBox('v1');
          const priorTime = await page.locator('.playhead').getAttribute('style');
          await page.mouse.move(a.x + 4, a.y + 2);
          await page.mouse.down();
          await page.mouse.move(a.x + 6.5 * zoom, b.y + b.height - 2, { steps: 8 });
          await expect(page.locator('.timeline-marquee')).toBeVisible();
          await page.mouse.up();
          await expect(page.locator('.timeline-marquee')).toHaveCount(0);
          await expect.poll(selected).toEqual(['one', 'two']);
          assert.equal(await page.locator('.playhead').getAttribute('style'), priorTime);
          assert.deepEqual(await save(), baseline);
        },
      );
      await check(
        'Group move preserves timing offsets and one undo restores every member',
        async () => {
          await drag('one', zoom * 2);
          await expect.poll(selected).toEqual(['one', 'two']);
          const moved = await save();
          assert.equal(moved.clips.find((c) => c.id === 'one').start, 3);
          assert.equal(moved.clips.find((c) => c.id === 'two').start, 6);
          await undo();
          assert.deepEqual(await save(), baseline);
          await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
          await redo();
          assert.deepEqual(await save(), moved);
          await undo();
        },
      );
      await check('Compatible cross-track drag preserves relative track offsets', async () => {
        await selectPair();
        await drag('one', zoom, 'v1');
        const moved = await save();
        assert.deepEqual(
          moved.clips.slice(0, 2).map((c) => [c.trackId, c.start]),
          [
            ['v1', 2],
            ['v2', 5],
          ],
        );
        await undo();
        assert.deepEqual(await save(), baseline);
      });
      await check('Locked or incompatible destinations reject the entire group', async () => {
        await selectPair();
        await drag('one', zoom, 'v2');
        assert.deepEqual(await save(), baseline);
        await clip('one').click({ position: { x: 25, y: 20 } });
        await drag('one', zoom, 'audio');
        assert.deepEqual(await save(), baseline);
        await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
      });
      await check(
        'Escape and pointercancel restore the full selection without adding history',
        async () => {
          await selectPair();
          await drag('one', zoom * 2, undefined, 'escape');
          assert.deepEqual(await save(), baseline);
          await selectPair();
          await drag('one', zoom * 2, undefined, 'cancel');
          assert.deepEqual(await save(), baseline);
          await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
        },
      );
      await check('Group copy and paste keep animation and create independent IDs', async () => {
        await selectPair();
        await page.keyboard.press(`${modifier}+c`);
        const ruler = await page.locator('.ruler').boundingBox();
        await page.mouse.click(ruler.x + zoom * 8, ruler.y + 12);
        await page.keyboard.press(`${modifier}+v`);
        await expect(page.locator('.timeline-clip')).toHaveCount(6);
        const pasted = await save();
        const clones = pasted.clips.filter((c) => !baseline.clips.some((b) => b.id === c.id));
        assert.deepEqual(
          clones.map((c) => c.start).sort((a, b) => a - b),
          [8, 11],
        );
        const animated = clones.find((c) => c.name === 'First animated clip');
        assert.deepEqual(
          animated.keyframes.x.map(({ id, ...point }) => point),
          baseline.clips[0].keyframes.x.map(({ id, ...point }) => point),
        );
        assert.notEqual(animated.keyframes.x[0].id, baseline.clips[0].keyframes.x[0].id);
        await undo();
        assert.deepEqual(await save(), baseline);
        await redo();
        assert.deepEqual(await save(), pasted);
        await undo();
      });
      await check('Group duplication and ripple deletion each use one undo step', async () => {
        await selectPair();
        await page.keyboard.press(`${modifier}+d`);
        await expect(page.locator('.timeline-clip')).toHaveCount(6);
        const duplicated = await save();
        assert.deepEqual(
          duplicated.clips
            .slice(4)
            .map((c) => c.start)
            .sort((a, b) => a - b),
          [6, 9],
        );
        await undo();
        assert.deepEqual(await save(), baseline);
        await selectPair();
        await page.keyboard.press('Shift+Delete');
        await expect(page.locator('.timeline-clip')).toHaveCount(2);
        const rippled = await save();
        assert.equal(rippled.clips.find((c) => c.id === 'later').start, 8);
        assert.deepEqual(
          rippled.clips.find((c) => c.id === 'protected'),
          baseline.clips.find((c) => c.id === 'protected'),
        );
        await undo();
        assert.deepEqual(await save(), baseline);
      });
      await check('Select-all and batch delete preserve locked clips', async () => {
        await clip('protected').click({ position: { x: 25, y: 20 } });
        await page.keyboard.press(`${modifier}+a`);
        await expect(page.locator('.timeline-clip.selected')).toHaveCount(4);
        await page.keyboard.press('Delete');
        await expect(page.locator('.timeline-clip')).toHaveCount(1);
        assert.deepEqual((await save()).clips, [baseline.clips.find((c) => c.id === 'protected')]);
        await undo();
        assert.deepEqual(await save(), baseline);
      });
    }
    await selectPair();
    await page.screenshot({ path: path.join(directory, 'multiselect.png') });
    if (screenshotsOnly) {
      const screenshots = path.join(root, 'docs', 'screenshots');
      const review = path.join(root, '.impeccable', 'review');
      await fs.mkdir(screenshots, { recursive: true });
      await fs.mkdir(review, { recursive: true });
      await page.getByTitle('重置工作台布局', { exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 900 });
      await resize.focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
      await expect(page.locator('.clip-thumbnails img').first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.clip-waveform polygon').first()).toBeVisible({ timeout: 30000 });
      const ruler = await page.locator('.ruler').boundingBox();
      await page.mouse.click(ruler.x + zoom * 2, ruler.y + 12);
      await selectPair();
      const capture = async (file, width, height) => {
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10000 });
        await expect(page.locator('.timeline-clip.selected')).toHaveCount(2);
        await page.screenshot({ path: file });
        const bytes = await fs.readFile(file);
        assert.equal(bytes.readUInt32BE(16), width);
        assert.equal(bytes.readUInt32BE(20), height);
        console.log('SCREENSHOT: ' + file);
      };
      await capture(path.join(screenshots, 'editor-060.png'), 1440, 900);
      await page.setViewportSize({ width: 1100, height: 620 });
      await capture(path.join(review, 'user-1100.png'), 1100, 620);
      await page.locator('.layout-switch').click();
      await expect(page.locator('.app')).toHaveClass(/mobile-mode/);
      await capture(path.join(screenshots, 'mobile-060.png'), 1100, 620);
      await page.locator('.layout-switch').click();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('.editor-language').selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await capture(path.join(screenshots, 'editor-en-060.png'), 1440, 900);
      await page.locator('.preview-cache-button').click();
      const panel = page.locator('.media-cache-panel');
      await expect(panel).toBeVisible();
      // Use a real, isolated workspace cache so published screenshots contain no home/profile path.
      const demoCache = path.join(root, 'artifacts', 'multiselect', `cache-demo-${Date.now()}`);
      await fs.mkdir(demoCache, { recursive: true });
      await app.evaluate(
        (_, directory) => globalThis.__selectionDialogs.open.push([directory]),
        demoCache,
      );
      await panel.getByRole('button', { name: 'Change cache location', exact: true }).click();
      await expect(panel.locator('code')).toHaveText(path.join(demoCache, 'FreeCut-MediaCache'));
      await panel.locator('.media-cache-primary').click();
      await expect(panel.locator('.media-cache-asset').first()).toContainText('proxy ready', {
        timeout: 60000,
      });
      await capture(path.join(screenshots, 'media-cache-en-060.png'), 1440, 900);
      await panel.locator('.media-cache-close').click();
      await page.locator('.editor-language').selectOption('zh-CN');
      await page.setViewportSize({ width: 1100, height: 620 });
      await page.locator('.preview-cache-button').click();
      await expect(panel).toBeVisible();
      await capture(path.join(screenshots, 'media-cache-060.png'), 1100, 620);
    }
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    if (!screenshotsOnly) {
      const artifactDirectory = path.join(root, 'artifacts', 'multiselect');
      await fs.mkdir(artifactDirectory, { recursive: true });
      await fs.writeFile(
        path.join(artifactDirectory, 'report.json'),
        JSON.stringify(report, null, 2),
      );
    }
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}
