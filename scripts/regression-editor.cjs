'use strict';

// Run after npm run build: node scripts/regression-editor.cjs [--skip-relink]
// Real Electron UI/IPC regression. Only native file dialogs are redirected to
// generated fixtures. Every profile, fixture, snapshot and report uses mkdtemp;
// existing user settings, projects and media are never opened or overwritten.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
  console.log(
    'npm run build\nnode scripts/regression-editor.cjs [--skip-relink]\nNo downloads. Uses installed Electron and prepared FFmpeg; all output stays in a new temporary directory.',
  );
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  await fs.access(path.join(root, 'dist', 'index.html')).catch(() => {
    throw Error('Build the current source first: npm run build');
  });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-editor-regression-'));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const report = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    directory,
    checks: [],
    passed: false,
  };
  let app,
    page,
    savedNumber = 0;
  const check = async (name, run) => {
    console.log(`RUN: ${name}`);
    const started = Date.now();
    await run();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - started });
    console.log(`PASS: ${name}`);
  };
  const fixturePath = path.join(directory, 'editable.freecut');
  const fixture = baseProject();
  await fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2));
  // Setting app paths before loading main.cjs also isolates macOS/Linux, where
  // FreeCut's Windows portable environment variable does not apply.
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');\napp.setPath('userData',${JSON.stringify(profile)});\napp.setPath('sessionData',${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(root, 'electron', 'main.cjs'))});\n`,
  );
  const queueOpen = (files) =>
    app.evaluate((_, paths) => {
      globalThis.__regressionDialogs.open.push(paths);
    }, files);
  const openProject = async (file, name, discardChanges = false) => {
    await queueOpen([file]);
    await page.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    const unsaved = page.getByRole('dialog', { name: '保存未完成的修改', exact: true });
    if (discardChanges) {
      await expect(unsaved).toBeVisible();
      await unsaved.getByRole('button', { name: '不保存并继续', exact: true }).click();
    }
    await expect(page.getByLabel('工程名称', { exact: true })).toHaveValue(name);
    await expect(unsaved).toBeHidden();
  };
  const snapshot = async (label) => {
    const file = path.join(directory, `${String(++savedNumber).padStart(2, '0')}-${label}.freecut`);
    await app.evaluate((_, destination) => {
      globalThis.__regressionDialogs.save.push(destination);
    }, file);
    await page.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
    await expect
      .poll(async () => fs.readFile(file, 'utf8').catch(() => ''), { timeout: 15000 })
      .not.toBe('');
    return { file, project: JSON.parse(await fs.readFile(file, 'utf8')) };
  };
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    // On Windows, exercise the actual portable profile path as well.
    if (process.platform === 'win32') env.PORTABLE_EXECUTABLE_DIR = directory;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env, timeout: 30000 });
    report.runtime = await app.evaluate(({ app }) => ({
      electron: process.versions.electron,
      node: process.versions.node,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    for (const selected of [report.runtime.userData, report.runtime.sessionData]) {
      const relative = path.relative(directory, selected);
      assert(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        `Profile escaped temporary directory: ${selected}`,
      );
    }
    await app.evaluate(({ dialog }) => {
      globalThis.__regressionDialogs = { open: [], save: [], warnings: [] };
      dialog.showOpenDialog = async () => {
        const filePaths = globalThis.__regressionDialogs.open.shift();
        if (!filePaths) throw Error('Unexpected native open dialog');
        return { canceled: false, filePaths };
      };
      dialog.showSaveDialog = async () => {
        const filePath = globalThis.__regressionDialogs.save.shift();
        if (!filePath) throw Error('Unexpected native save dialog');
        return { canceled: false, filePath };
      };
      dialog.showMessageBox = async (_, options) => {
        // Close is still handled by the real guard and its renderer handshake.
        if (options.title !== '保存更改')
          globalThis.__regressionDialogs.warnings.push(options.message);
        return { response: 1, checkboxChecked: false };
      };
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('button', { name: /^新建项目/ }).click();
    await expect(page.getByTitle('保存工程 Ctrl+S', { exact: true })).toBeVisible();
    const skip = page.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    const mode = page.getByTitle('切换关键帧操作模式', { exact: true });
    await expect(mode).toContainText('普通');
    await mode.click();
    await expect(mode).toContainText('专业模式');
    await openProject(fixturePath, fixture.name);

    await check('keyboard undo and shifted redo preserve clip edits', async () => {
      await page
        .getByRole('button', { name: `片段 ${fixture.clips[0].name}`, exact: true })
        .click();
      await page.getByTitle('复制片段', { exact: true }).click();
      await expect(page.locator('.timeline-clip')).toHaveCount(2);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator('.timeline-clip')).toHaveCount(1);
      await page.keyboard.press('ControlOrMeta+Shift+Z');
      await expect(page.locator('.timeline-clip')).toHaveCount(2);
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator('.timeline-clip')).toHaveCount(1);
    });

    await check('mobile inspector closes with visible button and Escape', async () => {
      await page.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
      await expect(page.locator('.app')).toHaveClass(/mobile-mode/);
      await page
        .locator('.quick-tools')
        .getByRole('button', { name: '关键帧', exact: true })
        .click();
      await expect(page.locator('.inspector')).toBeVisible();
      const close = page.getByTitle('关闭属性检查器', { exact: true });
      assert(
        await close.evaluate((button) => {
          const r = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
        'Inspector close button is covered by another surface',
      );
      await close.click();
      await expect(page.locator('.inspector')).toBeHidden();
      await page.keyboard.press('k');
      await expect(page.locator('.inspector')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.inspector')).toBeHidden();
      await page.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
      await expect(page.locator('.app')).not.toHaveClass(/mobile-mode/);
    });

    await check('locked track rejects duplication and receives no new text', async () => {
      await page
        .getByRole('button', { name: `片段 ${fixture.clips[0].name}`, exact: true })
        .click();
      await page.locator('.track-header.overlay').getByTitle('锁定轨道', { exact: true }).click();
      const before = (await snapshot('locked-before')).project;
      await page.getByTitle('复制片段', { exact: true }).click();
      await expect(page.locator('.toast')).toContainText('轨道已锁定');
      const afterDuplicate = (await snapshot('locked-after-duplicate')).project;
      assert.deepEqual(afterDuplicate.clips, before.clips, 'Duplication changed a locked track');
      assert.deepEqual(afterDuplicate.tracks, before.tracks);
      await page.locator('.tool-nav').getByRole('button', { name: '文字', exact: true }).click();
      await page.getByRole('button', { name: '添加文字', exact: true }).click();
      const afterText = (await snapshot('new-text-track')).project;
      assert.equal(afterText.clips.length, before.clips.length + 1);
      assert.deepEqual(
        afterText.clips.filter((c) => c.trackId === 'overlay'),
        before.clips,
      );
      assert.deepEqual(
        afterText.tracks.find((t) => t.id === 'overlay'),
        before.tracks.find((t) => t.id === 'overlay'),
      );
      const text = afterText.clips.find((c) => c.kind === 'text');
      const destination = afterText.tracks.find((t) => t.id === text.trackId);
      assert.notEqual(destination.id, 'overlay');
      assert.equal(destination.kind, 'overlay');
      assert.equal(destination.locked, false);
      assert.equal(afterText.tracks.length, before.tracks.length + 1);
    });

    await check(
      'numeric duration trims ending keyframes and fades; saved project reopens',
      async () => {
        // Open a clean fixture so this test cannot accidentally use the new text.
        await page.getByLabel('工程名称', { exact: true }).fill('before-trim-reset');
        await openProject(fixturePath, fixture.name, true);
        await page
          .getByRole('button', { name: `片段 ${fixture.clips[0].name}`, exact: true })
          .click();
        await page
          .locator('.inspector-tabs')
          .getByRole('button', { name: '基础', exact: true })
          .click();
        await expect(page.getByLabel('片段时长', { exact: true })).toHaveValue('5');
        await page.getByLabel('片段时长', { exact: true }).fill('2');
        const saved = await snapshot('shortened');
        const clip = saved.project.clips.find((c) => c.id === 'ending-keyframe-clip');
        assert.equal(clip.duration, 2);
        assert.equal(clip.fadeIn, 2);
        assert.equal(clip.fadeOut, 2);
        const points = Object.values(clip.keyframes).flat();
        assert(points.length > 0);
        assert(
          points.every((point) => point.time >= 0 && point.time <= 2),
          'A keyframe remains outside the trimmed duration',
        );
        assert(
          clip.keyframes.scale.some((point) => point.time === 2),
          'Trimmed animation lost its boundary value',
        );
        await page.getByLabel('工程名称', { exact: true }).fill('unsaved-reopen-sentinel');
        await openProject(saved.file, fixture.name, true);
        await page
          .getByRole('button', { name: `片段 ${fixture.clips[0].name}`, exact: true })
          .click();
        await expect(page.getByLabel('片段时长', { exact: true })).toHaveValue('2');
        const reopened = (await snapshot('reopened')).project;
        assert.deepEqual(reopened.clips, saved.project.clips);
        assert.deepEqual(reopened.tracks, saved.project.tracks);
      },
    );

    if (!args.has('--skip-relink'))
      await check(
        'missing media rejects wrong type/short source, then relinks compatible video',
        async () => {
          const ffmpeg = path.join(
            root,
            'resources',
            'ffmpeg',
            process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
          );
          await fs.access(ffmpeg).catch(() => {
            throw Error('Prepare FFmpeg first: npm run prepare:ffmpeg (or pass --skip-relink)');
          });
          const wrong = path.join(directory, 'wrong-type.wav');
          const short = path.join(directory, 'short-video.mp4');
          const compatible = path.join(directory, 'compatible-video.mp4');
          await runFFmpeg(ffmpeg, [
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:sample_rate=16000',
            '-t',
            '2',
            '-c:a',
            'pcm_s16le',
            wrong,
          ]);
          for (const [file, seconds] of [
            [short, '1'],
            [compatible, '6'],
          ]) {
            await runFFmpeg(ffmpeg, [
              '-f',
              'lavfi',
              '-i',
              'testsrc2=size=320x180:rate=15',
              '-t',
              seconds,
              '-c:v',
              'libx264',
              '-pix_fmt',
              'yuv420p',
              file,
            ]);
          }
          const missing = baseProject();
          missing.name = '缺失素材回归';
          missing.assets = [
            {
              id: 'missing-asset',
              name: 'original-video.mp4',
              kind: 'video',
              duration: 6,
              width: 320,
              height: 180,
              path: path.join(directory, 'not-present.mp4'),
              url: '',
              missing: true,
            },
          ];
          missing.clips = [
            {
              ...missing.clips[0],
              id: 'missing-clip',
              kind: 'video',
              name: '缺失视频',
              trackId: 'video',
              assetId: 'missing-asset',
              inPoint: 2,
              duration: 3,
              keyframes: {},
              fadeIn: 0,
              fadeOut: 0,
            },
          ];
          delete missing.clips[0].color;
          const missingFile = path.join(directory, 'missing.freecut');
          await fs.writeFile(missingFile, JSON.stringify(missing, null, 2));
          await openProject(missingFile, missing.name);
          // Keep the fixture in its original file format; the loader supplies defaults
          // for the five mask controls introduced after that format was saved.
          const normalizedMissingClips = missing.clips.map((clip) => ({
            ...clip,
            effects: {
              maskX: 0,
              maskY: 0,
              maskRotation: 0,
              maskFeather: 0,
              maskInvert: false,
              ...clip.effects,
            },
          }));
          await page
            .locator('.tool-nav')
            .getByRole('button', { name: '素材', exact: true })
            .click();
          const relink = page.getByRole('button', { name: '重新链接素材', exact: true });
          await expect(relink).toBeVisible();
          for (const [file, message, label] of [
            [wrong, '素材类型不一致', 'wrong-type'],
            [short, '替换素材太短', 'short-source'],
          ]) {
            await queueOpen([file]);
            await relink.click();
            await expect(page.locator('.toast')).toContainText(message);
            const rejected = (await snapshot(label)).project;
            assert.equal(rejected.assets[0].missing, true);
            assert.equal(rejected.assets[0].path, missing.assets[0].path);
            assert.deepEqual(rejected.clips, normalizedMissingClips);
            await expect(relink).toBeVisible();
          }
          await queueOpen([compatible]);
          await relink.click();
          await expect(page.locator('.toast')).toContainText('素材已重新链接');
          await expect(relink).toHaveCount(0);
          const recovered = (await snapshot('relinked')).project;
          assert.equal(recovered.assets[0].missing, false);
          assert.equal(await fs.realpath(recovered.assets[0].path), await fs.realpath(compatible));
          assert.equal(recovered.assets[0].kind, 'video');
          assert.deepEqual(recovered.clips, normalizedMissingClips);
        },
      );
    const dialogs = await app.evaluate(() => globalThis.__regressionDialogs);
    assert.equal(dialogs.open.length, 0);
    assert.equal(dialogs.save.length, 0);
    assert.deepEqual(dialogs.warnings, []);
    report.passed = true;
    await page.screenshot({ path: path.join(directory, 'final-editor.png') });
  } catch (error) {
    report.error = error.stack || String(error);
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    report.completedAt = new Date().toISOString();
    await fs.writeFile(
      path.join(directory, 'regression-result.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.length} regression groups\nReport: ${path.join(directory, 'regression-result.json')}`,
    );
  }
}

function baseProject() {
  return {
    version: 1,
    id: 'regression-project',
    name: '编辑器回归工程',
    width: 1920,
    height: 1080,
    fps: 30,
    background: '#101014',
    assets: [],
    tracks: [
      { id: 'overlay', name: '叠加', kind: 'overlay', muted: false, hidden: false, locked: false },
      { id: 'video', name: '画面', kind: 'video', muted: false, hidden: false, locked: false },
      { id: 'audio', name: '音频', kind: 'audio', muted: false, hidden: false, locked: false },
    ],
    clips: [
      {
        id: 'ending-keyframe-clip',
        name: '片尾关键帧色卡',
        kind: 'shape',
        trackId: 'overlay',
        start: 0,
        duration: 5,
        inPoint: 0,
        speed: 1,
        fadeIn: 3,
        fadeOut: 3,
        color: '#dd9865',
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
        keyframes: {
          scale: [
            { id: 'key-start', time: 0, value: 1, easing: 'linear' },
            { id: 'key-end', time: 5, value: 2, easing: 'linear' },
          ],
        },
      },
    ],
  };
}

function runFFmpeg(binary, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', ...arguments_],
      { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.once('error', reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(Error('FFmpeg fixture generation timed out'));
    }, 30000);
    child.once('close', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(Error(`FFmpeg fixture failed (${code}): ${stderr}`));
    });
  });
}
