'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('freecutInstaller', {
  state: () => ipcRenderer.invoke('freecut-installer:state'),
  choose: () => ipcRenderer.invoke('freecut-installer:choose'),
  install: (target) => ipcRenderer.invoke('freecut-installer:install', target),
  cancel: () => ipcRenderer.invoke('freecut-installer:cancel'),
  launch: () => ipcRenderer.invoke('freecut-installer:launch'),
  uninstall: () => ipcRenderer.invoke('freecut-installer:uninstall'),
  close: () => ipcRenderer.invoke('freecut-installer:close'),
  onProgress: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('freecut-installer:progress', handler);
    return () => ipcRenderer.removeListener('freecut-installer:progress', handler);
  },
});
