'use strict';
const { contextBridge, ipcRenderer }=require('electron');
function subscribe(channel, callback) {
  if(typeof callback!=='function')throw new TypeError('回调必须是函数。');
  const listener=(_event,value) => callback(value);
  ipcRenderer.on(channel,listener);
  return () => ipcRenderer.removeListener(channel,listener);
}
contextBridge.exposeInMainWorld('freecut',Object.freeze({
  importMedia:() => ipcRenderer.invoke('freecut:import-media'),
  saveProject:(project) => ipcRenderer.invoke('freecut:save-project',project),
  openProject:() => ipcRenderer.invoke('freecut:open-project'),
  beginExport:(options) => ipcRenderer.invoke('freecut:begin-export',options),
  writeFrame:(data) => ipcRenderer.invoke('freecut:write-frame',data),
  finishExport:(jobId) => ipcRenderer.invoke('freecut:finish-export',jobId),
  cancelExport:(jobId) => ipcRenderer.invoke('freecut:cancel-export',jobId),
  onExportProgress:(callback) => subscribe('freecut:export-progress',callback),
  showItem:(filePath) => ipcRenderer.invoke('freecut:show-item',filePath),
  getInfo:() => ipcRenderer.invoke('freecut:get-info'),
  aiStatus:() => ipcRenderer.invoke('freecut:ai-status'),
  aiInstall:(options) => ipcRenderer.invoke('freecut:ai-install',options),
  aiTranscribe:(options) => ipcRenderer.invoke('freecut:ai-transcribe',options),
  aiSpeak:(options) => ipcRenderer.invoke('freecut:ai-speak',options),
  aiCancel:() => ipcRenderer.invoke('freecut:ai-cancel'),
  onAIProgress:(callback) => subscribe('freecut:ai-progress',callback),
  chatttsStatus:() => ipcRenderer.invoke('freecut:chattts-status'),
  chatttsInstall:() => ipcRenderer.invoke('freecut:chattts-install'),
  chatttsGenerate:(options) => ipcRenderer.invoke('freecut:chattts-generate',options),
  chatttsCancel:() => ipcRenderer.invoke('freecut:chattts-cancel'),
  onChatTTSProgress:(callback) => subscribe('freecut:chattts-progress',callback),
}));
