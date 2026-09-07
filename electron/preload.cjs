'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const closeListeners = new Set();
let pendingClose = null;
ipcRenderer.on('freecut:request-close', (_event, request) => {
  pendingClose = request;
  if (closeListeners.size) {
    pendingClose = null;
    for (const callback of closeListeners) callback(request);
  }
});
function onCloseRequested(callback) {
  if (typeof callback !== 'function') throw TypeError('回调必须是函数。');
  closeListeners.add(callback);
  if (pendingClose)
    queueMicrotask(() => {
      if (closeListeners.has(callback) && pendingClose) {
        const request = pendingClose;
        pendingClose = null;
        callback(request);
      }
    });
  return () => closeListeners.delete(callback);
}
function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('回调必须是函数。');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld(
  'freecut',
  Object.freeze({
    setLanguage: (language) => ipcRenderer.invoke('freecut:set-language', language),
    importMedia: () => ipcRenderer.invoke('freecut:import-media'),
    saveProject: (project) => ipcRenderer.invoke('freecut:save-project', project),
    openProject: () => ipcRenderer.invoke('freecut:open-project'),
    listProjects: () => ipcRenderer.invoke('freecut:list-projects'),
    openRecentProject: (id) => ipcRenderer.invoke('freecut:open-recent-project', id),
    removeRecentProject: (id) => ipcRenderer.invoke('freecut:remove-recent-project', id),
    openExternal: (kind) => ipcRenderer.invoke('freecut:open-external', kind),
    onCloseRequested,
    resolveClose: (data) => ipcRenderer.invoke('freecut:resolve-close', data),
    confirmClose: (data) => ipcRenderer.invoke('freecut:confirm-close', data),
    cancelClose: (requestId) => ipcRenderer.invoke('freecut:cancel-close', requestId),
    beginExport: (options) => ipcRenderer.invoke('freecut:begin-export', options),
    writeFrame: (data) => ipcRenderer.invoke('freecut:write-frame', data),
    finishExport: (jobId) => ipcRenderer.invoke('freecut:finish-export', jobId),
    cancelExport: (jobId) => ipcRenderer.invoke('freecut:cancel-export', jobId),
    onExportProgress: (callback) => subscribe('freecut:export-progress', callback),
    showItem: (filePath) => ipcRenderer.invoke('freecut:show-item', filePath),
    getInfo: () => ipcRenderer.invoke('freecut:get-info'),
    listSounds: () => ipcRenderer.invoke('freecut:sounds-list'),
    createSound: (id) => ipcRenderer.invoke('freecut:sounds-create', id),
    updateState: () => ipcRenderer.invoke('freecut:update-state'),
    checkUpdate: () => ipcRenderer.invoke('freecut:update-check'),
    setAutomaticUpdates: (value) => ipcRenderer.invoke('freecut:update-automatic', value),
    installUpdate: () => ipcRenderer.invoke('freecut:update-install'),
    onUpdateState: (callback) => subscribe('freecut:update-state', callback),
    onCloseFailed: (callback) => subscribe('freecut:close-failed', callback),
    aiStatus: () => ipcRenderer.invoke('freecut:ai-status'),
    aiInstall: (options) => ipcRenderer.invoke('freecut:ai-install', options),
    aiTranscribe: (options) => ipcRenderer.invoke('freecut:ai-transcribe', options),
    aiSpeak: (options) => ipcRenderer.invoke('freecut:ai-speak', options),
    aiCancel: () => ipcRenderer.invoke('freecut:ai-cancel'),
    onAIProgress: (callback) => subscribe('freecut:ai-progress', callback),
    chatttsStatus: () => ipcRenderer.invoke('freecut:chattts-status'),
    chatttsInstall: () => ipcRenderer.invoke('freecut:chattts-install'),
    chatttsGenerate: (options) => ipcRenderer.invoke('freecut:chattts-generate', options),
    chatttsCancel: () => ipcRenderer.invoke('freecut:chattts-cancel'),
    onChatTTSProgress: (callback) => subscribe('freecut:chattts-progress', callback),
  }),
);
