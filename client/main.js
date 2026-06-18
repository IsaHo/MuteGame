const { app, BrowserWindow, ipcMain, shell, Menu, globalShortcut, screen, dialog, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');

// ─── Network input validation ────────────────────────────────────────
// Strict IPv4/IPv6 regexes. We use execFile (no shell) AND validate inputs
// before splicing them into any PowerShell / netsh / route command. Belt
// AND suspenders — the server pushes DNS/modem assignments via socket and
// must be treated as untrusted.
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/; // permissive; rejects letters outside hex
function isValidIp(s) {
  return typeof s === 'string' && (IPV4_RE.test(s) || IPV6_RE.test(s));
}
// Hostname or IPv4 — accepted by ping. Rejects anything with shell metachars.
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;
function isValidHost(s) {
  return typeof s === 'string' && (IPV4_RE.test(s) || HOSTNAME_RE.test(s));
}

// Build the DNS-apply PowerShell script. Values are validated by the caller;
// execFile bypasses cmd.exe, so the only parser left is PowerShell itself.
function runApplyDnsPs(primary, secondary, timeoutMs = 5000) {
  const servers = secondary ? `'${primary}','${secondary}'` : `'${primary}'`;
  const script = `$a = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.MediaType -eq '802.3' } | Select-Object -First 1 -ExpandProperty Name); if ($a) { Set-DnsClientServerAddress -InterfaceAlias $a -ServerAddresses (${servers}); 'OK ' + $a } else { 'NO_ADAPTER' }`;
  return new Promise(resolve => {
    execFile('powershell', ['-NoProfile', '-Command', script], { timeout: timeoutMs }, (err, stdout) => {
      resolve({ err, out: String(stdout || '').trim() });
    });
  });
}

// ─── Admin exit password (kiosk only). CHANGE THIS BEFORE DEPLOYING. ──
const ADMIN_EXIT_PASSWORD = 'admin';

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
// Per-PC cache of resolved game .exe paths. Keyed by server-side game id so
// once a PC has found Counter-Strike at D:\Steam\..., it remembers it across
// restarts and skips the disk scan next time.
const GAME_PATHS_FILE = path.join(app.getPath('userData'), 'game-paths.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { serverUrl: '', computerName: `PC-${Math.floor(Math.random() * 99) + 1}` }; }
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); }

function loadGamePaths() {
  try { return JSON.parse(fs.readFileSync(GAME_PATHS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveGamePaths(map) {
  try { fs.writeFileSync(GAME_PATHS_FILE, JSON.stringify(map, null, 2)); } catch {}
}
function rememberGamePath(gameId, exePath) {
  if (!gameId || !exePath) return;
  const map = loadGamePaths();
  map[String(gameId)] = exePath;
  saveGamePaths(map);
  rebuildAllowlist();
}

/* ─── Launcher allowlist ─────────────────────────────────────────────
 * In kiosk mode the launcher must refuse to spawn anything that isn't
 * a registered game. Otherwise a malicious user with access to a path
 * (via the renderer or a leaked IPC) could run arbitrary executables.
 *
 * The allowlist is rebuilt from three sources:
 *   1. Per-PC saved paths   (game-paths.json on this disk)
 *   2. Server-pushed games  (their hint_path / discovered exe)
 *   3. Auto-discovered paths from previous find-game-exe scans
 *
 * The renderer pushes #2 via the `update-allowlist` IPC every time the
 * server emits `games:update`. #1 and #3 are maintained by main itself.
 */
const allowedPaths = new Set();   // canonical lowercase paths
const allowedExeNames = new Set(); // bare exe filenames (fallback for unknown locations)

function canon(p) {
  if (!p) return '';
  // Normalise: forward→back slashes, collapse, lowercase (Windows is case-insensitive)
  return String(p).replace(/\//g, '\\').toLowerCase();
}

function rebuildAllowlist() {
  allowedPaths.clear();
  // 1) per-PC saved paths
  const local = loadGamePaths();
  for (const p of Object.values(local)) {
    if (p) allowedPaths.add(canon(p));
  }
  // 2/3) server games + auto-discovered (managed elsewhere)
  for (const p of allowedFromServer) allowedPaths.add(canon(p));
  for (const p of allowedFromCache) allowedPaths.add(canon(p));
}

const allowedFromServer = new Set();
const allowedFromCache = new Set();

function setServerAllowlist(games) {
  allowedFromServer.clear();
  allowedExeNames.clear();
  if (!Array.isArray(games)) { rebuildAllowlist(); return; }
  for (const g of games) {
    if (g.exe_name) allowedExeNames.add(String(g.exe_name).toLowerCase());
    if (g.hint_path && /\.(exe|lnk|bat|cmd)$/i.test(g.hint_path)) {
      allowedFromServer.add(canon(g.hint_path));
    }
  }
  rebuildAllowlist();
}

function noteDiscoveredPath(p) {
  if (!p) return;
  allowedFromCache.add(canon(p));
  rebuildAllowlist();
}

function isAllowedExe(exePath) {
  if (!exePath) return false;
  const c = canon(exePath);
  if (allowedPaths.has(c)) return true;
  // Fallback: check if the basename matches a registered exe_name. Useful when
  // the server hint_path is a directory and we discovered the exe via scan.
  const base = (exePath.split(/[\\/]/).pop() || '').toLowerCase();
  return allowedExeNames.has(base);
}

/* ─── Game session mode ──────────────────────────────────────────────
 * When a registered game launches we want it to take the full screen —
 * NOT sit behind our always-on-top kiosk window. Game-session mode:
 *   • drops always-on-top, allows blur (so the game can come forward)
 *   • minimises the launcher so it's out of the way
 *   • polls tasklist for the game's process; when it exits we
 *     automatically restore the kiosk launcher
 *   • Ctrl+Shift+L manually restores the launcher (escape hatch)
 */
let gameSessionActive = false;
let activeGameExeName = null;
let gameMonitorTimer = null;

function enterGameSession(exePath) {
  if (gameSessionActive) return;
  gameSessionActive = true;
  activeGameExeName = (path.basename(exePath || '') || '').toLowerCase();

  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.setAlwaysOnTop(false); } catch {}
    try { mainWin.setKiosk(false); } catch {}
    try { mainWin.setFullScreen(false); } catch {}
    try { mainWin.minimize(); } catch {}
  }
  // Drop overlay windows too so they don't cover the game on multi-monitor
  for (const o of overlayWins) { try { o.hide(); } catch {} }

  startGameMonitor();
}

function exitGameSession() {
  if (!gameSessionActive) return;
  gameSessionActive = false;
  activeGameExeName = null;
  if (gameMonitorTimer) { clearInterval(gameMonitorTimer); gameMonitorTimer = null; }

  if (mainWin && !mainWin.isDestroyed()) {
    try { mainWin.show(); } catch {}
    try { mainWin.restore(); } catch {}
    try { mainWin.focus(); } catch {}
    if (KIOSK) {
      try { mainWin.setKiosk(true); } catch {}
      try { mainWin.setFullScreen(true); } catch {}
      try { mainWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    }
    try { mainWin.webContents.send('game-session-end'); } catch {}
  }
  for (const o of overlayWins) { try { o.show(); o.setAlwaysOnTop(true, 'screen-saver'); } catch {} }
}

function startGameMonitor() {
  if (process.platform !== 'win32' || !activeGameExeName) return;
  // Give the game ~8s to actually appear in the process list before we start
  // polling — many launchers (Steam, Epic) spawn intermediate processes first.
  setTimeout(() => {
    if (!gameSessionActive) return;
    let misses = 0;
    gameMonitorTimer = setInterval(() => {
      if (!gameSessionActive || !activeGameExeName) {
        clearInterval(gameMonitorTimer); gameMonitorTimer = null; return;
      }
      exec(`tasklist /fi "imagename eq ${activeGameExeName}" /fo csv /nh`, (err, stdout) => {
        if (err) return;
        const alive = (stdout || '').toLowerCase().includes(activeGameExeName);
        if (alive) {
          misses = 0;
        } else {
          misses += 1;
          // Two consecutive 5s misses = ~10s without the game running → restore.
          if (misses >= 2) exitGameSession();
        }
      });
    }, 5000);
  }, 8000);
}

let mainWin = null;
const overlayWins = [];
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const KIOSK = !isDev;

// ─── Single instance ─────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
    mainWin.setAlwaysOnTop(true, 'screen-saver');
  }
});

// Resolve the persistent .exe path. For an electron-builder portable build,
// the running process is extracted to a temp directory that's deleted at exit
// — pointing autostart there means "file not found" on next reboot.
// PORTABLE_EXECUTABLE_FILE holds the real .exe the user double-clicked.
function getPersistentExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
}

// ─── Auto-start: HKCU\Run + Task Scheduler + Startup folder shortcut ──
// Three independent mechanisms; if any one survives a Windows update or AV
// quarantine, the launcher still comes up on next boot.
function setAutoStart(enabled) {
  if (process.platform !== 'win32') return;
  const exe = getPersistentExePath();

  // 1) Electron login item (HKCU\...\Run)
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: false, path: exe });
  } catch {}

  const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  if (enabled) {
    // 2) Direct registry write — guarantees the exact path even if Electron's
    //    setLoginItemSettings normalises it through the temp-extracted process.
    exec(`reg add "${runKey}" /v MuteGameClient /t REG_SZ /d "\\"${exe}\\"" /f`, () => {});

    // 3) Task Scheduler — boots earlier than HKCU\Run on most setups, and
    //    runs even if logon happens via auto-login.
    exec(`schtasks /create /tn "MuteGameClient" /tr "\\"${exe}\\"" /sc onlogon /rl HIGHEST /f`, () => {});

    // 4) Startup folder — most reliable third fallback. Drop a .cmd that
    //    launches the exe (path with quotes handles spaces).
    try {
      const startupDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      fs.mkdirSync(startupDir, { recursive: true });
      const cmdFile = path.join(startupDir, 'MuteGameClient.cmd');
      fs.writeFileSync(cmdFile, `@echo off\r\nstart "" "${exe}"\r\n`, 'utf8');
    } catch {}
  } else {
    exec(`reg delete "${runKey}" /v MuteGameClient /f`, () => {});
    exec(`schtasks /delete /tn "MuteGameClient" /f`, () => {});
    try {
      const startupDir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const cmdFile = path.join(startupDir, 'MuteGameClient.cmd');
      if (fs.existsSync(cmdFile)) fs.unlinkSync(cmdFile);
    } catch {}
  }
}

// ─── Lockdown registry policies (HKCU, no UAC needed) ────────────────
const POLICIES = [
  // Ctrl+Alt+Del menu
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'DisableTaskMgr',          value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'DisableLockWorkstation', value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'DisableChangePassword',  value: 1 },
  // Explorer / Start menu / Run / Logoff
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoLogoff',         value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoClose',          value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoRun',            value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoControlPanel',   value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoSetTaskbar',     value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoTrayContextMenu',value: 1 },
  { path: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', name: 'NoViewContextMenu',value: 1 },
];

function applyLockdownPolicies(enable) {
  if (process.platform !== 'win32') return;
  for (const p of POLICIES) {
    if (enable) {
      exec(`reg add "${p.path}" /v ${p.name} /t REG_DWORD /d ${p.value} /f`, () => {});
    } else {
      exec(`reg delete "${p.path}" /v ${p.name} /f`, () => {});
    }
  }
}

// Kills explorer.exe — taskbar, start menu, desktop, system tray, and Windows
// notifications all disappear. Used when entering kiosk mode.
function killExplorer() {
  if (process.platform !== 'win32') return;
  exec('taskkill /f /im explorer.exe', () => {});
}
function restoreExplorer() {
  if (process.platform !== 'win32') return;
  exec('start explorer.exe', () => {});
}

// Replace the Windows shell for the current user. Next login, Windows runs
// THIS exe instead of explorer.exe — no desktop, no taskbar, no Start menu
// will ever load. The client is the entire user session.
//
// Stored in HKCU (per-user, no UAC). Restored on admin exit.
function setShellAsClient(enable) {
  if (process.platform !== 'win32') return;
  const exe = getPersistentExePath();
  const key = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
  if (enable) {
    exec(`reg add "${key}" /v Shell /t REG_SZ /d "\\"${exe}\\"" /f`, () => {});
  } else {
    exec(`reg delete "${key}" /v Shell /f`, () => {});
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    fullscreen: KIOSK,
    kiosk: KIOSK,
    frame: !KIOSK,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    closable: !KIOSK,
    minimizable: !KIOSK,
    maximizable: !KIOSK,
    movable: !KIOSK,
    resizable: !KIOSK,
    fullscreenable: false,
    skipTaskbar: KIOSK,
    show: false,
    backgroundColor: '#050510',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: isDev,
      sandbox: false,
      // Allow voice playback to start without a click (admin push-to-talk
      // arrives without user interaction in the client window)
      autoplayPolicy: 'no-user-gesture-required',
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  // Auto-grant audio playback / media permissions
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => {
    if (perm === 'media' || perm === 'audioCapture') return cb(true);
    cb(false);
  });

  if (KIOSK) {
    Menu.setApplicationMenu(null);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
    if (KIOSK) {
      win.setKiosk(true);
      win.setFullScreen(true);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.maximize();
      win.focus();
    }
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (!KIOSK) return;
    const key = (input.key || '').toLowerCase();
    const blocked =
      input.key === 'F12' || input.key === 'F11' || input.key === 'F5' ||
      (input.alt && input.key === 'F4') ||
      (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
      (input.control && (key === 'r' || key === 'w' || key === 'n' || key === 'p' || key === 's' || key === 'u' || key === 't')) ||
      (input.alt && input.key === 'Tab') ||
      input.meta || // Win key
      input.key === 'Escape';
    if (blocked) event.preventDefault();
  });

  win.on('close', (e) => { if (KIOSK) e.preventDefault(); });
  win.on('minimize', (e) => {
    // In game-session mode we WANT the launcher minimised so the game has
    // the full screen. Outside game sessions, KIOSK keeps it pinned.
    if (KIOSK && !gameSessionActive) { e.preventDefault(); win.restore(); win.focus(); }
  });
  win.on('blur', () => {
    if (!KIOSK || gameSessionActive) return;
    setTimeout(() => {
      if (win && !win.isDestroyed() && !win.isFocused() && !gameSessionActive) {
        win.focus();
        win.setAlwaysOnTop(true, 'screen-saver');
      }
    }, 50);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) e.preventDefault();
  });

  return win;
}

function createOverlayForDisplay(display) {
  const { x, y, width, height } = display.bounds;
  const ov = new BrowserWindow({
    x, y, width, height,
    fullscreen: true,
    kiosk: true,
    frame: false,
    backgroundColor: '#050510',
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    movable: false,
    resizable: false,
    closable: false,
    webPreferences: { contextIsolation: true, sandbox: true, devTools: false },
  });
  ov.setAlwaysOnTop(true, 'screen-saver');
  ov.setVisibleOnAllWorkspaces(true);
  ov.setMenu(null);
  ov.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(`
<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:#050510;color:#cbd5e1;
  font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;}
.wrap{text-align:center;}
.mark{width:96px;height:96px;border-radius:24px;margin:0 auto 18px;
  background:linear-gradient(135deg,#8b5cf6,#22d3ee);display:grid;place-items:center;
  font-weight:900;color:#050510;font-size:36px;box-shadow:0 0 60px rgba(139,92,246,.5);}
.t{font-size:28px;font-weight:900;letter-spacing:-.02em;
  background:linear-gradient(135deg,#fff,#c7d2fe);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;}
.s{font-size:13px;color:#64748b;margin-top:6px;letter-spacing:1.5px;text-transform:uppercase;}
</style></head><body><div class="wrap">
<div class="mark">M</div><div class="t">MuteGame</div><div class="s">Secondary display · locked</div>
</div></body></html>`)
  );
  return ov;
}

function createAllWindows() {
  mainWin = createMainWindow();
  if (KIOSK) {
    const primary = screen.getPrimaryDisplay();
    for (const d of screen.getAllDisplays()) {
      if (d.id === primary.id) continue;
      try { overlayWins.push(createOverlayForDisplay(d)); } catch {}
    }
  }
}

function rebuildOverlays() {
  for (const o of overlayWins) { try { o.destroy(); } catch {} }
  overlayWins.length = 0;
  if (!KIOSK) return;
  const primary = screen.getPrimaryDisplay();
  for (const d of screen.getAllDisplays()) {
    if (d.id === primary.id) continue;
    try { overlayWins.push(createOverlayForDisplay(d)); } catch {}
  }
}

function registerLockdownShortcuts() {
  if (!KIOSK) return;
  const swallow = () => {};
  const shortcuts = [
    'CommandOrControl+R', 'CommandOrControl+Shift+R', 'F5',
    'CommandOrControl+W', 'CommandOrControl+Shift+W',
    'CommandOrControl+N', 'CommandOrControl+Shift+N',
    'CommandOrControl+T', 'CommandOrControl+Shift+T',
    'CommandOrControl+P', 'CommandOrControl+S', 'CommandOrControl+U',
    'Alt+F4', 'F11', 'F12',
    'CommandOrControl+Shift+I', 'CommandOrControl+Shift+J', 'CommandOrControl+Shift+C',
    'Super+E', 'Super+R', 'Super+S', 'Super+I', 'Super+X',
    'Super+D', 'Super+M', 'Super+A', 'Super+B', 'Super+G', 'Super+L',
    'Super+Tab', 'Super+Up', 'Super+Down', 'Super+Left', 'Super+Right',
    'Alt+Tab', 'Alt+Space', 'Alt+Esc',
    'Control+Escape',
    'Control+Shift+Escape',
  ];
  for (const s of shortcuts) {
    try { globalShortcut.register(s, swallow); } catch {}
  }

  // ─── Admin-exit hotkey: Ctrl+Shift+X opens the exit modal in the app ──
  try {
    globalShortcut.register('Control+Shift+X', () => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.show();
        mainWin.focus();
        mainWin.webContents.send('admin-exit-requested');
      }
    });
  } catch {}

  // ─── Bring-back-launcher hotkey: Ctrl+Shift+L exits a game session ──
  // Escape hatch in case auto-detection misses (e.g. game still running but
  // user wants to switch back to the launcher mid-session).
  try {
    globalShortcut.register('Control+Shift+L', () => {
      if (gameSessionActive) exitGameSession();
      else if (mainWin && !mainWin.isDestroyed()) {
        try { mainWin.show(); mainWin.focus(); mainWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
      }
    });
  } catch {}
}

function shutdownAndExit() {
  // Restore everything before quitting
  applyLockdownPolicies(false);
  setAutoStart(false);
  setShellAsClient(false); // Reset shell back to default (explorer.exe)
  restoreExplorer();
  for (const o of overlayWins) { try { o.removeAllListeners('close'); o.destroy(); } catch {} }
  if (mainWin) { try { mainWin.removeAllListeners('close'); } catch {} }
  setTimeout(() => app.exit(0), 800);
}

/* Block Windows from putting the PC to sleep / showing the screensaver while
 * the launcher is open. Without this, paying customers lose their session
 * to the system going idle. The blocker is released on app quit. */
let _powerBlockId = null;
function startSleepBlock() {
  if (_powerBlockId != null) return;
  try {
    _powerBlockId = powerSaveBlocker.start('prevent-display-sleep');
  } catch {}
  // Belt-and-suspenders: also prevent system sleep
  try {
    const id2 = powerSaveBlocker.start('prevent-app-suspension');
    if (_powerBlockId == null) _powerBlockId = id2;
  } catch {}
}
function stopSleepBlock() {
  if (_powerBlockId != null) {
    try { powerSaveBlocker.stop(_powerBlockId); } catch {}
    _powerBlockId = null;
  }
}

app.whenReady().then(() => {
  createAllWindows();
  registerLockdownShortcuts();
  startSleepBlock();

  if (KIOSK) {
    setAutoStart(true);
    applyLockdownPolicies(true);
    // Full kiosk (CCBoot-style): kill explorer so taskbar/start-menu vanish
    // for every kiosk session. We do NOT replace the Winlogon Shell
    // (too risky — a moved .exe locks the user out of Windows) but we DO
    // remove the desktop UI so the launcher is the only visible app.
    // explorer.exe is restored on admin-exit via restoreExplorer().
    setTimeout(killExplorer, 1500);
    // Re-kill explorer every 30s in case Windows tries to relaunch it
    setInterval(() => {
      try { exec('tasklist /fi "imagename eq explorer.exe" /nh', (err, out) => {
        if (!err && out && /explorer\.exe/i.test(out)) exec('taskkill /f /im explorer.exe', () => {});
      }); } catch {}
    }, 30000);

    const cfg = loadConfig();
    if (cfg.strictKioskShell === true) {
      // Optional: also replace Winlogon Shell so Windows boots straight into
      // this exe (no logon to desktop at all). Only enable when you're sure
      // the .exe path is final.
      setShellAsClient(true);
    }
  }

  screen.on('display-added', () => rebuildOverlays());
  screen.on('display-removed', () => rebuildOverlays());

  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_, cfg) => { saveConfig(cfg); return true; });
  ipcMain.handle('get-computer-name', () => require('os').hostname());

  // Read the actual link speed of the active LAN adapter on Windows.
  // Returns a string like "1 Gbps" / "100 Mbps", or null on non-Windows.
  ipcMain.handle('get-link-speed', async () => {
    if (process.platform !== 'win32') return null;
    return new Promise(resolve => {
      const cmd = 'powershell -NoProfile -Command "(Get-NetAdapter | Where-Object { $_.Status -eq \'Up\' -and $_.MediaType -eq \'802.3\' } | Select-Object -First 1 -ExpandProperty LinkSpeed)"';
      exec(cmd, { timeout: 4000 }, (err, stdout) => {
        if (err) return resolve(null);
        const speed = String(stdout || '').trim();
        resolve(speed || null);
      });
    });
  });

  ipcMain.handle('lock-screen', () => {
    if (!mainWin) return;
    mainWin.setKiosk(true);
    mainWin.setFullScreen(true);
    mainWin.setAlwaysOnTop(true, 'screen-saver');
    mainWin.focus();
  });
  ipcMain.handle('unlock-screen', () => {
    if (!mainWin) return;
    if (KIOSK) {
      mainWin.setAlwaysOnTop(true, 'screen-saver');
      mainWin.focus();
    } else {
      mainWin.setKiosk(false);
      mainWin.setAlwaysOnTop(false);
    }
  });

  ipcMain.handle('open-game', (_, target) => {
    if (!target) return false;
    if (/^[a-z]+:\/\//i.test(target)) return shell.openExternal(target);
    return shell.openPath(target);
  });

  ipcMain.handle('minimize', () => { if (!KIOSK) mainWin?.minimize(); });

  ipcMain.handle('quit-app', (_, password) => {
    const ok = password === ADMIN_EXIT_PASSWORD;
    if (ok) shutdownAndExit();
    return ok;
  });

  // ─── Admin panel IPCs ────────────────────────────────────────────────
  ipcMain.handle('verify-admin-password', (_, password) => password === ADMIN_EXIT_PASSWORD);

  // Toggle launcher lockdown without quitting. enabled=false un-applies all
  // policies, restores explorer, removes auto-start; enabled=true re-applies.
  ipcMain.handle('set-launcher-active', (_, active) => {
    if (process.platform !== 'win32') return false;
    if (active) {
      applyLockdownPolicies(true);
      setShellAsClient(true);
      setAutoStart(true);
      setTimeout(killExplorer, 800);
    } else {
      applyLockdownPolicies(false);
      setShellAsClient(false);
      setAutoStart(false);
      restoreExplorer();
    }
    return true;
  });

  // Per-feature policy toggles. name: 'taskmgr' | 'cmd'
  ipcMain.handle('set-policy', (_, name, enabled) => {
    if (process.platform !== 'win32') return false;
    if (name === 'taskmgr') {
      const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System';
      if (enabled) exec(`reg add "${key}" /v DisableTaskMgr /t REG_DWORD /d 1 /f`, () => {});
      else exec(`reg delete "${key}" /v DisableTaskMgr /f`, () => {});
    } else if (name === 'cmd') {
      const key = 'HKCU\\Software\\Policies\\Microsoft\\Windows\\System';
      if (enabled) exec(`reg add "${key}" /v DisableCMD /t REG_DWORD /d 2 /f`, () => {});
      else exec(`reg delete "${key}" /v DisableCMD /f`, () => {});
    }
    return true;
  });

  // Apply Strict Kiosk (Winlogon Shell replacement) live from admin panel.
  // Takes effect at the NEXT Windows logon.
  ipcMain.handle('set-strict-kiosk', (_, enabled) => {
    setShellAsClient(!!enabled);
    return true;
  });

  ipcMain.handle('shutdown-system', () => {
    if (process.platform !== 'win32') return false;
    exec('shutdown /s /t 0 /f', () => {});
    return true;
  });

  ipcMain.handle('restart-system', () => {
    if (process.platform !== 'win32') return false;
    exec('shutdown /r /t 0 /f', () => {});
    return true;
  });

  // ─── Game-finder cache (per session) ─────────────────────────────
  const gameCache = new Map(); // exe_name -> path

  // Recursively scan a directory looking for the exe (depth-limited)
  function scanDir(root, exeName, depth, max, results) {
    if (depth > max || results.length >= 1) return;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const e of entries) {
        if (results.length >= 1) return;
        if (e.name.startsWith('$') || e.name === 'Windows' || e.name === 'WindowsApps') continue;
        const full = path.join(root, e.name);
        try {
          if (e.isFile()) {
            if (e.name.toLowerCase() === exeName.toLowerCase()) {
              results.push(full);
              return;
            }
          } else if (e.isDirectory()) {
            scanDir(full, exeName, depth + 1, max, results);
          }
        } catch {}
      }
    } catch {}
  }

  ipcMain.handle('set-game-path', (_, gameId, exePath) => {
    if (!exePath || !fs.existsSync(exePath)) return { ok: false, error: 'فایل پیدا نشد' };
    rememberGamePath(gameId, exePath);
    return { ok: true, path: exePath };
  });
  ipcMain.handle('get-game-paths', () => loadGamePaths());

  // Open a native file picker rooted at any drive (C:/D:/E:/…). Returns the
  // selected .exe path or null. Used by the in-client admin panel so each PC
  // can map a game to wherever its .exe actually lives on this machine.
  ipcMain.handle('pick-exe-file', async (_, opts = {}) => {
    // Pass the parent window so the picker shows ABOVE the always-on-top
    // kiosk window (otherwise it opens behind and looks like nothing happened)
    const result = await dialog.showOpenDialog(mainWin || undefined, {
      title: opts.title || 'انتخاب فایل اجرایی بازی',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      defaultPath: opts.defaultPath || 'D:\\',
    });
    if (result.canceled || !result.filePaths?.[0]) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('clear-game-path', (_, gameId) => {
    const map = loadGamePaths();
    delete map[String(gameId)];
    saveGamePaths(map);
    return { ok: true };
  });

  ipcMain.handle('find-game-exe', async (_, exeName, hintPath, gameId) => {
    if (!exeName) return { found: false };
    const lower = exeName.toLowerCase();

    // 0) Per-PC saved path first — once a PC has discovered a game it should
    // never re-scan unless the file has actually been deleted/moved.
    if (gameId != null) {
      const saved = loadGamePaths()[String(gameId)];
      if (saved && fs.existsSync(saved)) {
        gameCache.set(lower, saved); noteDiscoveredPath(saved);
        return { found: true, path: saved, via: 'saved' };
      }
    }

    if (gameCache.has(lower)) return { found: true, path: gameCache.get(lower), cached: true };

    // 1) hint path first
    if (hintPath) {
      try {
        if (fs.existsSync(hintPath)) {
          const st = fs.statSync(hintPath);
          if (st.isFile()) {
            gameCache.set(lower, hintPath); noteDiscoveredPath(hintPath);
            if (gameId != null) rememberGamePath(gameId, hintPath);
            return { found: true, path: hintPath, via: 'hint' };
          }
          if (st.isDirectory()) {
            const candidate = path.join(hintPath, exeName);
            if (fs.existsSync(candidate)) {
              gameCache.set(lower, candidate); noteDiscoveredPath(candidate);
              if (gameId != null) rememberGamePath(gameId, candidate);
              return { found: true, path: candidate, via: 'hint+name' };
            }
            const found = [];
            scanDir(hintPath, exeName, 0, 4, found);
            if (found.length) {
              gameCache.set(lower, found[0]); noteDiscoveredPath(found[0]);
              if (gameId != null) rememberGamePath(gameId, found[0]);
              return { found: true, path: found[0], via: 'hint+scan' };
            }
          }
        }
      } catch {}
    }

    // 2) common Windows game roots
    const roots = process.platform === 'win32' ? [
      'C:\\Program Files (x86)\\Steam\\steamapps\\common',
      'D:\\Steam\\steamapps\\common',
      'E:\\Steam\\steamapps\\common',
      'C:\\Program Files\\Epic Games',
      'C:\\Program Files (x86)\\Epic Games',
      'D:\\Epic Games',
      'C:\\Riot Games',
      'C:\\Program Files\\Riot Games',
      'C:\\Program Files (x86)',
      'C:\\Program Files',
      'C:\\Games',
      'D:\\Games',
      'E:\\Games',
      path.join(app.getPath('home'), 'Desktop'),
    ] : [];

    for (const r of roots) {
      try {
        if (!fs.existsSync(r)) continue;
        const found = [];
        scanDir(r, exeName, 0, 3, found);
        if (found.length) {
          gameCache.set(lower, found[0]); noteDiscoveredPath(found[0]);
          if (gameId != null) rememberGamePath(gameId, found[0]);
          return { found: true, path: found[0], via: 'scan', root: r };
        }
      } catch {}
    }

    // 3) Use Windows `where` as last resort (only if exeName is on PATH)
    if (process.platform === 'win32') {
      const whereResult = await new Promise(res => {
        exec(`where ${JSON.stringify(exeName)}`, { timeout: 4000 }, (err, stdout) => {
          if (err) return res(null);
          const first = String(stdout || '').split('\n').map(x => x.trim()).filter(Boolean)[0];
          res(first || null);
        });
      });
      if (whereResult) {
        gameCache.set(lower, whereResult); noteDiscoveredPath(whereResult);
        if (gameId != null) rememberGamePath(gameId, whereResult);
        return { found: true, path: whereResult, via: 'where' };
      }
    }

    return { found: false };
  });

  ipcMain.handle('launch-game', async (_, exePath) => {
    if (!exePath) return { ok: false, error: 'مسیر خالی است' };
    // Whitelist enforcement: in kiosk mode only registered game/launcher
    // exes (saved locally OR pushed by the server) can be opened. Any other
    // path — even if the renderer somehow asks for it — is rejected.
    if (KIOSK && !isAllowedExe(exePath)) {
      console.warn('[launcher] BLOCKED launch attempt for unregistered exe:', exePath);
      return { ok: false, error: 'این فایل در لیست بازی‌های مجاز نیست. ابتدا از پنل ادمین کلاینت تعریفش کن.' };
    }
    try {
      const result = await shell.openPath(exePath);
      if (result) return { ok: false, error: result };

      // Give the game a moment to spawn, then drop the launcher to the
      // background so the game gets the foreground + full screen.
      setTimeout(() => enterGameSession(exePath), 2500);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Renderer can manually end a game session (admin-exit, "بازگشت به لانچر")
  ipcMain.handle('end-game-session', () => {
    exitGameSession();
    return { ok: true };
  });
  ipcMain.handle('is-game-session-active', () => gameSessionActive);

  // Renderer pushes the server-side game list whenever it gets a games:update
  // socket event, so main can keep its allowlist in sync.
  ipcMain.handle('update-allowlist', (_, games) => {
    setServerAllowlist(games);
    return { ok: true, count: allowedPaths.size, exeNames: allowedExeNames.size };
  });

  // Read-only query — useful for debugging from the renderer
  ipcMain.handle('get-allowlist', () => ({
    paths: Array.from(allowedPaths),
    exeNames: Array.from(allowedExeNames),
  }));

  // ─── Apply assignment (DNS / modem) ─────────────────────────────
  // Stores the assignment locally and (best-effort) applies via netsh on Windows.
  // Real DNS change needs admin; we attempt and report success/failure.
  ipcMain.handle('apply-client-assignment', async (_, assignment) => {
    if (process.platform !== 'win32') return { ok: false, error: 'فقط روی ویندوز' };
    const result = { dns: null, route: null };

    // 1) DNS — server-pushed; validate every IP before any subprocess call.
    if (assignment?.dns?.primary_dns) {
      const primary = assignment.dns.primary_dns;
      const secondary = assignment.dns.secondary_dns || null;
      if (!isValidIp(primary)) {
        result.dns = 'ERR: invalid primary DNS';
      } else if (secondary && !isValidIp(secondary)) {
        result.dns = 'ERR: invalid secondary DNS';
      } else {
        const r = await runApplyDnsPs(primary, secondary);
        result.dns = r.err ? `ERR: ${r.err.message}` : r.out;
      }
    }

    // 2) Modem (route default gateway) — same input source, same validation.
    if (assignment?.modem?.gateway || assignment?.modem?.ip) {
      const gw = assignment.modem.gateway || assignment.modem.ip;
      if (!isValidIp(gw)) {
        result.route = 'ERR: invalid gateway';
      } else {
        result.route = await new Promise(r => execFile('route', ['change', '0.0.0.0', 'mask', '0.0.0.0', gw], { timeout: 5000 }, (err, out) => r(err ? `ERR: ${err.message}` : String(out || '').trim() || 'OK')));
      }
    }
    return { ok: true, ...result };
  });

  // ─── Ping host (for DNS test) ─────────────────────────────────────
  ipcMain.handle('ping-host', (_, host) => {
    if (!host || !isValidHost(host)) return { ok: false };
    return new Promise(resolve => {
      const args = process.platform === 'win32'
        ? ['-n', '4', '-w', '1000', host]
        : ['-c', '4', '-W', '1', host];
      execFile('ping', args, { timeout: 8000 }, (err, stdout) => {
        const text = String(stdout || '');
        let avg = null;
        const winAvg = text.match(/Average\s*=\s*(\d+)ms/i);
        const macAvg = text.match(/avg[^=]*=\s*[\d.]+\/([\d.]+)/i);
        if (winAvg) avg = Number(winAvg[1]);
        else if (macAvg) avg = Math.round(Number(macAvg[1]));
        const lossM = text.match(/(\d+)%\s*loss/i) || text.match(/Lost\s*=\s*\d+\s*\((\d+)%/i);
        const loss = lossM ? Number(lossM[1]) : (err ? 100 : 0);
        resolve({ ok: !err && avg !== null, avg, loss });
      });
    });
  });

  // ─── Apply DNS directly (from client DNS dialog) ──────────────────
  ipcMain.handle('apply-dns', async (_, primary, secondary) => {
    if (process.platform !== 'win32') return { ok: false, error: 'فقط روی ویندوز' };
    if (!primary) return { ok: false, error: 'DNS اصلی لازم است' };
    if (!isValidIp(primary)) return { ok: false, error: 'DNS اصلی نامعتبر است' };
    if (secondary && !isValidIp(secondary)) return { ok: false, error: 'DNS ثانویه نامعتبر است' };
    const r = await runApplyDnsPs(primary, secondary || null);
    return { ok: !r.err, out: r.out, error: r.err?.message };
  });

  // ─── Limited task manager ─────────────────────────────────────────
  // Whitelist of processes the user can manage (NO MuteGame, NO system)
  const ALLOWED_PROCS = [
    'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'brave.exe',
    'discord.exe', 'discordcanary.exe', 'discordptb.exe',
    'spotify.exe', 'telegram.exe', 'whatsapp.exe', 'skype.exe',
    'notepad.exe', 'mspaint.exe', 'calc.exe',
    'vlc.exe', 'wmplayer.exe',
  ];

  ipcMain.handle('list-allowed-processes', () => {
    if (process.platform !== 'win32') return [];
    return new Promise(resolve => {
      exec('tasklist /fo csv /nh', { timeout: 5000, maxBuffer: 1024 * 1024 * 4 }, (err, stdout) => {
        if (err) return resolve([]);
        const lines = String(stdout || '').trim().split('\n');
        const seen = new Set();
        const procs = [];
        for (const l of lines) {
          const m = l.match(/^"([^"]+)","(\d+)","([^"]*)","[^"]*","([^"]+)"/);
          if (!m) continue;
          const name = m[1].toLowerCase();
          if (!ALLOWED_PROCS.includes(name)) continue;
          const pid = Number(m[2]);
          const memory = m[4]; // e.g. "12,345 K"
          const key = name + ':' + pid;
          if (seen.has(key)) continue;
          seen.add(key);
          procs.push({ name: m[1], pid, memory });
        }
        resolve(procs);
      });
    });
  });

  ipcMain.handle('kill-process', (_, pid) => {
    if (!pid || process.platform !== 'win32') return { ok: false };
    return new Promise(r => exec(`taskkill /pid ${pid} /f`, { timeout: 3000 }, (err) => r({ ok: !err, error: err?.message })));
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopSleepBlock();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
