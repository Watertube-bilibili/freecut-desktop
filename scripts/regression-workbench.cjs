'use strict';
// Actual Electron workbench, real pointer gestures and native IPC. Only file
// dialogs are queued. All profiles/media are newly authored temporary fixtures.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(
    path.join(await fs.realpath(os.tmpdir()), 'freecut-workbench-'),
  );
  const profile = path.join(directory, 'profile');
  const output = path.join(root, 'artifacts', 'workbench');
  await fs.mkdir(profile);
  await fs.mkdir(output, { recursive: true });
  const fixturePath = path.join(directory, 'workbench.freecut');
  const base = {
    start: 0,
    duration: 12,
    inPoint: 0,
    speed: 1,
    fadeIn: 0,
    fadeOut: 0,
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
  const project = {
    version: 1,
    id: 'workbench-regression',
    name: 'FreeCut Workbench',
    width: 1280,
    height: 720,
    fps: 30,
    background: '#11201c',
    assets: [],
    tracks: [
      { id: 'overlay', name: 'Titles', kind: 'overlay' },
      { id: 'video', name: 'Picture', kind: 'video' },
      { id: 'audio', name: 'Audio', kind: 'audio' },
    ].map((track) => ({ ...track, muted: false, hidden: false, locked: false })),
    clips: [
      {
        ...base,
        id: 'backdrop',
        name: 'Mint background',
        kind: 'shape',
        trackId: 'video',
        color: '#2d7463',
      },
      {
        ...base,
        id: 'title',
        name: 'Title',
        kind: 'text',
        trackId: 'overlay',
        text: {
          text: 'MAKE ROOM\nFOR YOUR NEXT CUT',
          fontSize: 66,
          color: '#effaf5',
          background: 'transparent',
          align: 'center',
          bold: true,
          stroke: false,
        },
        keyframes: {
          x: [
            { id: 'start', time: 0, value: 0, easing: 'linear' },
            { id: 'end', time: 12, value: 120, easing: 'linear' },
          ],
        },
      },
    ],
  };
  await fs.writeFile(fixturePath, JSON.stringify(project));
  const media = [
    path.join(directory, 'C-video.mp4'),
    path.join(directory, 'B-sound.flac'),
    path.join(directory, 'A-image.png'),
  ];
  const ffmpeg = require('ffmpeg-static');
  for (const [index, source, extra] of [
    [0, 'color=c=0x245e85:s=320x180:r=12:d=2', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']],
    [1, 'sine=frequency=330:duration=1', ['-c:a', 'flac']],
    [2, 'color=c=0x527d62:s=320x180', ['-frames:v', '1']],
  ])
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
        source,
        ...extra,
        media[index],
      ],
      { windowsHide: true },
    );
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
    startedAt: new Date().toISOString(),
    checks: [],
    screenshots: [],
    rendererErrors: [],
    passed: false,
  };
  let app,
    page,
    saved = 0;
  const check = async (name, action) => {
    console.log('RUN: ' + name);
    await action();
    report.checks.push({ name, passed: true });
    console.log('PASS: ' + name);
  };
  const save = async () => {
    const file = path.join(directory, `saved-${++saved}.freecut`);
    await app.evaluate((_, file) => globalThis.__workbenchDialogs.save.push(file), file);
    await page.getByTitle(/保存工程 Ctrl\+S|Save project Ctrl\+S/).click();
    await expect
      .poll(async () => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 15000 })
      .not.toBe('');
    await expect(page.locator('.close-backdrop')).toHaveCount(0);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  };
  const picture = async () => {
    await expect
      .poll(
        () =>
          page
            .locator('canvas[aria-label="视频预览"],canvas[aria-label="Video preview"]')
            .evaluate((canvas) => {
              if (!canvas.width || !canvas.height) return false;
              const p = canvas
                .getContext('2d')
                .getImageData(
                  Math.floor(canvas.width * 0.1),
                  Math.floor(canvas.height * 0.5),
                  1,
                  1,
                ).data;
              return p[1] > 60 && p[3] === 255;
            }),
        { timeout: 15000 },
      )
      .toBe(true);
  };
  const screenshot = async (name) => {
    await picture();
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 6000 });
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(dimensions.scroll <= dimensions.width + 1, 'No page overflow');
    const file = path.join(output, name + '.png');
    await page.screenshot({ path: file });
    report.screenshots.push(file);
  };
  const bezierFits = async () => {
    const editor = page.locator('.bezier-editor').first();
    await editor.scrollIntoViewIfNeeded();
    const inspector = await page.locator('.inspector').boundingBox();
    const bounds = await editor.boundingBox();
    assert(
      bounds.x >= inspector.x && bounds.x + bounds.width <= inspector.x + inspector.width,
      'Bezier editor stays inside the inspector',
    );
    for (const coordinate of ['X2', 'Y2']) {
      const input = editor.getByLabel(new RegExp(' ' + coordinate + '$'));
      await input.scrollIntoViewIfNeeded();
      await expect(input).toBeInViewport();
      const rect = await input.boundingBox();
      assert(
        rect.x >= inspector.x && rect.x + rect.width <= inspector.x + inspector.width,
        coordinate + ' remains visible inside the inspector',
      );
    }
  };
  const shortLibraryFits = async () => {
    const body = page.locator('.library-body');
    await body.evaluate((element) => {
      element.scrollTop = 0;
    });
    const bounds = await body.boundingBox();
    assert(bounds.height >= 120, 'Short-window media bin has at least 120px of usable height');
    const items = [
      body.locator('.import-button').first(),
      body.locator('.asset-card').nth(0),
      body.locator('.asset-card').nth(1),
    ];
    for (const item of items) {
      const rect = await item.boundingBox();
      assert(
        rect.y >= bounds.y - 1 && rect.y + rect.height <= bounds.y + bounds.height + 1,
        'Import button and the first media row are fully visible without resizing or scrolling',
      );
    }
    report.shortLibrary = { height: bounds.height, firstRowVisible: true, importVisible: true };
  };
  try {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 60000 });
    await app.evaluate(({ dialog }) => {
      globalThis.__workbenchDialogs = { open: [], save: [] };
      dialog.showOpenDialog = async () => {
        const filePaths = globalThis.__workbenchDialogs.open.shift();
        if (!filePaths) throw Error('Unexpected open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showSaveDialog = async () => {
        const filePath = globalThis.__workbenchDialogs.save.shift();
        if (!filePath) throw Error('Unexpected save dialog');
        return { canceled: false, filePath };
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    await app.evaluate((_, file) => globalThis.__workbenchDialogs.open.push([file]), fixturePath);
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(page.locator('.project-title')).toHaveValue(project.name);
    await picture();
    const baseline = await save();
    await check('Three real resizers, collapse and reset change only the workspace', async () => {
      const library = page.getByRole('separator', { name: '调整素材面板宽度', exact: true });
      const box = await library.boundingBox();
      const oldWidth = await page.locator('.library').evaluate((e) => e.clientWidth);
      await page.mouse.move(box.x + 3, box.y + 30);
      await page.mouse.down();
      await page.mouse.move(box.x + 43, box.y + 30, { steps: 5 });
      await page.mouse.up();
      assert((await page.locator('.library').evaluate((e) => e.clientWidth)) > oldWidth + 25);
      const inspector = page.getByRole('separator', { name: '调整属性面板宽度', exact: true });
      await inspector.focus();
      await page.keyboard.press('ArrowLeft');
      assert(Number(await inspector.getAttribute('aria-valuenow')) > 300);
      const timeline = page.getByRole('separator', { name: '调整时间线高度', exact: true });
      await timeline.focus();
      await page.keyboard.press('ArrowUp');
      assert(Number(await timeline.getAttribute('aria-valuenow')) > 250);
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('freecut-workbench-layout-v1')),
      );
      assert(
        stored.libraryWidth > 300 && stored.inspectorWidth > 300 && stored.timelineHeight > 250,
      );
      await page.getByTitle('收起素材库', { exact: true }).click();
      await expect(page.locator('.library')).toBeHidden();
      await picture();
      await page.getByTitle('显示或隐藏素材库', { exact: true }).click();
      await expect(page.locator('.library')).toBeVisible();
      await page.getByTitle('显示或隐藏属性检查器', { exact: true }).click();
      await expect(page.locator('.inspector')).toBeHidden();
      await picture();
      await page.getByTitle('重置工作台布局', { exact: true }).click();
      await expect(page.locator('.inspector')).toBeVisible();
      assert.equal(Number(await library.getAttribute('aria-valuenow')), 300);
      assert.deepEqual(
        await save(),
        baseline,
        'Changing workspace must not change the saved project',
      );
    });
    await check(
      'Media filters count real imported video, FLAC audio and image; sort by name',
      async () => {
        await app.evaluate((_, files) => globalThis.__workbenchDialogs.open.push(files), media);
        await page
          .locator('.library-body')
          .getByRole('button', { name: '导入素材', exact: true })
          .click();
        await expect(page.locator('.asset-card')).toHaveCount(3);
        const filters = page.getByRole('group', { name: '素材类型', exact: true });
        await filters.getByRole('button', { name: '音频 1', exact: true }).click();
        await expect(page.locator('.asset-name')).toHaveText(['B-sound.flac']);
        await filters.getByRole('button', { name: '视频 1', exact: true }).click();
        await expect(page.locator('.asset-name')).toHaveText(['C-video.mp4']);
        await filters.getByRole('button', { name: '图片 1', exact: true }).click();
        await expect(page.locator('.asset-name')).toHaveText(['A-image.png']);
        await filters.getByRole('button', { name: '全部 3', exact: true }).click();
        await page.getByLabel('素材排序', { exact: true }).selectOption('name');
        await expect(page.locator('.asset-name')).toHaveText([
          'A-image.png',
          'B-sound.flac',
          'C-video.mp4',
        ]);
      },
    );
    await check(
      'Fit timeline reveals all content and razor creates one undoable split',
      async () => {
        await page.getByTitle('时间线适合全片', { exact: true }).click();
        const bounds = await page.locator('.timeline-scroll').boundingBox();
        const clip = page.locator('.timeline-clip[data-clip-id="backdrop"]');
        const rect = await clip.boundingBox();
        assert(
          rect.x >= bounds.x - 1 && rect.x + rect.width <= bounds.x + bounds.width + 1,
          'Full duration fits the visible timeline',
        );
        await page.getByTitle('刀片工具：点击片段分割', { exact: true }).click();
        await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await expect(page.locator('.timeline-clip')).toHaveCount(3);
        const split = await save();
        assert.equal(split.clips.filter((c) => c.kind === 'shape').length, 2);
        await page.getByTitle('撤销 Ctrl+Z', { exact: true }).click();
        await expect(page.locator('.timeline-clip')).toHaveCount(2);
        await page.getByTitle('选择工具', { exact: true }).click();
      },
    );
    await check('Frame buttons step exactly one project frame without black preview', async () => {
      await page.getByTitle('回到起点', { exact: true }).click();
      await expect(page.locator('.frame-readout')).toHaveText('0 f');
      await page.getByTitle('下一帧', { exact: true }).click();
      await expect(page.locator('.frame-readout')).toHaveText('1 f');
      await picture();
      await page.getByTitle('上一帧', { exact: true }).click();
      await expect(page.locator('.frame-readout')).toHaveText('0 f');
      await picture();
    });
    await check(
      'Cubic-bezier easing is selectable and preserved in the FreeCut project',
      async () => {
        await page.locator('.timeline-clip[data-clip-id="title"]').click();
        await page.getByTitle('切换关键帧操作模式', { exact: true }).click();
        await page
          .locator('.quick-tools')
          .getByRole('button', { name: '关键帧', exact: true })
          .click();
        await page.getByLabel('缓动方式', { exact: true }).first().selectOption('bezier');
        const value = await save();
        const frame = value.clips.find((c) => c.id === 'title').keyframes.x[0];
        assert.equal(frame.easing, 'bezier');
        assert.equal(frame.curve.length, 4);
        assert(frame.curve.every(Number.isFinite));
        await bezierFits();
        await screenshot('desktop-1440x900');
      },
    );
    await check(
      'Short and mobile layouts keep the same live preview and accessible controls',
      async () => {
        await page.setViewportSize({ width: 1100, height: 620 });
        await shortLibraryFits();
        await bezierFits();
        await screenshot('short-1100x620');
        await page.locator('.layout-switch').click();
        await expect(page.locator('.app')).toHaveClass(/mobile-mode/);
        await picture();
        await page.getByTitle('显示或隐藏属性检查器', { exact: true }).click();
        await expect(page.locator('.inspector')).toBeVisible();
        await page.getByTitle('关闭属性检查器', { exact: true }).click();
        await screenshot('mobile-1100x620');
        await page.locator('.layout-switch').click();
        await picture();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('.editor-language').selectOption('en');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(
          page.getByRole('separator', { name: 'Resize media panel', exact: true }),
        ).toBeVisible();
        await expect(page.getByTitle('Fit the whole timeline', { exact: true })).toBeVisible();
        await bezierFits();
        await screenshot('desktop-english-1440x900');
      },
    );
    await check('English export settings remain accessible in a short window', async () => {
      await page.locator('.export-trigger').click();
      const dialog = page.locator('.export-dialog');
      await expect(dialog).toBeVisible();
      await screenshot('export-english-1440x900');
      await page.setViewportSize({ width: 1100, height: 620 });
      const bounds = await dialog.boundingBox();
      assert(
        bounds.y >= 0 && bounds.y + bounds.height <= 620,
        'Export dialog fits the short viewport',
      );
      await expect(dialog.getByRole('combobox')).toHaveCount(3);
      await expect(dialog.locator('.dialog-actions > button')).toBeInViewport();
      await screenshot('export-english-short-1100x620');
      await dialog.getByTitle('Close', { exact: true }).click();
      await shortLibraryFits();
    });
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log('WORKBENCH_REPORT: ' + path.join(output, 'report.json'));
  }
}
