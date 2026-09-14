'use strict';
// Real Electron decoder + Canvas regression. The encoded pixels carry a frame number,
// so a preview that just repaints an old frame cannot pass the motion/latency checks.
// npm run build && node scripts/regression-preview-playback.cjs
// --renderer-only skips the production App checks and does not require a build.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function makeVideo(file) {
  const ffmpeg = path.join(
    root,
    'resources',
    'ffmpeg',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
  );
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pixel_format',
      'rgb24',
      '-video_size',
      '640x24',
      '-framerate',
      '30',
      '-i',
      'pipe:0',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30:duration=12',
      '-filter_complex',
      '[0:v]scale=1280:48:flags=neighbor[clock];[1:v][clock]overlay=0:0:shortest=1[v]',
      '-map',
      '[v]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-g',
      '300',
      '-keyint_min',
      '300',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      file,
    ],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Fixture encoder exited ${code}: ${stderr}`)),
    );
  });
  for (let frame = 0; frame < 360; frame++) {
    const pixels = Buffer.alloc(640 * 24 * 3, 48);
    for (let bit = 0; bit < 9; bit++) {
      const value = frame & (1 << bit) ? 224 : 32;
      for (let y = 0; y < 24; y++)
        pixels.fill(value, (y * 640 + bit * 40) * 3, (y * 640 + (bit + 1) * 40) * 3);
    }
    if (!child.stdin.write(pixels)) await once(child.stdin, 'drain');
  }
  child.stdin.end();
  await completed;
}

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-playback-regression-'));
  const video = path.join(directory, 'long-gop-moving-clock.mp4');
  const report = { directory, platform: process.platform, passed: false, rendererErrors: [] };
  let app;
  try {
    await makeVideo(video);
    const entry = path.join(directory, 'entry.ts');
    await fs.writeFile(
      entry,
      `export {renderProject,createPreviewRenderer,clearMediaCache} from ${JSON.stringify(path.join(root, 'src/core/renderer.ts'))};export {createProject,createClip} from ${JSON.stringify(path.join(root, 'src/core/project.ts'))};`,
    );
    await build({
      stdin: {
        contents: await fs.readFile(entry, 'utf8'),
        resolveDir: root,
        sourcefile: 'preview-playback-test.ts',
      },
      outfile: path.join(directory, 'preview.js'),
      bundle: true,
      format: 'iife',
      globalName: 'PreviewTest',
      platform: 'browser',
    });
    await fs.writeFile(
      path.join(directory, 'index.html'),
      '<!doctype html><meta charset="utf-8"><title>FreeCut continuous playback regression</title><canvas id="preview"></canvas><script src="preview.js"></script>',
    );
    const bootstrap = path.join(directory, 'harness.cjs');
    await fs.writeFile(
      bootstrap,
      `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({width:900,height:640,webPreferences:{backgroundThrottling:false}});w.loadFile(${JSON.stringify(path.join(directory, 'index.html'))});});`,
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.PORTABLE_EXECUTABLE_DIR;
    app = await _electron.launch({ args: [bootstrap], cwd: root, env });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => report.rendererErrors.push(error.message));
    report.renderer = await page.evaluate(async (videoUrl) => {
      const api = window.PreviewTest;
      const createElement = document.createElement.bind(document);
      const videoElements = [];
      let readinessDelay = 0;
      document.createElement = function (tag, options) {
        const element = createElement(tag, options);
        if (tag === 'video') {
          videoElements.push(element);
          // Deterministically exercise a slow decoder-ready notification as well as
          // the unmodified real-media measurements below. Pixel decoding stays real.
          element.addEventListener(
            'seeked',
            (event) => {
              if (!readinessDelay || !event.isTrusted) return;
              event.stopImmediatePropagation();
              setTimeout(() => element.dispatchEvent(new Event('seeked')), readinessDelay);
            },
            true,
          );
        }
        return element;
      };
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const check = (condition, message) => {
        if (!condition) throw new Error(message);
      };
      const project = api.createProject();
      project.width = 1280;
      project.height = 720;
      project.fps = 30;
      const asset = {
        id: 'clock',
        name: 'Long GOP moving frame clock',
        kind: 'video',
        url: videoUrl,
        duration: 12,
        width: 1280,
        height: 720,
      };
      project.assets = [asset];
      project.clips = [
        api.createClip('video', project.tracks.find((track) => track.kind === 'video').id, {
          assetId: asset.id,
          duration: 12,
        }),
      ];
      const canvas = document.querySelector('canvas');
      const preview = api.createPreviewRenderer();
      const readFrame = (target = canvas) => {
        const context = target.getContext('2d');
        let frame = 0;
        for (let bit = 0; bit < 9; bit++) {
          const data = context.getImageData(
            ((bit * 80 + 40) * target.width) / 1280,
            (24 * target.height) / 720,
            1,
            1,
          ).data;
          if (data[0] > 128) frame |= 1 << bit;
        }
        return frame;
      };
      const options = { width: 640, height: 360 };
      await preview.request(canvas, project, 0, options);
      check(readFrame() === 0, 'Fixture did not decode frame zero');

      async function play(start, duration, activeProject = project) {
        const samples = [],
          requests = [],
          before = preview.getStats();
        const clip = activeProject.clips[0];
        const begun = performance.now();
        await new Promise((resolve) => {
          const tick = () => {
            const elapsed = (performance.now() - begun) / 1000;
            if (elapsed >= duration) {
              resolve();
              return;
            }
            const wanted = start + elapsed;
            requests.push(
              preview
                .request(canvas, activeProject, wanted, { ...options, playing: true })
                .then((committed) => {
                  if (committed)
                    samples.push({
                      wanted,
                      actual: clip.start + (readFrame() / 30 - clip.inPoint) / clip.speed,
                      elapsed: (performance.now() - begun) / 1000,
                    });
                }),
            );
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        await Promise.all(requests);
        const steady = samples.filter((sample) => sample.elapsed > 0.4);
        const lags = steady
          .map((sample) => Math.abs(start + sample.elapsed - sample.actual))
          .sort((a, b) => a - b);
        return {
          samples: samples.length,
          uniqueFrames: new Set(samples.map((sample) => sample.actual)).size,
          seeks: preview.getStats().seeks - before.seeks,
          worstLagSeconds: Math.max(...lags),
          p95LagSeconds: lags[Math.floor(lags.length * 0.95)],
          last: samples.at(-1),
        };
      }

      const playback = await play(0.5, 3.5);
      check(
        playback.uniqueFrames >= 55,
        `Playback froze/repeated frames: ${JSON.stringify(playback)}`,
      );
      check(playback.seeks <= 6, `Continuous playback kept seeking: ${JSON.stringify(playback)}`);
      check(
        playback.p95LagSeconds < 0.25 && playback.worstLagSeconds < 0.4,
        `Playback drifted from the timeline: ${JSON.stringify(playback)}`,
      );

      preview.pause();
      check(
        preview.getStats().playingVideos === 0,
        'Leaving the editor did not pause the native decoder',
      );
      const pausedFrame = readFrame();
      await wait(160);
      check(readFrame() === pausedFrame, 'Paused preview changed by itself');

      // A cold long-GOP seek is allowed to decode first; the following playback must
      // recover to the timeline without repeatedly restarting that expensive seek.
      const jump = await play(8, 1.8);
      check(
        jump.uniqueFrames >= 20 &&
          jump.seeks <= 2 &&
          Math.abs(jump.last.actual - (8 + jump.last.elapsed)) < 0.25,
        `Playback jump failed: ${JSON.stringify(jump)}`,
      );
      readinessDelay = 500;
      const delayedReadiness = await play(4, 3.8);
      readinessDelay = 0;
      check(
        delayedReadiness.uniqueFrames >= 35 &&
          delayedReadiness.seeks <= 2 &&
          Math.abs(delayedReadiness.last.actual - (4 + delayedReadiness.last.elapsed)) < 0.25,
        `Slow decoder readiness caused repeated seeks: ${JSON.stringify(delayedReadiness)}`,
      );

      const scrubStart = performance.now(),
        scrubRequests = [],
        scrubFrames = [];
      let i = 0;
      while (performance.now() - scrubStart < 1500) {
        const target = (((i++ * 67) % 340) + 0.1) / 30;
        scrubRequests.push(
          preview.request(canvas, project, target, options).then((committed) => {
            if (committed) scrubFrames.push(readFrame());
          }),
        );
        await wait(4);
      }
      const settled = preview.request(canvas, project, 8.5, options);
      await Promise.all([...scrubRequests, settled]);
      check(Math.abs(readFrame() - 255) <= 1, `Scrub settled on obsolete frame ${readFrame()}`);
      check(
        new Set(scrubFrames).size >= 5,
        `Sustained scrubbing starved decoded-frame commits: ${scrubFrames.length}`,
      );
      await wait(120);
      check(Math.abs(readFrame() - 255) <= 1, 'Late seek overwrote the final scrub frame');
      check(preview.getStats().playingVideos === 0, 'Scrubbing left a video playing');

      const faster = {
        ...project,
        clips: [{ ...project.clips[0], speed: 2, duration: 6 }],
      };
      const doubleSpeed = await play(1, 1.2, faster);
      check(
        doubleSpeed.uniqueFrames >= 25 && doubleSpeed.p95LagSeconds < 0.3 && doubleSpeed.seeks <= 3,
        `Preview ignored or repeatedly sought the clip speed: ${JSON.stringify(doubleSpeed)}`,
      );
      preview.pause();

      const output = document.createElement('canvas'),
        strict = [];
      for (const time of [1 / 30, 7.1, 10.5, 0.2]) {
        await api.renderProject(output, project, time, options);
        const frame = readFrame(output);
        strict.push({ time, frame });
        check(
          Math.abs(frame - Math.floor(time * 30 + 0.001)) <= 1,
          `Strict export skipped source frame at ${time}: ${frame}`,
        );
      }
      await Promise.all([
        preview.request(canvas, project, 2, { ...options, playing: true }),
        api.renderProject(output, project, 9, options),
      ]);
      check(
        Math.abs(readFrame(output) - 270) <= 1,
        'Native preview playback disturbed strict export decoder',
      );
      preview.pause();
      const hidden = {
        ...project,
        tracks: project.tracks.map((track) => ({ ...track, hidden: true })),
      };
      await preview.request(canvas, hidden, 2, { ...options, playing: true });
      check(preview.getStats().playingVideos === 0, 'Hidden clip continued decoding playback');
      const relinked = { ...project, assets: [{ ...asset, url: videoUrl + '#relinked' }] };
      const pendingPlayback = preview.request(canvas, relinked, 9, { ...options, playing: true });
      check(videoElements[0].paused, 'Relinking an asset left its old decoder playing');
      preview.pause();
      await pendingPlayback;
      await wait(100);
      check(
        videoElements.every((element) => element.paused),
        'Pending seek restarted playback after pause',
      );
      const stats = preview.getStats();
      preview.dispose();
      api.clearMediaCache();
      document.createElement = createElement;
      return {
        fixture: project,
        playback,
        jump,
        delayedReadiness,
        doubleSpeed,
        scrubCommitted: scrubFrames.length,
        scrubDistinctFrames: new Set(scrubFrames).size,
        strict,
        stats,
      };
    }, pathToFileURL(video).href);
    const fixture = report.renderer.fixture;
    delete report.renderer.fixture;
    await app.close();
    app = undefined;
    if (!process.argv.includes('--renderer-only')) {
      fixture.name = 'Continuous playback regression';
      fixture.assets[0].path = video;
      fixture.assets[0].url = 'freecut-media://asset/fixture';
      const projectFile = path.join(directory, 'playback.freecut');
      await fs.writeFile(projectFile, JSON.stringify(fixture));
      const application = path.join(directory, 'application.cjs');
      await fs.writeFile(
        application,
        `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'app-profile'))});app.setPath('sessionData',${JSON.stringify(path.join(directory, 'app-profile'))});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
      );
      app = await _electron.launch({ args: [application], cwd: root, env });
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, projectFile);
      const editor = await app.firstWindow();
      editor.on('pageerror', (error) => report.rendererErrors.push(error.message));
      await editor.setViewportSize({ width: 1400, height: 950 });
      await editor.waitForFunction(
        () =>
          document.querySelector('button[title="打开工程 Ctrl+O"]') ||
          [...document.querySelectorAll('button')].some((button) =>
            button.textContent.trim().startsWith('新建项目'),
          ),
      );
      const create = editor.getByRole('button', { name: /^新建项目/ });
      if (await create.count()) await create.click();
      const skip = editor.getByRole('button', { name: '跳过引导', exact: true });
      if (await skip.count()) await skip.click();
      await editor.evaluate(() => {
        const createElement = document.createElement.bind(document);
        window.__playbackVideos = [];
        document.createElement = function (tag, options) {
          const element = createElement(tag, options);
          if (tag === 'video') window.__playbackVideos.push(element);
          return element;
        };
        window.__readPreviewFrame = () => {
          const canvas = document.querySelector('canvas[aria-label="视频预览"]');
          if (!canvas || !canvas.width || !canvas.height) return -1;
          const pixels = canvas
            .getContext('2d')
            .getImageData(0, Math.floor((24 * canvas.height) / 720), canvas.width, 1).data;
          let frame = 0;
          for (let bit = 0; bit < 9; bit++)
            if (pixels[Math.floor(((bit * 80 + 40) * canvas.width) / 1280) * 4] > 128)
              frame |= 1 << bit;
          return frame;
        };
      });
      await editor.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
      await expect(editor.getByLabel('工程名称', { exact: true })).toHaveValue(fixture.name);
      await expect
        .poll(() => editor.evaluate(() => window.__readPreviewFrame()), { timeout: 15000 })
        .toBe(0);
      const playButton = editor.getByTitle('播放 / 暂停 Space', { exact: true });
      const uiResults = [];
      for (const layout of ['professional', 'mobile']) {
        if (layout === 'mobile')
          await editor.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
        await editor.getByTitle('回到起点', { exact: true }).click();
        await expect.poll(() => editor.evaluate(() => window.__readPreviewFrame())).toBe(0);
        await editor.evaluate(() => {
          window.__uiPlayback = { running: true, samples: [], begun: performance.now() };
          function sample() {
            const state = window.__uiPlayback;
            if (!state.running) return;
            const parts = document
              .querySelector('.time-readout b')
              .textContent.split(':')
              .map(Number);
            state.samples.push({
              wall: (performance.now() - state.begun) / 1000,
              frame: window.__readPreviewFrame(),
              timeline: parts[0] * 60 + parts[1] + parts[2] / 30,
            });
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
        await playButton.click();
        await editor.waitForTimeout(3200);
        await playButton.click();
        const measured = await editor.evaluate(() => {
          const state = window.__uiPlayback;
          state.running = false;
          const samples = state.samples.filter((sample) => sample.timeline > 0.4);
          const lags = samples
            .map((sample) => Math.abs(sample.timeline - sample.frame / 30))
            .sort((a, b) => a - b);
          return {
            distinctFrames: new Set(samples.map((sample) => sample.frame)).size,
            samples: samples.length,
            p95LagSeconds: lags[Math.floor(lags.length * 0.95)],
            worstLagSeconds: Math.max(...lags),
            last: samples.at(-1),
          };
        });
        assert(
          measured.distinctFrames >= 55,
          `${layout} editor kept showing stale frames: ${JSON.stringify(measured)}`,
        );
        assert(
          measured.last.timeline >= 2.9 && measured.last.timeline < 4,
          `${layout} playback clock lost wall time: ${JSON.stringify(measured)}`,
        );
        assert(
          measured.p95LagSeconds < 0.25 && measured.worstLagSeconds < 0.4,
          `${layout} preview drifted from its displayed timeline: ${JSON.stringify(measured)}`,
        );
        await editor.waitForTimeout(180);
        assert(
          await editor.evaluate(() => window.__playbackVideos.every((video) => video.paused)),
          `${layout} pause left a native decoder playing`,
        );
        uiResults.push({ layout, ...measured });
      }
      await playButton.click();
      await editor.waitForTimeout(150);
      await editor.getByTitle('返回首页', { exact: true }).click();
      await expect(editor.locator('canvas[aria-label="视频预览"]')).toHaveCount(0);
      await expect
        .poll(() => editor.evaluate(() => window.__playbackVideos.every((video) => video.paused)))
        .toBe(true);
      report.editor = { results: uiResults, leavingEditorPausesDecoders: true };
    }
    assert.equal(report.rendererErrors.length, 0, 'Renderer errors occurred during real playback');
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (app) await app.close();
    await fs.writeFile(
      path.join(directory, 'playback-report.json'),
      JSON.stringify(report, null, 2),
    );
  }
}
