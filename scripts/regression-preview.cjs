'use strict';
// Real Electron/video pixel regression. No network; all fixtures use a new temporary profile.
// npm run build && node scripts/regression-preview.cjs
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron } = require('playwright');
const { expect } = require('@playwright/test');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
const run = promisify(execFile);
main().catch(error => { console.error(error); process.exitCode = 1; });
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-preview-regression-'));
  const video = path.join(directory, 'four-colors.mp4');
  const ffmpeg = path.join(root, 'resources', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...['red', 'green', 'blue', 'yellow'].flatMap(color => ['-f', 'lavfi', '-i', `color=${color}:s=320x180:r=30:d=1`]), '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-g', '90', '-pix_fmt', 'yuv420p', video], { windowsHide: true });
  const entry = path.join(directory, 'entry.ts');
  await fs.writeFile(entry, `export {renderProject,createPreviewRenderer,clearMediaCache} from ${JSON.stringify(path.join(root, 'src/core/renderer.ts'))}; export {createProject,createClip} from ${JSON.stringify(path.join(root, 'src/core/project.ts'))};`);
  await build({ entryPoints: [entry], outfile: path.join(directory, 'preview.js'), bundle: true, format: 'iife', globalName: 'PreviewTest', platform: 'browser' });
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><title>FreeCut Preview Regression</title><canvas id="preview"></canvas><script src="preview.js"></script>');
  const bootstrap = path.join(directory, 'harness.cjs');
  await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory,'harness-profile'))});app.whenReady().then(()=>{const window=new BrowserWindow({webPreferences:{backgroundThrottling:false}});window.loadFile(${JSON.stringify(path.join(directory,'index.html'))});});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_DIR;
  let app;
  const report = { directory, platform: process.platform, checks: [], passed: false };
  try {
    app = await _electron.launch({ args: [bootstrap], cwd: root, env });
    const page = await app.firstWindow();
    const result = await page.evaluate(async videoUrl => {
      const api = window.PreviewTest;
      const createElement = document.createElement.bind(document);
      let videoElements = 0;
      document.createElement = function(tag, options) { if (tag === 'video') videoElements++; return createElement(tag, options); };
      const project = api.createProject(); project.width = 320; project.height = 180;
      project.assets = [{ id: 'colors', name: 'Four colors', kind: 'video', url: videoUrl, duration: 4, width: 320, height: 180 }];
      project.clips = [api.createClip('video', project.tracks.find(track => track.kind === 'video').id, { assetId: 'colors', duration: 4 })];
      let canvas = document.querySelector('canvas');
      const preview = api.createPreviewRenderer();
      const pixel = target => [...target.getContext('2d').getImageData(target.width / 2, target.height / 2, 1, 1).data];
      const color = value => value[0] > 160 && value[1] > 160 ? 'yellow' : value[0] > 160 && value[1] < 80 ? 'red' : value[2] > 160 && value[0] < 80 ? 'blue' : value[1] > 80 && value[0] < 80 ? 'green' : 'black-or-other';
      const check = (condition, message) => { if (!condition) throw Error(message); };
      await preview.request(canvas, project, .2);
      check(color(pixel(canvas)) === 'red', 'Initial decoded video is not red');
      const toBlue = preview.request(canvas, project, 2.2);
      check(color(pixel(canvas)) === 'red', 'Pending seek cleared the visible frame');
      await toBlue;
      check(color(pixel(canvas)) === 'blue', 'Completed seek did not commit blue');
      let observedBlack = 0, monitor = true;
      const sample = () => { if (!monitor) return; if (color(pixel(canvas)) === 'black-or-other') observedBlack++; requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
      const requests = [];
      for (let i = 0; i < 48; i++) { requests.push(preview.request(canvas, project, (i % 4) + .25)); await new Promise(resolve => setTimeout(resolve, 2)); }
      requests.push(preview.request(canvas, project, .25), preview.request(canvas, project, 2.25));
      requests.push(preview.request(canvas, project, 1.25));
      const outcomes = await Promise.all(requests);
      check(color(pixel(canvas)) === 'green', 'Rapid scrub committed a stale frame');
      await new Promise(resolve => setTimeout(resolve, 80));
      check(color(pixel(canvas)) === 'green', 'Late obsolete seek overwrote the latest frame');
      check(outcomes.some(committed => !committed), 'Scrub did not exercise cancellation');
      for (let i = 0; i < 12; i++) {
        canvas.style.width = i % 2 ? '240px' : '640px';
        await preview.request(canvas, project, 1.25);
        check(color(pixel(canvas)) === 'green', 'CSS layout change lost the frame');
      }
      const replacement = document.createElement('canvas'); canvas.replaceWith(replacement); canvas = replacement;
      const remounted = preview.request(canvas, project, 3.25);
      check(color(pixel(canvas)) === 'green', 'Remounted canvas did not inherit previous frame');
      await remounted;
      check(color(pixel(canvas)) === 'yellow', 'Remounted canvas did not render latest time');
      check(videoElements === 1, 'Layout/canvas changes discarded the cached video decoder');
      monitor = false; check(observedBlack === 0, 'Black frames observed during scrubbing');
      const output = document.createElement('canvas');
      const strict = [];
      for (const time of [.25, 1.25, 2.25, 3.25, .25]) { await api.renderProject(output, project, time); strict.push(color(pixel(output))); }
      check(strict.join(',') === 'red,green,blue,yellow,red', 'Strict export renderer skipped or reused wrong frames');
      await Promise.all([preview.request(canvas, project, 1.25), api.renderProject(output, project, 2.25)]);
      check(color(pixel(canvas)) === 'green' && color(pixel(output)) === 'blue', 'Preview seeks interfered with strict export');
      let failed = false;
      try { await preview.request(canvas, { ...project, assets: project.assets.map(asset => ({ ...asset, missing: true })) }, 1.25); } catch { failed = true; }
      check(failed && color(pixel(canvas)) === 'green', 'Failed media request erased the preceding frame');
      preview.dispose(); api.clearMediaCache();
      document.createElement = createElement;
      return { checks: ['atomic pending-frame preservation', 'latest-only fast scrub and stale completion suppression', 'CSS layout switches and canvas replacement retain one video decoder', 'strict export sequential pixels and independent concurrent preview', 'media failure preserves preceding frame'], observedBlack, cancelled: outcomes.filter(value => !value).length, strict };
    }, pathToFileURL(video).href);
    report.checks.push(...result.checks); report.renderer = result;
    await app.close(); app = undefined;
    if (!process.argv.includes('--renderer-only')) {
      const fixture = makeProject(video);
      fixture.assets[0].url = 'freecut-media://asset/fixture';
      const fixtureFile = path.join(directory, 'preview.freecut'); await fs.writeFile(fixtureFile, JSON.stringify(fixture));
      const launch = path.join(directory, 'app.cjs');
      await fs.writeFile(launch, `const {app}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory,'app-profile'))});app.setPath('sessionData',${JSON.stringify(path.join(directory,'app-profile'))});require(${JSON.stringify(path.join(root,'electron/main.cjs'))});`);
      app = await _electron.launch({ args: [launch], cwd: root, env });
      await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixtureFile);
      const editor = await app.firstWindow(); await editor.setViewportSize({ width: 1400, height: 950 });
      await editor.waitForFunction(() => document.querySelector('button[title="打开工程 Ctrl+O"]') || [...document.querySelectorAll('button')].some(button => button.textContent.trim().startsWith('新建项目')));
      const start = editor.getByRole('button', { name: /^新建项目/ });
      if (await start.count()) await start.click();
      const skip = editor.getByRole('button', { name: '跳过引导', exact: true }); if (await skip.count()) await skip.click();
      await editor.getByTitle('打开工程 Ctrl+O', { exact: true }).click();
      const frameColor = () => editor.locator('canvas[aria-label="视频预览"]').evaluate(canvas => { const p=canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data;return p[0]>160&&p[1]<80?'red':p[2]>160&&p[0]<80?'blue':p[1]>80&&p[0]<80?'green':'other'; });
      await expect.poll(frameColor, { timeout: 15000 }).toBe('red');
      for (let i=0;i<8;i++) { await editor.getByTitle('切换专业布局 / 手机风格', { exact: true }).click(); await expect.poll(frameColor).toBe('red'); }
      report.checks.push('actual editor professional/mobile layout switches preserve decoded frame');
      await editor.evaluate(() => {
        window.__previewSamples = { running: true, black: 0 };
        function sample() { const state=window.__previewSamples;if(!state.running)return;const c=document.querySelector('canvas[aria-label="视频预览"]');const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;if(p[0]<20&&p[1]<20&&p[2]<20)state.black++;requestAnimationFrame(sample); }
        requestAnimationFrame(sample);
      });
      for (let layout=0;layout<2;layout++) {
        await editor.getByTitle('切换专业布局 / 手机风格', { exact: true }).click();
        const bounds = await editor.locator('.ruler').boundingBox();
        const clip = await editor.locator('.timeline-clip').boundingBox();
        assert(bounds && clip, 'Timeline is not visible');
        const zoom=clip.width/4;
        await editor.mouse.move(bounds.x+.25*zoom,bounds.y+bounds.height/2);await editor.mouse.down();
        for(let i=0;i<20;i++)await editor.mouse.move(bounds.x+((i%3)+.25)*zoom,bounds.y+bounds.height/2);
        await editor.mouse.move(bounds.x+2.25*zoom,bounds.y+bounds.height/2);await editor.mouse.up();
        await expect.poll(frameColor, { timeout: 10000 }).toBe('blue');
      }
      const uiBlackFrames = await editor.evaluate(() => { window.__previewSamples.running=false;return window.__previewSamples.black; });
      assert.equal(uiBlackFrames,0,'Real editor scrub exposed a black frame');
      report.uiBlackFrames=uiBlackFrames;
      report.checks.push('actual editor pointer scrubbing in both layouts commits latest video pixels without black frames');
      await editor.screenshot({ path: path.join(directory,'editor-preview.png') });
    }
    report.passed = true; console.log(JSON.stringify(report, null, 2));
  } finally { if(app)await app.close(); await fs.writeFile(path.join(directory,'preview-report.json'),JSON.stringify(report,null,2)); }
}
function makeProject(video) {
  return {version:1,id:'preview-test',name:'Preview pixel regression',width:320,height:180,fps:30,background:'#000000',tracks:[{id:'overlay',name:'Overlay',kind:'overlay',hidden:false,muted:false,locked:false},{id:'video',name:'Video',kind:'video',hidden:false,muted:false,locked:false},{id:'audio',name:'Audio',kind:'audio',hidden:false,muted:false,locked:false}],assets:[{id:'colors',name:'Four colors',kind:'video',path:video,url:pathToFileURL(video).href,duration:4,width:320,height:180}],clips:[{id:'color-clip',name:'Four colors',kind:'video',trackId:'video',assetId:'colors',start:0,duration:4,inPoint:0,speed:1,transform:{x:0,y:0,scale:1,rotation:0,opacity:1,volume:1},keyframes:{},effects:{brightness:1,contrast:1,saturation:1,hue:0,blur:0,grayscale:0,sepia:0,vignette:0,pixelate:0,chroma:false,chromaColor:'#00ff00',chromaThreshold:80,flipX:false,flipY:false,mask:'none',maskSize:1},fadeIn:0,fadeOut:0}]};
}
