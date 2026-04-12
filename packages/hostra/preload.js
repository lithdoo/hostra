const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getPath: (name) => ipcRenderer.invoke('get-path', name),
  platform: process.platform,
  arch: process.arch
});
