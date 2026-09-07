'use strict';
// npm run build && node scripts/regression-effects.cjs
// Real decoded video, actual Canvas pixels, native project round trip, and reachable
// controls in short desktop/mobile windows. Offline and isolated from user projects.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron, expect } = require('@playwright/test');
const { build } = require('esbuild');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-effects-regression-'));
  const video = path.join(directory, 'pattern.mp4');
  const report = { directory, checks: [], passed: false, rendererErrors: [] };
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  let app, editor;
  const check = async (name, action) => {
    console.log(`RUN: ${name}`);
    await action();
    report.checks.push(name);
    console.log(`PASS: ${name}`);
  };
  try {
    await promisify(execFile)(
      path.join(root, 'resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x180:rate=30:duration=2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        video,
      ],
      { windowsHide: true },
    );
    const entry = path.join(directory, 'entry.ts');
    await fs.writeFile(
      entry,
      `export {renderProject,createPreviewRenderer,clearMediaCache} from ${JSON.stringify(path.join(root, 'src/core/renderer.ts'))}; export {createProject,createClip,defaultEffects} from ${JSON.stringify(path.join(root, 'src/core/project.ts'))};export {effectPresets} from ${JSON.stringify(path.join(root, 'src/core/effects.ts'))};`,
    );
    await build({
      entryPoints: [entry],
      outfile: path.join(directory, 'effects.js'),
      bundle: true,
      format: 'iife',
      globalName: 'EffectsTest',
      platform: 'browser',
    });
    await fs.writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><meta charset="utf-8"><canvas id="preview"></canvas><script src="effects.js"></script>',
    );
    const bootstrap = path.join(directory, 'harness.cjs');
    await fs.writeFile(
      bootstrap,
      `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'harness-profile'))});app.whenReady().then(()=>{const w=new BrowserWindow();w.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});});`,
    );
    app = await _electron.launch({ args: [bootstrap], cwd: root, env });
    const page = await app.firstWindow();
    let fixture;
    await check('Seven masks and inverse pixels retain the lower track', async () => {
      const result = await page.evaluate(async () => {
        const api = window.EffectsTest,
          p = api.createProject();
        p.width = 320;
        p.height = 180;
        p.background = '#000000';
        const lower = api.createClip('shape', p.tracks[1].id, { color: '#0000ff' });
        const upper = api.createClip('shape', p.tracks[0].id, { color: '#ff0000' });
        p.clips = [lower, upper];
        const canvas = document.querySelector('canvas');
        const pixel = (x, y) => [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
        const samples = [];
        for (const mask of ['circle', 'rectangle', 'ellipse', 'diamond', 'star', 'heart', 'band']) {
          upper.effects = { ...api.defaultEffects(), mask, maskSize: 0.6 };
          await api.renderProject(canvas, p, 0.5);
          const inside = pixel(160, 90),
            outside = pixel(10, 10);
          if (inside[0] !== 255 || inside[2] !== 0 || outside[2] !== 255 || outside[0] !== 0)
            throw Error(`${mask}: wrong normal mask pixels ${inside} / ${outside}`);
          upper.effects.maskInvert = true;
          await api.renderProject(canvas, p, 0.5);
          const hole = pixel(160, 90),
            surround = pixel(10, 10);
          if (hole[2] !== 255 || surround[0] !== 255)
            throw Error(`${mask}: inverted mask erased lower track`);
          samples.push({ mask, inside, outside, hole, surround });
        }
        window.__effectsProject = p;
        return { samples, fixture: p };
      });
      report.maskPixels = result.samples;
      fixture = result.fixture;
    });
    await check(
      'Feather produces partial alpha and preserves full lower-track color outside',
      async () => {
        report.feather = await page.evaluate(async () => {
          const api = window.EffectsTest,
            p = window.__effectsProject,
            upper = p.clips[1],
            c = document.querySelector('canvas');
          upper.effects = {
            ...api.defaultEffects(),
            mask: 'rectangle',
            maskSize: 0.5,
            maskFeather: 0.04,
          };
          await api.renderProject(c, p, 0.5);
          const px = (x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
          const edge = px(80, 90),
            center = px(160, 90),
            outside = px(10, 10);
          if (!(edge[0] > 70 && edge[0] < 190 && edge[2] > 70 && edge[2] < 190))
            throw Error(`Feather edge is not a blend: ${edge}`);
          if (center[0] < 250 || outside[2] !== 255)
            throw Error('Feather altered opaque center or lower track');
          upper.effects.maskInvert = true;
          await api.renderProject(c, p, 0.5);
          const inverse = px(80, 90);
          if (Math.abs(inverse[0] + edge[0] - 255) > 3 || px(160, 90)[2] < 250)
            throw Error('Feather inverse is not complementary');
          return { edge, center, outside, inverse };
        });
      },
    );
    await check(
      'Decoded video with shifted rotated feathered masks matches strict export pixels at keyframes',
      async () => {
        report.video = await page.evaluate(async (url) => {
          const api = window.EffectsTest,
            p = window.__effectsProject;
          p.assets = [
            {
              id: 'pattern',
              name: 'Pattern',
              kind: 'video',
              url,
              duration: 2,
              width: 320,
              height: 180,
            },
          ];
          p.clips[1] = api.createClip('video', p.tracks[0].id, {
            assetId: 'pattern',
            duration: 2,
            effects: {
              ...api.defaultEffects(),
              mask: 'heart',
              maskSize: 0.8,
              maskX: 0.08,
              maskY: -0.05,
              maskRotation: 18,
              maskFeather: 0.02,
              flipX: true,
            },
            keyframes: {
              x: [
                { id: 'x0', time: 0, value: -20, easing: 'linear' },
                { id: 'x1', time: 1, value: 30, easing: 'linear' },
              ],
              rotation: [
                { id: 'r0', time: 0, value: -10, easing: 'ease-in-out' },
                { id: 'r1', time: 1, value: 25, easing: 'linear' },
              ],
            },
          });
          const preview = api.createPreviewRenderer(),
            canvas = document.querySelector('canvas'),
            strict = document.createElement('canvas');
          const frames = [];
          for (const time of [0.1, 0.5, 1.2]) {
            await preview.request(canvas, p, time);
            await api.renderProject(strict, p, time);
            const a = canvas.toDataURL(),
              b = strict.toDataURL();
            if (a !== b) throw Error(`Preview and strict export differ at ${time}`);
            frames.push(a);
          }
          if (new Set(frames).size !== 3)
            throw Error('Actual animated decoded video did not change between frames');
          preview.dispose();
          api.clearMediaCache();
          return { times: [0.1, 0.5, 1.2], exactMatches: 3, fixture: p };
        }, pathToFileURL(video).href);
        fixture = report.video.fixture;
        delete report.video.fixture;
      },
    );
    await check('Switching monochrome to daylight restores actual color pixels', async () => {
      report.grades = await page.evaluate(async () => {
        const api = window.EffectsTest,
          p = api.createProject();
        p.width = 320;
        p.height = 180;
        const c = api.createClip('shape', p.tracks[0].id, { color: '#b45828' });
        p.clips = [c];
        const canvas = document.querySelector('canvas');
        c.effects = { ...c.effects, ...api.effectPresets.find((p) => p.id === 'mono').values };
        await api.renderProject(canvas, p, 0);
        const mono = [...canvas.getContext('2d').getImageData(160, 90, 1, 1).data];
        c.effects = { ...c.effects, ...api.effectPresets.find((p) => p.id === 'daylight').values };
        await api.renderProject(canvas, p, 0);
        const color = [...canvas.getContext('2d').getImageData(160, 90, 1, 1).data];
        if (
          Math.max(...mono.slice(0, 3)) - Math.min(...mono.slice(0, 3)) > 1 ||
          color[0] - color[2] < 40
        )
          throw Error(`Color preset pixels incorrect: ${mono}, ${color}`);
        return { mono, color };
      });
    });
    await app.close();
    app = undefined;
    fixture.name = '蒙版与布局回归';
    fixture.assets[0].path = video;
    fixture.assets[0].url = 'freecut-media://asset/pattern';
    const fixtureFile = path.join(directory, 'fixture.freecut'),
      savedFile = path.join(directory, 'saved.freecut');
    await fs.writeFile(fixtureFile, JSON.stringify(fixture));
    const launch = path.join(directory, 'app.cjs');
    await fs.writeFile(
      launch,
      `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'app-profile'))});app.setPath('sessionData',${JSON.stringify(path.join(directory, 'app-profile'))});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
    );
    app = await _electron.launch({ args: [launch], cwd: root, env });
    await app.evaluate(
      ({ dialog }, data) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [data.fixtureFile] });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: data.savedFile });
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      },
      { fixtureFile, savedFile },
    );
    editor = await app.firstWindow();
    editor.setDefaultTimeout(15000);
    editor.on('pageerror', (error) => report.rendererErrors.push(error.message));
    await editor.setViewportSize({ width: 1440, height: 900 });
    await editor.getByRole('button', { name: /^新建项目/ }).click();
    const skip = editor.getByRole('button', { name: '跳过引导', exact: true });
    if (await skip.count()) await skip.click();
    await editor.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
    await expect(editor.getByLabel('工程名称', { exact: true })).toHaveValue(fixture.name);
    await editor
      .getByRole('button', { name: `片段 ${fixture.clips[1].name}`, exact: true })
      .click();
    await editor
      .locator('.inspector-tabs')
      .getByRole('button', { name: '调色 / 蒙版', exact: true })
      .click();
    await check(
      'Actual inspector new mask controls persist through native project save',
      async () => {
        await expect(editor.getByLabel('蒙版形状', { exact: true })).toHaveValue('heart');
        await editor.getByLabel('蒙版形状', { exact: true }).selectOption('star');
        await editor.getByLabel('反转蒙版', { exact: true }).check();
        await editor.getByTitle('保存工程 Ctrl+S', { exact: true }).click();
        await expect.poll(() => fs.readFile(savedFile, 'utf8').catch(() => '')).not.toBe('');
        const saved = JSON.parse(await fs.readFile(savedFile, 'utf8')),
          actual = saved.clips.find((c) => c.id === fixture.clips[1].id);
        assert.equal(actual.effects.mask, 'star');
        assert.equal(actual.effects.maskInvert, true);
        assert.equal(actual.effects.maskFeather, 0.02);
        assert.equal(actual.effects.maskX, 0.08);
        assert.equal(actual.effects.maskRotation, 18);
        assert.deepEqual(actual.keyframes, fixture.clips[1].keyframes);
        report.savedEffects = actual.effects;
      },
    );
    const accessible = async (locator, label) => {
      await locator.scrollIntoViewIfNeeded();
      report[label] = await locator.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          element: element.outerHTML,
          rect: r.toJSON(),
          hit: hit?.outerHTML.slice(0, 220),
          panes: [
            ...document.querySelectorAll(
              '.app,.workspace,.preview-panel,.stage,.inspector,.inspector-body',
            ),
          ].map((el) => ({
            className: el.className,
            rect: el.getBoundingClientRect().toJSON(),
            clientHeight: el.clientHeight,
            scrollHeight: el.scrollHeight,
            scrollTop: el.scrollTop,
            overflow: getComputedStyle(el).overflow,
            flex: getComputedStyle(el).flex,
            rows: getComputedStyle(el).gridTemplateRows,
          })),
        };
      });
      await expect
        .poll(
          () =>
            locator.evaluate((element) => {
              const r = element.getBoundingClientRect(),
                x = r.x + r.width / 2,
                y = r.y + r.height / 2;
              return (
                r.width > 0 &&
                r.height > 0 &&
                x >= 0 &&
                y >= 0 &&
                x < innerWidth &&
                y < innerHeight &&
                element.contains(document.elementFromPoint(x, y))
              );
            }),
          { message: `${label} must be reachable and not covered` },
        )
        .toBe(true);
      await locator.click({ trial: true });
    };
    await check(
      'Short desktop inspector reaches its final control and preview transport remains reachable',
      async () => {
        await editor.setViewportSize({ width: 1100, height: 620 });
        await accessible(
          editor.getByLabel('启用抠像', { exact: true }),
          'desktop inspector final control',
        );
        await editor.getByLabel('启用抠像', { exact: true }).check();
        await expect(editor.getByLabel('启用抠像', { exact: true })).toBeChecked();
        await editor.getByLabel('启用抠像', { exact: true }).uncheck();
        await accessible(
          editor.getByTitle('播放 / 暂停 Space', { exact: true }),
          'desktop preview transport',
        );
        await editor.screenshot({ path: path.join(directory, 'desktop-short.png') });
      },
    );
    await check(
      'Mobile 800×600 inspector and bottom controls remain reachable with shelf open',
      async () => {
        await editor.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
        await editor.setViewportSize({ width: 800, height: 600 });
        await editor
          .getByRole('button', { name: `片段 ${fixture.clips[1].name}`, exact: true })
          .click();
        await editor
          .locator('.quick-tools')
          .getByRole('button', { name: '画面调整', exact: true })
          .click();
        await editor
          .locator('.inspector-tabs')
          .getByRole('button', { name: '调色 / 蒙版', exact: true })
          .click();
        await accessible(
          editor.getByLabel('启用抠像', { exact: true }),
          'mobile inspector final control',
        );
        await editor.locator('.inspector').getByTitle('关闭属性检查器', { exact: true }).click();
        await editor
          .locator('.tool-nav')
          .getByRole('button', { name: '特效', exact: true })
          .click();
        await expect(editor.locator('.app')).toHaveClass(/shelf-open/);
        await accessible(
          editor.getByTitle('播放 / 暂停 Space', { exact: true }),
          'mobile preview transport with shelf',
        );
        await accessible(
          editor.locator('.quick-tools').getByRole('button').last(),
          'mobile preview final action with shelf',
        );
        await editor.screenshot({ path: path.join(directory, 'mobile-short.png') });
        report.mobileLayout = await editor.locator('.preview-panel').evaluate((element) => ({
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
          viewportHeight: innerHeight,
        }));
      },
    );
    assert.deepEqual(report.rendererErrors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.stack;
    if (editor)
      await editor.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.writeFile(
      path.join(directory, 'effects-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `${report.passed ? 'PASS' : 'FAIL'}: ${report.checks.length} effects/layout regression groups\nReport: ${path.join(directory, 'effects-report.json')}`,
    );
  }
}
