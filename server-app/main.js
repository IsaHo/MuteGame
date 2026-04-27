const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Set admin dist path for the server
const adminDist = path.join(__dirname, 'admin-dist');
process.env.ADMIN_DIST = adminDist;

// Database path in user data
const { app: electronApp } = require('electron');
const dbPath = path.join(app.getPath('userData'), 'mutegame.db');
process.env.DB_PATH = dbPath;

let tray = null;
let mainWindow = null;
let serverStarted = false;

const SERVER_PORT = 3001;

function getIconPath() {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = path.join(__dirname, 'assets', iconFile);
  if (fs.existsSync(iconPath)) return iconPath;
  return null;
}

function createWindow() {
  const iconPath = getIconPath();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'MuteGame Server - پنل مدیریت',
    backgroundColor: '#07071a',
    icon: iconPath || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => mainWindow.loadURL(`http://localhost:${SERVER_PORT}/admin`), 2000);
  });
}

function createTray() {
  const iconPath = getIconPath();
  const img = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  tray = new Tray(img.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==') : img);
  tray.setToolTip('MuteGame Server');

  const menu = Menu.buildFromTemplate([
    {
      label: '🎮 MuteGame Server',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '📊 باز کردن پنل ادمین',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: '🌐 باز در مرورگر',
      click: () => shell.openExternal(`http://localhost:${SERVER_PORT}/admin`)
    },
    { type: 'separator' },
    {
      label: `🔗 آدرس شبکه: ${getLocalIP()}:${SERVER_PORT}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '❌ خروج از سرور',
      click: () => {
        const choice = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['بله، خارج شو', 'لغو'],
          defaultId: 1,
          title: 'خروج از MuteGame Server',
          message: 'آیا می‌خواهید سرور را ببندید؟\nبا بسته شدن سرور، همه کلاینت‌ها قطع می‌شوند.',
          cancelId: 1,
        });
        if (choice === 0) {
          tray.destroy();
          app.exit(0);
        }
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function getLocalIP() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function startServer() {
  return new Promise((resolve, reject) => {
    try {
      // Override DB path for packaged app
      const dbModule = require('./server/database');

      // Patch database path
      const origInit = dbModule.initDatabase;

      const { startServer: runServer } = require('./server/index');
      const httpServer = runServer(SERVER_PORT);
      httpServer.on('listening', () => {
        console.log(`✅ Server started on port ${SERVER_PORT}`);
        resolve();
      });
      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          // Server already running
          console.log('Server already running on port', SERVER_PORT);
          resolve();
        } else {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

function showSplash() {
  const splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#07071a',
    resizable: false,
  });

  splash.loadURL(`data:text/html,<!DOCTYPE html>
<html dir="rtl" style="margin:0;background:#07071a;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Tahoma,sans-serif;color:#e2e8f0;border-radius:16px;overflow:hidden;">
<body style="text-align:center;background:linear-gradient(135deg,#0d0d26,#13132e);border-radius:16px;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #1e1e4a;">
  <div style="font-size:52px;margin-bottom:12px;">🎮</div>
  <div style="font-size:26px;font-weight:900;background:linear-gradient(135deg,#a78bfa,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">MuteGame</div>
  <div style="font-size:12px;color:#64748b;margin-top:6px;letter-spacing:2px;">SERVER STARTING...</div>
  <div style="margin-top:24px;width:180px;height:4px;background:#1e1e4a;border-radius:2px;overflow:hidden;">
    <div style="height:100%;width:60%;background:linear-gradient(90deg,#7c3aed,#06b6d4);border-radius:2px;animation:slide 1.5s ease-in-out infinite;" />
  </div>
  <style>@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}</style>
</body></html>`);

  return splash;
}

app.whenReady().then(async () => {
  const splash = showSplash();

  try {
    await startServer();
    serverStarted = true;

    await new Promise(r => setTimeout(r, 1500));
    splash.close();

    createWindow();
    createTray();

    const ip = getLocalIP();
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}/admin`);
    mainWindow.show();

    // Show startup notification
    if (tray) {
      tray.displayBalloon?.({
        title: 'MuteGame Server',
        content: `✅ سرور شروع به کار کرد\n🌐 آدرس شبکه: ${ip}:${SERVER_PORT}`,
        iconType: 'info',
      });
    }

  } catch (err) {
    splash.close();
    dialog.showErrorBox('خطا در شروع سرور', err.message);
    app.exit(1);
  }
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

app.on('window-all-closed', (e) => e.preventDefault());
