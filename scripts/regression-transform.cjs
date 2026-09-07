'use strict';

// npm run build && node scripts/regression-transform.cjs
// Real Electron preview gestures and native project save/open IPC. No external
// media, FFmpeg inference or downloads. Native dialog choices are redirected to
// a fresh test directory; the product's navigation and close guards stay active.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron, expect } = require('@playwright/test');

function near(actual, expected, tolerance, description) {
  assert(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${description}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

async function main() {
  const root = path.resolve(__dirname, '..');
  await fs.access(path.join(root, 'dist/index.html')).catch(() => {
    throw Error('Build the current application first: npm run build');
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-transform-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');\napp.setPath('userData',${JSON.stringify(profile)});\napp.setPath('sessionData',${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(root, 'electron/main.cjs'))});\n`,
  );
  const report = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    directory,
    checks: [],
    rendererErrors: [],
    passed: false,
  };
  let app,
    page,
    counter = 0,
    fixture,
    shapeId,
    textId;
  const check = async (name, run) => {
    console.log(`RUN: ${name}`);
    const start = Date.now();
    await run();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - start });
    console.log(`PASS: ${name}`);
  };
  const save = async (label) => {
    const file = path.join(directory, `${String(++counter).padStart(2, '0')}-${label}.freecut`);
    await app.evaluate((_, filePath) => globalThis.__transformDialogs.save.push(filePath), file);
    const button = page.getByTitle('保存工程 Ctrl+S', { exact: true });
    await button.click();
    await expect.poll(() => fs.readFile(file, 'utf8').catch(() => '')).not.toBe('');
    await expect(button).toBeEnabled();
    const project = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(project.assets.length, 0, 'This regression must remain independent of media');
    assert.equal(project.clips.length, 2, 'Neither gesture nor undo may create/delete clips');
    return project;
  };
  const load = async (project, label) => {
    const file = path.join(directory, `fixture-${label}.freecut`);
    const next = { ...structuredClone(project), name: `画面操作回归-${label}` };
    await fs.writeFile(file, JSON.stringify(next, null, 2));
    await app.evaluate((_, filePath) => globalThis.__transformDialogs.open.push([filePath]), file);
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue(next.name);
    await expect(page.getByRole('dialog', { name: '保存未完成的修改', exact: true })).toBeHidden();
    await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
    return next;
  };
  const canvasRect = () => page.getByLabel('视频预览', { exact: true }).boundingBox();
  const point = async (project, transform) => {
    const r = await canvasRect();
    assert(r && r.width > 20 && r.height > 20, 'Canvas has no visible content rectangle');
    return {
      x: Math.round(r.x + (0.5 + transform.x / project.width) * r.width),
      y: Math.round(r.y + (0.5 + transform.y / project.height) * r.height),
      rect: r,
    };
  };
  const clipOf = (project, id) => {
    const clip = project.clips.find((clip) => clip.id === id);
    assert(clip, `Clip ${id} disappeared`);
    return clip;
  };
  const selected = async (clip) => {
    await expect(page.getByRole('button', { name: `片段 ${clip.name}`, exact: true })).toHaveClass(
      /selected/,
    );
    await expect(page.getByTestId('preview-selection-box')).toBeVisible();
  };
  const select = async (project, clip, transform = clip.transform) => {
    const p = await point(project, transform);
    await page.mouse.click(p.x, p.y);
    await selected(clip);
  };
  const mouseDrag = async (from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  };
  const translate = async (project, clip, dx, dy, transform = clip.transform) => {
    await select(project, clip, transform);
    const from = await point(project, transform);
    const to = { x: from.x + dx, y: from.y + dy };
    await mouseDrag(from, to);
    return {
      x: transform.x + (dx * project.width) / from.rect.width,
      y: transform.y + (dy * project.height) / from.rect.height,
    };
  };
  const pixelBounds = (color) =>
    page.getByLabel('视频预览', { exact: true }).evaluate((canvas, rgb) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width,
        minY = canvas.height,
        maxX = -1,
        maxY = -1;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4;
          if (rgb.every((value, channel) => Math.abs(data[index + channel] - value) < 3)) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      return { minX, minY, maxX, maxY, width: canvas.width, height: canvas.height };
    }, color);
  const verifyShapePixels = async (project, clip, transform = clip.transform) => {
    const radians = (transform.rotation * Math.PI) / 180;
    const halfWidth = (project.width * transform.scale) / 2;
    const halfHeight = (project.height * transform.scale) / 2;
    const extentX =
      Math.abs(Math.cos(radians)) * halfWidth + Math.abs(Math.sin(radians)) * halfHeight;
    const extentY =
      Math.abs(Math.sin(radians)) * halfWidth + Math.abs(Math.cos(radians)) * halfHeight;
    await expect
      .poll(
        async () => {
          const b = await pixelBounds([230, 93, 56]);
          const cx = ((project.width / 2 + transform.x) * b.width) / project.width;
          const cy = ((project.height / 2 + transform.y) * b.height) / project.height;
          return Math.max(
            Math.abs(b.minX - (cx - (extentX * b.width) / project.width)),
            Math.abs(b.maxX - (cx + (extentX * b.width) / project.width)),
            Math.abs(b.minY - (cy - (extentY * b.height) / project.height)),
            Math.abs(b.maxY - (cy + (extentY * b.height) / project.height)),
          );
        },
        { message: 'Rendered shape pixels must match its saved position, size and angle' },
      )
      .toBeLessThan(3);
  };
  const undoGesture = async (before, label) => {
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await save(`${label}-undo`);
    assert.deepEqual(undone, before, 'A single undo must restore the whole gesture exactly');
  };
  const seekFrames = async (frames) => {
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).focus();
    for (let i = 0; i < frames; i++) await page.keyboard.press('ArrowRight');
  };

  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    report.runtime = await app.evaluate(({ app }) => ({
      electron: process.versions.electron,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    assert.equal(report.runtime.userData, profile);
    assert.equal(report.runtime.sessionData, profile);
    await app.evaluate(({ dialog }) => {
      globalThis.__transformDialogs = { save: [], open: [], unexpected: [], closeChoices: 0 };
      dialog.showSaveDialog = async () => {
        const filePath = globalThis.__transformDialogs.save.shift();
        if (!filePath) throw Error('Unexpected native save dialog');
        return { canceled: false, filePath };
      };
      dialog.showOpenDialog = async () => {
        const filePaths = globalThis.__transformDialogs.open.shift();
        if (!filePaths) throw Error('Unexpected native open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showMessageBox = async (_window, options) => {
        if (options.title === '保存更改') globalThis.__transformDialogs.closeChoices++;
        else globalThis.__transformDialogs.unexpected.push(options.message);
        return { response: 1, checkboxChecked: false };
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 950 });

    await check('Home creates actual text and shape fixtures without media', async () => {
      await page.getByRole('button', { name: /^新建项目/ }).click();
      const skip = page.getByRole('button', { name: '跳过引导', exact: true });
      if (await skip.count()) await skip.click();
      await page.locator('.tool-nav').getByRole('button', { name: '文字', exact: true }).click();
      await page.getByRole('button', { name: '添加文字', exact: true }).click();
      await page.locator('.tool-nav').getByRole('button', { name: '工具', exact: true }).click();
      await page.getByRole('button', { name: /^添加色卡/ }).click();
      await expect(page.locator('.timeline-clip')).toHaveCount(2);
      fixture = await save('created-in-ui');
      shapeId = fixture.clips.find((clip) => clip.kind === 'shape').id;
      textId = fixture.clips.find((clip) => clip.kind === 'text').id;
      const shape = clipOf(fixture, shapeId),
        text = clipOf(fixture, textId);
      Object.assign(shape, { name: '预览色卡', color: '#e65d38', duration: 6 });
      Object.assign(shape.transform, { x: -400, y: -100, scale: 0.22 });
      Object.assign(text, { name: '预览文字', duration: 6 });
      Object.assign(text.text, { text: 'MOVE', fontSize: 96, bold: true, stroke: false });
      Object.assign(text.transform, { x: 350, y: 180 });
      fixture = await load(fixture, 'base');
      await expect(page.getByTestId('preview-transform-overlay')).toBeVisible();
      await verifyShapePixels(fixture, shape);
    });

    await check(
      'Direct preview clicks select text and shape without adding undo entries',
      async () => {
        const before = await page
          .getByLabel('视频预览', { exact: true })
          .evaluate((canvas) => canvas.toDataURL());
        await select(fixture, clipOf(fixture, textId));
        await select(fixture, clipOf(fixture, shapeId));
        assert.equal(
          await page.getByLabel('视频预览', { exact: true }).evaluate((canvas) => canvas.toDataURL()),
          before,
          'Selection outlines must remain in the DOM and never contaminate rendered/exported pixels',
        );
        await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
        assert.deepEqual(await save('selection-only'), fixture);
      },
    );

    await check(
      'Text drag writes the displayed displacement and undoes as one gesture',
      async () => {
        const text = clipOf(fixture, textId);
        await select(fixture, text);
        const beforePixels = await pixelBounds([255, 255, 255]);
        assert(beforePixels.maxX >= beforePixels.minX, 'Text must actually render before dragging');
        const expected = await translate(fixture, text, 27, -19);
        const moved = await save('text-move');
        const edited = clipOf(moved, textId);
        near(edited.transform.x, expected.x, 0.001, 'Saved text x');
        near(edited.transform.y, expected.y, 0.001, 'Saved text y');
        assert.deepEqual(clipOf(moved, shapeId), clipOf(fixture, shapeId));
        await expect
          .poll(async () => {
            const after = await pixelBounds([255, 255, 255]);
            const dx = ((edited.transform.x - text.transform.x) * after.width) / fixture.width;
            const dy = ((edited.transform.y - text.transform.y) * after.height) / fixture.height;
            return Math.max(
              Math.abs(after.minX - beforePixels.minX - dx),
              Math.abs(after.minY - beforePixels.minY - dy),
            );
          })
          .toBeLessThan(2);
        await undoGesture(fixture, 'text-move');
      },
    );

    await check(
      'Shape drag matches rendered pixels and a single undo restores the complete move',
      async () => {
        const shape = clipOf(fixture, shapeId);
        const expected = await translate(fixture, shape, 35, 17);
        const moved = await save('shape-move');
        const edited = clipOf(moved, shapeId);
        near(edited.transform.x, expected.x, 0.001, 'Saved shape x');
        near(edited.transform.y, expected.y, 0.001, 'Saved shape y');
        await verifyShapePixels(moved, edited);
        assert.deepEqual(clipOf(moved, textId), clipOf(fixture, textId));
        await undoGesture(fixture, 'shape-move');
      },
    );

    await check(
      'Corner scaling preserves the opposite corner and saves the rendered size',
      async () => {
        const shape = clipOf(fixture, shapeId);
        await select(fixture, shape);
        const handle = await page.getByTestId('preview-scale-se').boundingBox();
        assert(handle, 'Bottom-right scale handle must be available');
        const r = await canvasRect();
        const from = {
          x: Math.round(handle.x + handle.width / 2),
          y: Math.round(handle.y + handle.height / 2),
        };
        const factor = 1.35;
        const to = {
          x: Math.round(
            from.x +
              (fixture.width * shape.transform.scale * (factor - 1) * r.width) / fixture.width,
          ),
          y: Math.round(
            from.y +
              (fixture.height * shape.transform.scale * (factor - 1) * r.height) / fixture.height,
          ),
        };
        await mouseDrag(from, to);
        const scaled = await save('shape-scale');
        const edited = clipOf(scaled, shapeId);
        near(
          edited.transform.scale,
          shape.transform.scale * factor,
          0.008,
          'Scale follows corner movement',
        );
        near(
          edited.transform.x - (fixture.width * edited.transform.scale) / 2,
          shape.transform.x - (fixture.width * shape.transform.scale) / 2,
          0.001,
          'Opposite corner x',
        );
        near(
          edited.transform.y - (fixture.height * edited.transform.scale) / 2,
          shape.transform.y - (fixture.height * shape.transform.scale) / 2,
          0.001,
          'Opposite corner y',
        );
        await verifyShapePixels(scaled, edited);
        await undoGesture(fixture, 'shape-scale');
      },
    );

    await check(
      'Rotation handle saves its visible angle and undoes all intermediate pointer moves',
      async () => {
        const shape = clipOf(fixture, shapeId);
        await select(fixture, shape);
        const handle = await page.getByTestId('preview-rotate').boundingBox();
        assert(handle, 'Rotation handle must be available');
        const center = await point(fixture, shape.transform);
        const from = {
          x: Math.round(handle.x + handle.width / 2),
          y: Math.round(handle.y + handle.height / 2),
        };
        const angle = (35 * Math.PI) / 180;
        const dx = from.x - center.x,
          dy = from.y - center.y;
        const to = {
          x: Math.round(center.x + dx * Math.cos(angle) - dy * Math.sin(angle)),
          y: Math.round(center.y + dx * Math.sin(angle) + dy * Math.cos(angle)),
        };
        await mouseDrag(from, to);
        const rotated = await save('shape-rotate');
        const edited = clipOf(rotated, shapeId);
        near(edited.transform.rotation, 35, 1.5, 'Saved rotation angle');
        near(edited.transform.x, shape.transform.x, 0.001, 'Rotation center x');
        near(edited.transform.y, shape.transform.y, 0.001, 'Rotation center y');
        await verifyShapePixels(rotated, edited);
        await page.screenshot({ path: path.join(directory, 'rotated-preview.png') });
        await undoGesture(fixture, 'shape-rotate');
      },
    );

    await check(
      'Animated drag edits the current local time while preserving other keys and easing',
      async () => {
        const animatedFixture = structuredClone(fixture);
        const shape = clipOf(animatedFixture, shapeId);
        shape.start = 1.2;
        shape.keyframes = Object.fromEntries(
          [
            ['x', -400, -240],
            ['y', -100, -100],
            ['scale', 0.22, 0.32],
            ['rotation', 0, 30],
            ['opacity', 1, 0.7],
          ].map(([property, first, last]) => [
            property,
            [
              { id: `original-${property}-start`, time: 0, value: first, easing: 'linear' },
              { id: `original-${property}-end`, time: 4, value: last, easing: 'hold' },
            ],
          ]),
        );
        const before = await load(animatedFixture, 'animated');
        await seekFrames(Math.round(3.2 * before.fps));
        const evaluated = {
          ...shape.transform,
          x: -320,
          y: -100,
          scale: 0.27,
          rotation: 15,
          opacity: 0.85,
        };
        const expected = await translate(before, shape, 29, 13, evaluated);
        const after = await save('animated-move');
        const edited = clipOf(after, shapeId);
        assert.deepEqual(
          edited.transform,
          shape.transform,
          'Animated edit must not rewrite base values',
        );
        for (const property of ['x', 'y']) {
          const keys = edited.keyframes[property];
          assert.equal(keys.length, 3, `${property} should gain exactly one current-time key`);
          assert.deepEqual(keys[0], shape.keyframes[property][0]);
          assert.deepEqual(keys[2], shape.keyframes[property][1]);
          near(keys[1].time, 2, 1e-8, `${property} local keyframe time excludes clip.start`);
          near(
            keys[1].value,
            expected[property],
            0.001,
            `${property} evaluated pose plus drag delta`,
          );
        }
        for (const property of ['scale', 'rotation', 'opacity'])
          assert.deepEqual(
            edited.keyframes[property],
            shape.keyframes[property],
            `Drag must preserve unrelated ${property} keyframes`,
          );
        assert.deepEqual(clipOf(after, textId), clipOf(before, textId));
        await undoGesture(before, 'animated-move');
      },
    );

    await check('Locked tracks reject preview edits without creating history', async () => {
      const lockedFixture = structuredClone(fixture);
      const shape = clipOf(lockedFixture, shapeId);
      lockedFixture.tracks.find((track) => track.id === shape.trackId).locked = true;
      const locked = await load(lockedFixture, 'locked');
      const from = await point(locked, shape.transform);
      await mouseDrag(from, { x: from.x + 40, y: from.y + 20 });
      assert.deepEqual(await save('locked-after-drag'), locked);
      await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
    });

    await check('Escape rolls back a live drag and leaves the undo stack unchanged', async () => {
      const before = await load(fixture, 'cancel');
      const shape = clipOf(before, shapeId);
      await select(before, shape);
      const from = await point(before, shape.transform);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 45, from.y + 21, { steps: 8 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.deepEqual(await save('cancelled-drag'), before);
      await expect(page.getByTitle('撤销 Ctrl+Z', { exact: true })).toBeDisabled();
      await verifyShapePixels(before, shape);
    });

    await check(
      'Mobile layout converts canvas coordinates correctly for direct dragging',
      async () => {
        const before = await load(fixture, 'mobile');
        await page.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
        await expect(page.locator('.app')).toHaveClass(/mobile-mode/);
        await page.setViewportSize({ width: 1000, height: 900 });
        const text = clipOf(before, textId);
        const expected = await translate(before, text, -23, -17);
        const after = await save('mobile-text-move');
        const edited = clipOf(after, textId);
        near(edited.transform.x, expected.x, 0.001, 'Mobile x conversion');
        near(edited.transform.y, expected.y, 0.001, 'Mobile y conversion');
        assert.deepEqual(clipOf(after, shapeId), clipOf(before, shapeId));
        await page.screenshot({ path: path.join(directory, 'mobile-preview.png') });
        await undoGesture(before, 'mobile-text-move');
      },
    );

    const dialogs = await app.evaluate(() => globalThis.__transformDialogs);
    assert.equal(dialogs.save.length, 0);
    assert.equal(dialogs.open.length, 0);
    assert.deepEqual(dialogs.unexpected, []);
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      const timer = setTimeout(() => {
        report.passed = false;
        report.closeError = 'Product close guard did not finish within 30 seconds';
        process.exitCode = 1;
        app.process().kill();
      }, 30000);
      try {
        await app.close();
      } catch (error) {
        report.passed = false;
        report.closeError = error.message;
        process.exitCode = 1;
      } finally {
        clearTimeout(timer);
      }
    }
    report.completedAt = new Date().toISOString();
    const file = path.join(directory, 'regression-transform-result.json');
    await fs.writeFile(file, JSON.stringify(report, null, 2));
    console.log(
      `${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.length} transform regression groups\nReport: ${file}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
