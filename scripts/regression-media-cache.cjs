'use strict';
// Actual Electron decoding verifies preview-only proxies, original audio and geometry.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util'), { execFile } = require('node:child_process');
const { _electron } = require('playwright'), { build } = require('esbuild');
const root = path.resolve(__dirname, '..'), run = promisify(execFile);
main().catch(error => { console.error(error); process.exitCode = 1; });
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'freecut-proxy-regression-'));
  const original = path.join(directory, 'original-red.mp4'), proxy = path.join(directory, 'proxy-blue.mp4');
  const ffmpeg = path.join(root, 'resources/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  await run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=red:s=1280x720:r=30:d=2','-f','lavfi','-i','sine=frequency=400:duration=2','-c:v','libx264','-threads','2','-preset','ultrafast','-c:a','aac','-shortest',original], { windowsHide:true });
  // Intentionally a different coded aspect: compositing must use original geometry.
  await run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=blue:s=160x100:r=30:d=2','-an','-c:v','libx264','-threads','2','-preset','ultrafast',proxy], { windowsHide:true });
  const entry = path.join(directory, 'entry.ts');
  await fs.writeFile(entry, `export {renderProject,createPreviewRenderer,setPreviewMediaProxies,syncAudio,clearMediaCache} from ${JSON.stringify(path.join(root,'src/core/renderer.ts'))}; export {createProject,createClip} from ${JSON.stringify(path.join(root,'src/core/project.ts'))};`);
  await build({ entryPoints:[entry], outfile:path.join(directory,'preview.js'), bundle:true, format:'iife', globalName:'MediaCacheTest', platform:'browser' });
  await fs.writeFile(path.join(directory,'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="preview"></canvas><canvas id="export"></canvas><script src="preview.js"></script>');
  const bootstrap = path.join(directory,'harness.cjs');
  await fs.writeFile(bootstrap, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(directory,'profile'))});app.whenReady().then(()=>{new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}}).loadFile(${JSON.stringify(path.join(directory,'index.html'))});});`);
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.PORTABLE_EXECUTABLE_DIR;
  let app; const report = { directory, passed:false, result:null };
  try {
    app = await _electron.launch({ args:[bootstrap], cwd:root, env });
    const page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.MediaCacheTest));
    report.result = await page.evaluate(async ({ originalUrl, proxyUrl, assetPath }) => {
      const api = window.MediaCacheTest, project = api.createProject(); project.width=320; project.height=320;
      // Encoded metadata can differ from browser display dimensions after rotation/SAR.
      const asset={ id:'source', name:'Original video', kind:'video', path:assetPath, url:originalUrl, duration:2, width:720, height:1280 };
      project.assets=[asset]; project.clips=[api.createClip('video', project.tracks.find(track => track.kind==='video').id, {assetId:asset.id,duration:2})];
      const originalProject=JSON.stringify(project), preview=api.createPreviewRenderer(), canvas=document.querySelector('#preview'), exported=document.querySelector('#export');
      const pixel=(canvas,x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data];
      const color=(rgba)=>rgba[0]>150&&rgba[2]<80?'red':rgba[2]>150&&rgba[0]<80?'blue':'other';
      const checks=[]; const check=(ok,label)=>{ if(!ok)throw Error(label);checks.push(label); };
      await preview.request(canvas,project,.25); check(color(pixel(canvas,160,160))==='red','Original preview decodes source');
      api.setPreviewMediaProxies([{assetPath,proxy:{url:proxyUrl}}]);
      await preview.request(canvas,project,.25); check(color(pixel(canvas,160,160))==='blue','Paused preview refreshes to proxy at same timestamp');
      await api.renderProject(exported,project,.25); check(color(pixel(exported,160,160))==='red','Strict frame export ignores preview proxy');
      for(const y of [60,69,70,80,249,250,260]) check((color(pixel(canvas,160,y))==='blue')===(color(pixel(exported,160,y))==='red'),`Original geometry preserved at y=${y}`);
      const audioUrls=[], proto=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
      Object.defineProperty(HTMLMediaElement.prototype,'src',{...proto,set(url){if(this.tagName==='AUDIO')audioUrls.push(url);proto.set.call(this,url);}});
      api.syncAudio(project,.25,true); await new Promise(resolve=>setTimeout(resolve,100)); api.syncAudio(project,.25,false);
      check(audioUrls.length>0&&audioUrls.every(url=>url===originalUrl),'Preview audio always opens original source');
      api.setPreviewMediaProxies([]); await preview.request(canvas,project,.25); check(color(pixel(canvas,160,160))==='red','Disabling smooth preview returns to original immediately');
      check(JSON.stringify(project)===originalProject,'Runtime proxies never mutate saved project');
      const stats=preview.getStats(); preview.dispose(); api.clearMediaCache(); return { checks,stats,audioUrls };
    }, { originalUrl:pathToFileURL(original).href,proxyUrl:pathToFileURL(proxy).href,assetPath:original });
    assert(report.result.checks.length>=12); report.passed=true; console.log(JSON.stringify(report.result,null,2));
  } finally {
    if(app) await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
    const file=path.join(directory,'media-cache-regression-result.json'); await fs.writeFile(file,JSON.stringify(report,null,2)); console.log(`REPORT: ${file}`);
    const output=path.join(root,'artifacts','media-cache'); await fs.mkdir(output,{recursive:true}); await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  }
}
