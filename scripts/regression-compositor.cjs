'use strict';
// Actual Electron renderer + host export, generated media and isolated profile.
// Compares native multi-layer output with the existing strict Canvas route.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron, expect } = require('@playwright/test');
const { build } = require('esbuild');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const ffmpeg =
  process.env.FFMPEG_BIN ||
  path.join(root, 'resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-compositor-'));
  const report = {
    directory,
    platform: process.platform,
    startedAt: new Date().toISOString(),
    checks: [],
    passed: false,
  };
  const source = path.join(directory, 'motion.mp4');
  const command = (args, options = {}) =>
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    });
  await command([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=640x360:r=30:d=4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=500:duration=4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:duration=4',
    '-filter_complex',
    '[1:a][2:a]join=inputs=2:channel_layout=stereo[a]',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    source,
  ]);
  const bundle = await build({
    stdin: {
      contents: `
    export {renderProject} from './src/core/renderer.ts';
    export {createProject,createClip} from './src/core/project.ts';
    export {prepareExportRasterLayers} from './src/core/export-preparation.ts';`,
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'CompositorTest',
    platform: 'browser',
  });
  const bootstrap = path.join(directory, 'launch.cjs');
  await fs.writeFile(
    bootstrap,
    `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});app.setPath('sessionData',${JSON.stringify(path.join(directory, 'session'))});require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  let app;
  try {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env });
    await app.evaluate(({ dialog }, input) => {
      globalThis.exportTarget = '';
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.exportTarget });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, source);
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.freecut);
    await page.evaluate((code) => {
      (0, eval)(code);
      window.CompositorTest = CompositorTest;
    }, bundle.outputFiles[0].text);
    await page.evaluate(async () => {
      const api = window.CompositorTest;
      const assets = await window.freecut.importMedia();
      const p = api.createProject();
      p.name = 'Native layered regression';
      p.width = 640;
      p.height = 360;
      p.background = '#17232f';
      p.assets = assets;
      const main = p.tracks.find((t) => t.kind === 'video').id;
      const overlay = p.tracks.find((t) => t.kind === 'overlay').id;
      p.clips = [
        api.createClip('video', main, { assetId: assets[0].id, duration: 4 }),
        api.createClip('shape', overlay, {
          name: 'Moving badge',
          duration: 4,
          color: '#153c51',
          transform: { scale: 0.32, opacity: 0.8, y: 78, rotation: 8 },
          fadeIn: 0.3,
          fadeOut: 0.4,
        }),
        api.createClip('text', overlay, {
          name: 'Bezier title',
          duration: 4,
          text: {
            text: 'FreeCut',
            fontSize: 36,
            align: 'center',
            bold: true,
            color: '#ffffff',
            background: 'transparent',
            stroke: false,
          },
          transform: { y: 74 },
          fadeIn: 0.3,
          fadeOut: 0.4,
          keyframes: {
            x: [
              { id: 'x0', time: 0, value: -140, easing: 'bezier', curve: [0.16, 1, 0.3, 1] },
              { id: 'x1', time: 4, value: 140, easing: 'linear' },
            ],
          },
        }),
      ];
      window.compositorProject = p;
    });
    const outputs = {};
    for (const pipeline of ['auto', 'frames']) {
      const output = path.join(directory, `${pipeline}.mp4`);
      outputs[pipeline] = output;
      await app.evaluate((_, file) => {
        globalThis.exportTarget = file;
      }, output);
      const started = Date.now();
      const result = await page.evaluate(async (pipeline) => {
        const api = window.CompositorTest,
          p = window.compositorProject;
        const rasterLayers =
          pipeline === 'auto' ? await api.prepareExportRasterLayers(p, 640, 360) : undefined;
        const result = await window.freecut.beginExport({
          project: p,
          width: 640,
          height: 360,
          fps: 30,
          duration: 4,
          quality: 'high',
          format: 'mp4',
          frameFormat: 'rgba',
          pipeline,
          rasterLayers,
        });
        if (!result) throw Error('Export unexpectedly cancelled');
        if (result.pipeline === 'frames') {
          const canvas = document.createElement('canvas');
          for (let frame = 0; frame < 120; frame++) {
            await api.renderProject(canvas, p, frame / 30, { width: 640, height: 360 });
            const rgba = canvas.getContext('2d').getImageData(0, 0, 640, 360).data;
            await window.freecut.writeFrame({
              jobId: result.jobId,
              index: frame,
              bytes: new Uint8Array(rgba.buffer),
            });
          }
        }
        await window.freecut.finishExport(result.jobId);
        return { pipeline: result.pipeline, textures: rasterLayers?.length ?? 0 };
      }, pipeline);
      assert.equal(result.pipeline, pipeline === 'auto' ? 'native' : 'frames');
      if (pipeline === 'auto') assert.equal(result.textures, 2);
      report[pipeline] = {
        ...result,
        elapsedMs: Date.now() - started,
        bytes: (await fs.stat(output)).size,
      };
      report.checks.push(`${pipeline}: actual host export completed`);
      console.log(JSON.stringify({ pipeline, ...report[pipeline] }));
    }
    report.pixels = [];
    for (const frame of [6, 39, 87, 113]) {
      const pixels = await Promise.all(
        ['auto', 'frames'].map(async (mode) => {
          const { stdout } = await command(
            [
              '-i',
              outputs[mode],
              '-vf',
              `select=eq(n\\,${frame})`,
              '-frames:v',
              '1',
              '-f',
              'rawvideo',
              '-pix_fmt',
              'rgb24',
              'pipe:1',
            ],
            { encoding: 'buffer' },
          );
          assert.equal(stdout.length, 640 * 360 * 3);
          return stdout;
        }),
      );
      let error = 0,
        large = 0;
      for (let i = 0; i < pixels[0].length; i++) {
        const e = Math.abs(pixels[0][i] - pixels[1][i]);
        error += e;
        if (e > 32) large++;
      }
      const mae = error / pixels[0].length,
        largeFraction = large / pixels[0].length;
      report.pixels.push({ frame, mae, largeFraction });
      assert(
        mae < 6 && largeFraction < 0.055,
        `Native/Canvas visual mismatch at ${frame}: MAE=${mae}, large=${largeFraction}`,
      );
    }
    report.checks.push(
      'native title, shape, position curve, fade and stacking match Canvas pixels',
    );
    const styledTextFallback = await page.evaluate(async () => {
      const p = structuredClone(window.compositorProject);
      const text = p.clips.find((c) => c.kind === 'text');
      text.text.stroke = true;
      const stroke = await window.CompositorTest.prepareExportRasterLayers(p, 640, 360);
      text.text.stroke = false;
      text.text.background = '#111111';
      const background = await window.CompositorTest.prepareExportRasterLayers(p, 640, 360);
      text.text.background = 'transparent';
      const cancelled = await window.CompositorTest.prepareExportRasterLayers(
        p,
        640,
        360,
        () => true,
      );
      return {
        stroke: stroke === undefined,
        background: background === undefined,
        cancelled: cancelled === undefined,
      };
    });
    assert.deepEqual(styledTextFallback, { stroke: true, background: true, cancelled: true });
    report.checks.push(
      'overlapping styled-text alpha stays on the exact path; raster preparation obeys cancellation',
    );
    // Neither native compositing nor PNG upload can weaken the host validator.
    const rejected = await page.evaluate(async () => {
      try {
        await window.freecut.beginExport({
          project: window.compositorProject,
          width: 640,
          height: 360,
          fps: 30,
          duration: 4,
          quality: 'high',
          format: 'mp4',
          pipeline: 'auto',
          rasterLayers: [{ clipId: 'not-a-clip', bytes: new Uint8Array([1, 2, 3]) }],
        });
        return false;
      } catch {
        return true;
      }
    });
    assert(rejected);
    report.checks.push('unknown raster clip rejected by the host');
    report.passed = true;
  } finally {
    if (app) await app.close().catch(() => {});
    const artifact = path.join(root, 'artifacts', 'compositor');
    await fs.mkdir(artifact, { recursive: true });
    await fs.writeFile(path.join(artifact, 'verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
