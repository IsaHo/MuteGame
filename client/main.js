const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { serverUrl: 'http://localhost:3001', computerName: `PC-${Math.floor(Math.random() * 99) + 1}` }; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

let win;
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    fullscreen: !isDev,
    kiosk: false,
    frame: isDev,
    titleBarStyle: 'hidden',
    backgroundColor: '#07071a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
    // Disable right-click and keyboard shortcuts in production
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F4' && input.alt) event.preventDefault();
      if (input.key === 'Escape') event.preventDefault();
    });
    Menu.setApplicationMenu(null);
  }

  win.on('close', (e) => {
    if (!isDev) e.preventDefault();
  });
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });
  ipcMain.handle('get-computer-name', () => {
    const os = require('os');
    return os.hostname();
  });
  ipcMain.handle('lock-screen', () => {
    if (win) {
      win.setKiosk(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true);
      win.focus();
    }
  });
  ipcMain.handle('unlock-screen', () => {
    if (win) {
      win.setKiosk(false);
      win.setAlwaysOnTop(false);
    }
  });
  ipcMain.handle('open-game', (_, path) => shell.openPath(path));
  ipcMain.handle('minimize', () => win?.minimize());
  ipcMain.handle('quit-app', (_, password) => {
    if (password === 'mutegame_admin_exit') app.quit();
    return password === 'mutegame_admin_exit';
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
