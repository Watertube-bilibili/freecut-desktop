'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, session, shell } = require('electron');
if (app.isPackaged && (process.argv.includes('--installer') || process.argv.includes('--uninstall'))) {
  require(require('node:path').join(process.resourcesPath, 'freecut-installer', 'main.cjs'));
  return;
}
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createMediaLibrary, MEDIA_EXTENSIONS, assertTrustedSender } = require('./media.cjs');
const { createExporter, validateProject, validateOptions } = require('./export.cjs');
const { createCloseGuard } = require('./close-guard.cjs');
const { createRecentProjects } = require('./recent-projects.cjs');
const { createUpdater } = require('./updater.cjs');
const { prepareUpdateInstall } = require('./update-install.cjs');
const appVersion = require('../package.json').version;
let uiLanguage = 'zh-CN';
const uiText = (chinese, english) => uiLanguage === 'en' ? english : chinese;

const portable = process.platform === 'win32' && Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
if (portable) {
  const data = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'FreeCutData');
  try {
    fs.mkdirSync(data, { recursive: true });
    fs.accessSync(data, fs.constants.W_OK);
    app.setPath('userData', data);
  } catch {
    dialog.showErrorBox('便携数据目录不可写', '请把 FreeCut 放到有写入权限的文件夹后重新启动。');
    app.exit(1);
  }
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'freecut-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const dev = !app.isPackaged && process.argv.includes('--dev');
const entry = path.join(__dirname, '..', 'dist', 'index.html');
// loadFile and pathToFileURL encode characters such as ~ differently. Use one
// URL for loading, navigation and sender authentication, including 8.3 paths.
const entryURL = dev ? 'http://127.0.0.1:5173/' : pathToFileURL(entry).href;
const ffmpegPath = path.join(
  app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources'),
  'ffmpeg',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);
const media = createMediaLibrary(ffmpegPath);
const selectedPaths = new Set();
let window = null,
  exporter = null,
  chattts = null,
  ai = null,
  recentProjects = null,
  closeGuard = null,
  quitting = false,
  shutdown = null,
  disposing = null;
let updater = null,
  pendingUpdate = null,
  updateStarting = false,
  approvingQuit = false;
function deferUpdate() {
  if (pendingUpdate) {
    pendingUpdate = null;
    updater?.deferred();
  }
}
async function approveQuit(target, guard, reason) {
  if (approvingQuit) return;
  approvingQuit = true;
  try {
    if (pendingUpdate) {
      const launch = pendingUpdate;
      pendingUpdate = null;
      await launch();
      completeQuit();
    } else if (reason === 'quit') completeQuit();
    else if (!target.isDestroyed()) {
      approvingQuit = false;
      target.close();
    }
  } catch (error) {
      guard.resetApproval();
      updater.failed(error);
      if (!target.isDestroyed()) target.webContents.send('freecut:close-failed');
  } finally { approvingQuit = false; }
}
function validateSender(event) {
  return assertTrustedSender(
    event,
    window?.webContents,
    entryURL,
  );
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    validateSender(event);
    return callback(...args);
  });
}
function safeName(name) {
  return (
    String(name)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .slice(0, 120) || 'FreeCut'
  );
}
async function atomicWrite(destination, data) {
  const temporary = path.join(
    path.dirname(destination),
    `.freecut-save-${crypto.randomUUID()}.tmp`,
  );
  try {
    const file = await fsp.open(temporary, 'wx');
    try {
      await file.writeFile(data, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await fsp.rename(temporary, destination);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {});
  }
}
async function importPath(input) {
  const asset = await media.importPath(input);
  selectedPaths.add(asset.path);
  return asset;
}
async function rememberProject(project, file) {
  try {
    await recentProjects.remember(project, file);
  } catch (error) {
    console.error('最近工程列表未能更新：', error.message);
  }
}
async function saveProject(project) {
  validateProject(project);
  const result = await dialog.showSaveDialog(window, {
    title: uiText('保存 FreeCut 工程', 'Save FreeCut project'),
    defaultPath: `${safeName(project.name)}.freecut`,
    filters: [{ name: uiText('FreeCut 工程', 'FreeCut project'), extensions: ['freecut'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const saved = structuredClone(project);
  // Session access tokens and thumbnails are recreated from media references.
  for (const asset of saved.assets) {
    asset.url = '';
    delete asset.thumbnail;
  }
  await atomicWrite(result.filePath, JSON.stringify(saved, null, 2));
  selectedPaths.add(result.filePath);
  await rememberProject(saved, result.filePath);
  return result.filePath;
}
async function openProjectPath(file) {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    throw Error('工程文件已移动或删除，请使用“打开工程”重新选择。');
  }
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('工程文件无效或超过 64 MB。');
  let project;
  try {
    project = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    throw new Error('工程文件不是有效的 JSON。');
  }
  validateProject(project);
  for (const asset of project.assets) {
    const id = asset.id;
    asset.url = '';
    delete asset.thumbnail;
    if (!asset.path) {
      asset.missing = true;
      continue;
    }
    try {
      const restored = await importPath(asset.path);
      Object.assign(asset, restored, { id, missing: false });
    } catch {
      asset.missing = true;
    }
  }
  selectedPaths.add(file);
  await rememberProject(project, file);
  return project;
}
function disposeResources() {
  if (!disposing)
    disposing = Promise.allSettled([
      exporter?.dispose(),
      chattts?.dispose?.(),
      ai?.cancel?.(),
    ]).finally(() => {
      disposing = null;
    });
  return disposing;
}
function completeQuit() {
  if (shutdown) return;
  updater?.dispose();
  shutdown = disposeResources().finally(() => {
    quitting = true;
    app.quit();
  });
}

function installIPC() {
  handle('freecut:set-language', (language) => {
    if (language !== 'zh-CN' && language !== 'en') throw Error('Unsupported interface language');
    uiLanguage = language;
    if (window && !window.isDestroyed()) window.setTitle(uiText('水管剪辑 FreeCut', 'FreeCut'));
    return uiLanguage;
  });
  recentProjects = createRecentProjects({ userData: app.getPath('userData') });
  exporter = createExporter({
    ffmpegPath,
    resolveAsset: media.resolveAsset,
    temporaryRoot: app.getPath('temp'),
    emitProgress: (data) => {
      if (window && !window.isDestroyed()) window.webContents.send('freecut:export-progress', data);
    },
  });
  handle('freecut:import-media', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: uiText('导入视频、音频或图片', 'Import video, audio, or images'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: uiText('媒体文件', 'Media files'), extensions: [...MEDIA_EXTENSIONS].map((ext) => ext.slice(1)) }],
    });
    if (result.canceled) return [];
    const assets = [],
      errors = [];
    for (const file of result.filePaths) {
      try {
        assets.push(await importPath(file));
      } catch (error) {
        errors.push(`${path.basename(file)}：${error.message}`);
      }
    }
    if (errors.length)
      await dialog.showMessageBox(window, {
        type: 'warning',
        title: uiText('部分素材未能导入', 'Some media could not be imported'),
        message: errors.slice(0, 10).join('\n'),
      });
    return assets;
  });
  handle('freecut:save-project', saveProject);
  handle('freecut:open-project', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: uiText('打开 FreeCut 工程', 'Open FreeCut project'),
      properties: ['openFile'],
      filters: [{ name: uiText('FreeCut 工程', 'FreeCut project'), extensions: ['freecut', 'json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return openProjectPath(result.filePaths[0]);
  });
  handle('freecut:list-projects', () => recentProjects.list());
  handle('freecut:open-recent-project', async (id) =>
    openProjectPath(await recentProjects.getPath(id)),
  );
  handle('freecut:remove-recent-project', (id) => recentProjects.remove(id));
  handle('freecut:resolve-close', async (data) => {
    const result = await (closeGuard?.resolve(data) ?? { status: 'failed', error: '窗口已关闭。' });
    if (result.status !== 'ready') deferUpdate();
    return result;
  });
  handle('freecut:confirm-close', (data) => {
    const accepted = closeGuard?.confirm(data) ?? false;
    if (!accepted) deferUpdate();
    return accepted;
  });
  handle('freecut:cancel-close', (requestId) => {
    closeGuard?.cancel(requestId);
    deferUpdate();
  });
  updater = createUpdater({
    userData: app.getPath('userData'),
    currentVersion: require('../package.json').freecutReleaseTag || `v${appVersion}`,
    portable,
    enabled: app.isPackaged && process.env.FREECUT_DISABLE_UPDATES !== '1',
    emit: (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('freecut:update-state', state);
    },
  });
  handle('freecut:update-state', () => updater.state());
  handle('freecut:update-check', () => updater.check());
  handle('freecut:update-automatic', (value) => updater.setAutomatic(value));
  handle('freecut:update-install', async () => {
    if (updateStarting || pendingUpdate) return;
    if (!window || !closeGuard) throw Error('当前窗口尚未准备好。');
    updateStarting = true;
    try {
      const asset = await updater.prepareInstall();
      pendingUpdate = await prepareUpdateInstall({
        asset,
        userData: app.getPath('userData'),
        portable,
      });
      updater.installing();
      if (closeGuard.request('quit')) void approveQuit(window, closeGuard, 'quit');
    } catch (error) {
      pendingUpdate = null;
      updater.failed(error);
      throw error;
    } finally {
      updateStarting = false;
    }
  });
  const checkAutomatically = () => {
    if (updater.state().automatic) void updater.check();
  };
  setTimeout(checkAutomatically, 12000).unref();
  setInterval(checkAutomatically, 4 * 60 * 60 * 1000).unref();
  handle('freecut:open-external', async (kind) => {
    const urls = {
      bilibili: 'https://space.bilibili.com/390310418?spm_id_from=333.1007.0.0',
      github: 'https://github.com/Watertube-bilibili/freecut-desktop',
    };
    if (typeof kind !== 'string' || !Object.hasOwn(urls, kind))
      throw Error('外部链接不在允许列表中。');
    await shell.openExternal(urls[kind]);
  });
  handle('freecut:begin-export', async (options) => {
    validateOptions(options);
    if (!fs.existsSync(ffmpegPath))
      throw new Error('内置 FFmpeg 未准备好。开发环境请执行 node scripts/prepare-ffmpeg.mjs。');
    const result = await dialog.showSaveDialog(window, {
      title: uiText('导出视频', 'Export video'),
      defaultPath: `${safeName(options.project.name)}.mp4`,
      filters: [{ name: uiText('MP4 视频', 'MP4 video'), extensions: ['mp4'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const output = result.filePath.toLowerCase().endsWith('.mp4')
      ? result.filePath
      : `${result.filePath}.mp4`;
    const comparable = (value) =>
      process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (
      options.project.assets.some(
        (asset) => asset.path && comparable(asset.path) === comparable(output),
      )
    )
      throw new Error('导出文件不能覆盖工程正在使用的素材。请选择另一个文件名。');
    selectedPaths.add(output);
    return exporter.begin(options, output);
  });
  handle('freecut:write-frame', (data) => exporter.writeFrame(data));
  handle('freecut:finish-export', (id) => exporter.finish(id));
  handle('freecut:cancel-export', (id) => exporter.cancel(id));
  handle('freecut:show-item', async (file) => {
    if (typeof file !== 'string') throw new Error('只能定位用户已选择的文件。');
    const allowed = selectedPaths.has(file) ? file : await recentProjects.findPath(file);
    if (!allowed) throw new Error('只能定位用户已选择的文件。');
    if (
      !(await fsp.stat(allowed).then(
        (stat) => stat.isFile(),
        () => false,
      ))
    )
      throw new Error('文件已移动或删除，请重新打开项目。');
    shell.showItemInFolder(allowed);
  });
  handle('freecut:get-info', async () => ({
    version: appVersion,
    platform: process.platform,
    ffmpeg: fs.existsSync(ffmpegPath),
    portable,
    userData: app.getPath('userData'),
  }));
  // Main owns shutdown after close approval. Do not let AI's optional legacy
  // before-quit listener cancel a job while the user is still deciding to quit.
  if (fs.existsSync(path.join(__dirname, 'ai.cjs')))
    ai = require('./ai.cjs').registerAI({
      ipcMain,
      app: { getPath: (name) => app.getPath(name) },
      dialog,
      ffmpegPath,
      importPath,
      validateSender,
      validateMediaPath: media.validateMediaPath,
    });
  if (fs.existsSync(path.join(__dirname, 'chattts.cjs')))
    chattts = require('./chattts.cjs').registerChatTTS({
      ipcMain,
      app,
      importPath,
      validateSender,
    });
  require('./sound-library.cjs').registerSoundLibrary({ ipcMain, app, importPath, validateSender });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#101014',
    title: uiText('水管剪辑 FreeCut', 'FreeCut'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== entryURL) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  const target = window;
  const guard = createCloseGuard({
    requestSnapshot: (request) => target.webContents.send('freecut:request-close', request),
    validateProject,
    saveProject,
    chooseAction: async (project) => {
      const result = await dialog.showMessageBox(target, {
        type: 'question',
        title: uiText('保存更改', 'Save changes'),
        message: uiText(`是否保存对“${project.name}”的更改？`, `Save changes to “${project.name}”?`),
        detail: uiText('未保存的更改会丢失。', 'Unsaved changes will be lost.'),
        buttons: uiLanguage === 'en' ? ['Save and quit', 'Discard', 'Cancel'] : ['保存并退出', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      return ['save', 'discard', 'cancel'][result.response] ?? 'cancel';
    },
    approve: (reason) => setImmediate(() => void approveQuit(target, guard, reason)),
    reportError: (message) => {
      deferUpdate();
      if (!target.isDestroyed())
        void dialog.showMessageBox(target, { type: 'error', title: uiText('暂时无法关闭', 'Could not close the editor'), message });
    },
  });
  closeGuard = guard;
  target.on('close', (event) => {
    if (!quitting && (pendingUpdate || approvingQuit)) {
      event.preventDefault();
      if (guard.request('quit')) void approveQuit(target, guard, 'quit');
      return;
    }
    if (!guard.request('window')) event.preventDefault();
  });
  target.on('closed', () => {
    guard.dispose();
    if (window === target) {
      window = null;
      closeGuard = null;
    }
    if (!shutdown) void disposeResources();
  });
  void window.loadURL(entryURL);
}

app.whenReady().then(() => {
  protocol.handle('freecut-media', media.handleRequest);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  const csp = `default-src 'self'; script-src 'self'${dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: freecut-media:; media-src 'self' blob: freecut-media:; connect-src 'self' freecut-media:${dev ? ' ws://127.0.0.1:5173 http://127.0.0.1:5173' : ''}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'`;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } }),
  );
  installIPC();
  createWindow();
  app.on('activate', () => {
    if (!shutdown && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  if (window && !window.isDestroyed() && closeGuard) {
    if (closeGuard.request('quit')) void approveQuit(window, closeGuard, 'quit');
  } else completeQuit();
});
