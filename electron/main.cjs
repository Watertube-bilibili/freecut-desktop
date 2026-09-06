'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createMediaLibrary, MEDIA_EXTENSIONS, assertTrustedSender } = require('./media.cjs');
const { createExporter, validateProject, validateOptions } = require('./export.cjs');

const portable = process.platform === 'win32' && Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
if (portable) {
  const data = path.join(process.env.PORTABLE_EXECUTABLE_DIR,'FreeCutData');
  try { fs.mkdirSync(data,{recursive:true}); fs.accessSync(data,fs.constants.W_OK); app.setPath('userData',data); }
  catch { dialog.showErrorBox('便携数据目录不可写','请把 FreeCut 放到有写入权限的文件夹后重新启动。'); app.exit(1); }
}
protocol.registerSchemesAsPrivileged([{ scheme:'freecut-media', privileges:{ standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, stream:true } }]);

const dev = !app.isPackaged && process.argv.includes('--dev');
const entry = path.join(__dirname,'..','dist','index.html');
const ffmpegPath = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname,'..','resources'),'ffmpeg',process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const media = createMediaLibrary(ffmpegPath);
const selectedPaths = new Set();
let window = null, exporter = null, chattts = null, quitting = false;
function validateSender(event) {
  return assertTrustedSender(event,window?.webContents,dev ? 'http://127.0.0.1:5173/' : pathToFileURL(entry).href);
}
function handle(channel, callback) { ipcMain.handle(channel,async(event,...args) => { validateSender(event); return callback(...args); }); }
function safeName(name) { return String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,120) || 'FreeCut'; }
async function atomicWrite(destination, data) {
  const temporary = path.join(path.dirname(destination),`.freecut-save-${crypto.randomUUID()}.tmp`);
  try { const file=await fsp.open(temporary,'wx'); try { await file.writeFile(data,'utf8'); await file.sync(); } finally { await file.close(); } await fsp.rename(temporary,destination); }
  finally { await fsp.rm(temporary,{force:true}).catch(() => {}); }
}
async function importPath(input) { const asset=await media.importPath(input); selectedPaths.add(asset.path); return asset; }

function installIPC() {
  exporter=createExporter({ffmpegPath,resolveAsset:media.resolveAsset,temporaryRoot:app.getPath('temp'),emitProgress:(data) => { if(window && !window.isDestroyed())window.webContents.send('freecut:export-progress',data); }});
  handle('freecut:import-media',async() => {
    const result=await dialog.showOpenDialog(window,{ title:'导入视频、音频或图片',properties:['openFile','multiSelections'],filters:[{name:'媒体文件',extensions:[...MEDIA_EXTENSIONS].map((ext) => ext.slice(1))}] });
    if(result.canceled)return [];
    const assets=[], errors=[];
    for(const file of result.filePaths) { try { assets.push(await importPath(file)); } catch(error) { errors.push(`${path.basename(file)}：${error.message}`); } }
    if(errors.length)await dialog.showMessageBox(window,{type:'warning',title:'部分素材未能导入',message:errors.slice(0,10).join('\n')});
    return assets;
  });
  handle('freecut:save-project',async(project) => {
    validateProject(project);
    const result=await dialog.showSaveDialog(window,{title:'保存 FreeCut 工程',defaultPath:`${safeName(project.name)}.freecut`,filters:[{name:'FreeCut 工程',extensions:['freecut']}]});
    if(result.canceled || !result.filePath)return null;
    const saved=structuredClone(project);
    // Blob URLs and temporary access tokens are restored from verified file references on open.
    for(const asset of saved.assets) { asset.url=''; delete asset.thumbnail; }
    await atomicWrite(result.filePath,JSON.stringify(saved,null,2)); selectedPaths.add(result.filePath); return result.filePath;
  });
  handle('freecut:open-project',async() => {
    const result=await dialog.showOpenDialog(window,{title:'打开 FreeCut 工程',properties:['openFile'],filters:[{name:'FreeCut 工程',extensions:['freecut','json']}]});
    if(result.canceled || !result.filePaths[0])return null;
    const file=result.filePaths[0], stat=await fsp.stat(file);
    if(!stat.isFile() || stat.size>64*1024*1024)throw new Error('工程文件无效或超过 64 MB。');
    let project; try { project=JSON.parse(await fsp.readFile(file,'utf8')); } catch { throw new Error('工程文件不是有效的 JSON。'); }
    validateProject(project);
    for(const asset of project.assets) {
      const id=asset.id; asset.url=''; delete asset.thumbnail;
      if(!asset.path) { asset.missing=true; continue; }
      try { const restored=await importPath(asset.path); Object.assign(asset,restored,{id,missing:false}); }
      catch { asset.missing=true; }
    }
    selectedPaths.add(file); return project;
  });
  handle('freecut:begin-export',async(options) => {
    validateOptions(options);
    if(!fs.existsSync(ffmpegPath))throw new Error('内置 FFmpeg 未准备好。开发环境请执行 node scripts/prepare-ffmpeg.mjs。');
    const result=await dialog.showSaveDialog(window,{title:'导出视频',defaultPath:`${safeName(options.project.name)}.mp4`,filters:[{name:'MP4 视频',extensions:['mp4']}]});
    if(result.canceled || !result.filePath)return null;
    const output=result.filePath.toLowerCase().endsWith('.mp4') ? result.filePath : `${result.filePath}.mp4`;
    const comparable=(value) => process.platform==='win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if(options.project.assets.some((asset) => asset.path && comparable(asset.path)===comparable(output)))throw new Error('导出文件不能覆盖工程正在使用的素材。请选择另一个文件名。');
    selectedPaths.add(output); return exporter.begin(options,output);
  });
  handle('freecut:write-frame',(data) => exporter.writeFrame(data));
  handle('freecut:finish-export',(id) => exporter.finish(id));
  handle('freecut:cancel-export',(id) => exporter.cancel(id));
  handle('freecut:show-item',async(file) => { if(typeof file!=='string' || !selectedPaths.has(file))throw new Error('只能定位用户已选择的文件。'); shell.showItemInFolder(file); });
  handle('freecut:get-info',async() => ({version:app.getVersion(),platform:process.platform,ffmpeg:fs.existsSync(ffmpegPath),portable}));
  if(fs.existsSync(path.join(__dirname,'ai.cjs')))require('./ai.cjs').registerAI({ipcMain,app,dialog,ffmpegPath,importPath,validateSender,validateMediaPath:media.validateMediaPath});
  if(fs.existsSync(path.join(__dirname,'chattts.cjs')))chattts=require('./chattts.cjs').registerChatTTS({ipcMain,app,importPath,validateSender});
}

function createWindow() {
  window=new BrowserWindow({width:1600,height:980,minWidth:1100,minHeight:720,backgroundColor:'#101014',title:'自由剪辑 FreeCut',show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,spellcheck:false}});
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate',(event,url) => { if(url !== (dev ? 'http://127.0.0.1:5173/' : pathToFileURL(entry).href))event.preventDefault(); });
  window.webContents.on('will-attach-webview',(event) => event.preventDefault());
  window.once('ready-to-show',() => window.show());
  window.on('closed',() => { window=null; void exporter?.dispose(); });
  if(dev)void window.loadURL('http://127.0.0.1:5173/'); else void window.loadFile(entry);
}

app.whenReady().then(() => {
  protocol.handle('freecut-media',media.handleRequest);
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const csp=`default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: freecut-media:; media-src 'self' blob: freecut-media:; connect-src 'self' freecut-media:${dev ? ' ws://127.0.0.1:5173 http://127.0.0.1:5173' : ''}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details,callback) => callback({responseHeaders:{...details.responseHeaders,'Content-Security-Policy':[csp]}}));
  installIPC(); createWindow();
  app.on('activate',() => { if(BrowserWindow.getAllWindows().length===0)createWindow(); });
});
app.on('window-all-closed',() => { if(process.platform!=='darwin')app.quit(); });
app.on('before-quit',(event) => { if(quitting || !exporter)return; event.preventDefault(); quitting=true; void Promise.allSettled([exporter.dispose(),chattts?.dispose?.()]).finally(() => app.quit()); });
