const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  getComputerName: () => ipcRenderer.invoke('get-computer-name'),
  lockScreen: () => ipcRenderer.invoke('lock-screen'),
  unlockScreen: () => ipcRenderer.invoke('unlock-screen'),
  openGame: (path) => ipcRenderer.invoke('open-game', path),
  minimize: () => ipcRenderer.invoke('minimize'),
  quitApp: (password) => ipcRenderer.invoke('quit-app', password),
});
