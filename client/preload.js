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
  getLinkSpeed: () => ipcRenderer.invoke('get-link-speed'),

  // Admin panel
  verifyAdminPassword: (password) => ipcRenderer.invoke('verify-admin-password', password),
  adminSetupRequired: () => ipcRenderer.invoke('admin-setup-required'),
  adminSetInitialPassword: (password) => ipcRenderer.invoke('admin-set-initial-password', password),
  adminShutdown: () => ipcRenderer.invoke('admin-shutdown'),
  setLauncherActive: (active) => ipcRenderer.invoke('set-launcher-active', active),
  setPolicy: (name, enabled) => ipcRenderer.invoke('set-policy', name, enabled),
  setStrictKiosk: (enabled) => ipcRenderer.invoke('set-strict-kiosk', enabled),
  shutdownSystem: () => ipcRenderer.invoke('shutdown-system'),
  restartSystem: () => ipcRenderer.invoke('restart-system'),

  onAdminExitRequested: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('admin-exit-requested', handler);
    return () => ipcRenderer.removeListener('admin-exit-requested', handler);
  },

  // ─── Game launcher ─────────────────────────────────────────────────
  // Search the local filesystem for an exe matching the given name.
  // Returns { found: boolean, path?: string, searchedPaths: string[] }
  findGameExe: (exeName, hintPath, gameId) => ipcRenderer.invoke('find-game-exe', exeName, hintPath, gameId),
  setGamePath: (gameId, exePath) => ipcRenderer.invoke('set-game-path', gameId, exePath),
  getGamePaths: () => ipcRenderer.invoke('get-game-paths'),
  clearGamePath: (gameId) => ipcRenderer.invoke('clear-game-path', gameId),
  pickExeFile: (opts) => ipcRenderer.invoke('pick-exe-file', opts),
  launchGame: (exePath) => ipcRenderer.invoke('launch-game', exePath),
  // Push the latest server games list so main can rebuild its launch allowlist
  updateAllowlist: (games) => ipcRenderer.invoke('update-allowlist', games),
  getAllowlist: () => ipcRenderer.invoke('get-allowlist'),
  endGameSession: () => ipcRenderer.invoke('end-game-session'),
  isGameSessionActive: () => ipcRenderer.invoke('is-game-session-active'),
  onGameSessionEnd: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('game-session-end', handler);
    return () => ipcRenderer.removeListener('game-session-end', handler);
  },

  // ─── Network assignment (DNS / modem) ─────────────────────────────
  applyClientAssignment: (assignment) => ipcRenderer.invoke('apply-client-assignment', assignment),

  // ─── DNS ping + apply (from client UI) ────────────────────────────
  pingHost: (host) => ipcRenderer.invoke('ping-host', host),
  applyDns: (primary, secondary) => ipcRenderer.invoke('apply-dns', primary, secondary),

  // ─── Limited task manager ─────────────────────────────────────────
  listProcesses: () => ipcRenderer.invoke('list-allowed-processes'),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
});
