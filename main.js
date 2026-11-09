const { app, BrowserWindow, globalShortcut, ipcMain, dialog, shell, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const { parseWindowsArgs } = require('./lib/args');
const {
  runEncodedPowerShell,
  startProcess,
  buildIconExtractScript
} = require('./lib/powershell');
const { launchBatchFile } = require('./lib/launch');
const { createDirAuthorizer, hasTraversal } = require('./lib/path-guard');
const { validateConfig } = require('./lib/config-schema');
const { selectConfiguredLaunch } = require('./lib/launch-policy');
const { isTrustedIpcEvent, hardenRendererWindow } = require('./lib/security-boundary');
const { createIconService, ICON_EXTRACTOR_VERSION } = require('./lib/icon-service');
const { migratePersistedConfig, backupConfigFile, writeJsonAtomic } = require('./lib/config-store');
const { chooseUniqueRepairCandidate } = require('./lib/item-repair');
const {
  parseInternetShortcutBuffer,
  normalizeShellShortcut,
  isProtocolTarget,
  protocolName,
  steamAppId,
  isShortcutPath
} = require('./lib/shortcut');

let win = null;
let settingsWin = null; // Independent Settings Window
let tray = null;
let currentConfig = null;

// 待确认的导入配置：校验通过后先暂存，等用户在界面上二次确认再应用
let pendingImport = null;

const TRUSTED_RENDERER_URLS = Object.freeze({
  main: pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href,
  settings: pathToFileURL(path.join(__dirname, 'renderer', 'settings.html')).href
});

function getTrustedRenderers(roles) {
  return roles.flatMap((role) => {
    const browserWindow = role === 'main' ? win : settingsWin;
    if (!browserWindow || browserWindow.isDestroyed()) return [];
    return [{ webContents: browserWindow.webContents, url: TRUSTED_RENDERER_URLS[role] }];
  });
}

function handleTrustedIpc(channel, roles, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event, getTrustedRenderers(roles))) {
      console.warn(`Blocked untrusted IPC invocation: ${channel}`);
      throw new Error('不受信任的页面无权执行此操作');
    }
    return handler(event, ...args);
  });
}

// 会话级目录授权表：只有用户通过系统对话框亲自选择的目录才允许被枚举
const dirAuthorizer = createDirAuthorizer([app.getPath('userData')]);

// Base64 verified 16x16 PNG for System Tray (Windows requires raster formats like PNG/ICO, SVG fails in shell tray)
const TRAY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAd0lEQVQ4T6WTwREAIAgDscRO7MQS7sQSVsAHF05y8EnkLyHAEhKcc855GQeICJd1gIiI3AAR4bIOEBGRGyAiXNYBIiJyA0SEyzpARETuiWdmzszsNzOzZ+bMnvh95q98f/n+8tP5P50vIvx0vjOzZ2b2mxm/z/wB5j57AgvUTjIAAAAASUVORK5CYII=';

const FALLBACK_ICONS = {
  file: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2FhYSIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgyMTZhMiAyIDAgMCAwIDItMlY4eiIvPjxwYXRoIGQ9Ik0xNCAydjZoNnoiIGZpbGw9IiNmZmYiIG9wYWNpdHk9IjAuMyIvPjwvc3ZnPg==',
  folder: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2U4YTg3YyIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBkPSJNMTAgNEg0Yy0xLjEgMC0xLjk5LjktMS45OSAyTDIgMThjMCAxLjEuOSAyIDIgMmgxNmMxLjEgMCAyLS45IDItMlY4YzAtMS4xLS45LTItMi0yaC04eiIvPjwvc3ZnPg==',
  web: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzQ2OGFmZiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBkPSJNMTQgMmgyYTIgMiAwIDAgMSAyIDJ2MTJhMiAyIDAgMCAxLTIgMmgtMmEyIDIgMCAwIDEtMi0yVjRhMiAyIDAgMCAxIDItMnpNMTIgMTlVNWwtNiA3em0tMy42My01LjMyTDkgMTMuNjNsLTEuNjMtMS42M0w2IDEyLjAybDEuMzctMS4zOHoiLz48L3N2Zz4=',
  steam: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#1675b8"/><circle cx="43" cy="21" r="9" fill="none" stroke="white" stroke-width="5"/><circle cx="20" cy="43" r="7" fill="none" stroke="white" stroke-width="5"/><path d="M26 40l11-13" stroke="white" stroke-width="6" stroke-linecap="round"/></svg>').toString('base64')}`
};

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function createDefaultConfig() {
  return {
    settings: {
      language: 'zh',
      autostart: false,
      hotkey: 'Alt+Q',
      autoHideOnLaunch: true,
      autoHideOnBlur: true,
      pressEscToHide: true,
      clickMode: 'single',
      popupPos: 'center',
      keepCentered: true,
      columns: 8,
      opacity: 85,
      hideNames: false,
      tabHover: false,
      tabScroll: false,
      tabKeys: false,
      styleMode: 'original',
      borderRadius: '8px',
      bgColor: '#1e1e1e',
      accentColor: '#e04f35',
      settingsBgColor: '#1c1c1c',
      settingsAccentColor: '#61269c',
      settingsFollowTheme: true
    },
    tabs: [
      { id: 'tab-1', name: '常用' },
      { id: 'tab-2', name: '游戏' },
      { id: 'tab-3', name: '工具' }
    ],
    items: [
      { id: 'default-cmd', tabId: 'tab-1', name: '命令提示符', path: 'cmd.exe', args: '', icon: '', runAsAdmin: false },
      { id: 'default-explorer', tabId: 'tab-1', name: '文件资源管理器', path: 'explorer.exe', args: '', icon: '', runAsAdmin: false }
    ]
  };
}

// Ensure config exists
function loadConfig() {
  if (currentConfig) return currentConfig;
  let failedConfigBackedUp = false;
  
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      const migration = migratePersistedConfig(parsed);
      const validation = validateConfig(migration.value);
      if (!validation.ok) {
        throw new Error(`本地配置校验失败: ${validation.errors.slice(0, 8).join('；')}`);
      }
      currentConfig = validation.value;
      if (migration.changed) {
        const backupPath = backupConfigFile(CONFIG_PATH);
        writeJsonAtomic(CONFIG_PATH, currentConfig);
        console.info(`Migrated local config; backup saved to ${backupPath}`);
      }
    } catch (e) {
      console.error('Failed to load config:', e);
      try {
        const backupPath = backupConfigFile(CONFIG_PATH);
        failedConfigBackedUp = Boolean(backupPath);
        if (backupPath) console.info(`Invalid local config backed up to ${backupPath}`);
      } catch (backupError) {
        console.error('Failed to back up invalid config:', backupError);
      }
    }
  }
  
  if (!currentConfig) {
    currentConfig = createDefaultConfig();
    if (!fs.existsSync(CONFIG_PATH) || failedConfigBackedUp) saveConfigSync(currentConfig);
  }
  return currentConfig;
}

let saveConfigDebounceTimeout = null;
function saveConfigDebounced(config, delay = 500) {
  if (saveConfigDebounceTimeout) clearTimeout(saveConfigDebounceTimeout);
  saveConfigDebounceTimeout = setTimeout(() => {
    try {
      writeJsonAtomic(CONFIG_PATH, config);
      currentConfig = config;
    } catch (e) {
      console.error('Failed to save config debounced', e);
    }
  }, delay);
}

function saveConfigSync(config) {
  if (saveConfigDebounceTimeout) {
    clearTimeout(saveConfigDebounceTimeout);
    saveConfigDebounceTimeout = null;
  }
  writeJsonAtomic(CONFIG_PATH, config);
  currentConfig = config;
  return currentConfig;
}

// Center window on active monitor
function showWindowCentered() {
  if (!win) return;
  
  const config = loadConfig();
  const popupPos = config.settings.popupPos || 'center';
  
  const cursorPoint = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = activeDisplay.workArea;
  const [winWidth, winHeight] = win.getSize();
  
  let winX, winY;
  
  if (popupPos === 'cursor') {
    winX = Math.round(cursorPoint.x - winWidth / 2);
    winY = Math.round(cursorPoint.y - winHeight / 2);
    
    // Boundary check within active screen
    if (winX < x) winX = x;
    if (winX + winWidth > x + width) winX = x + width - winWidth;
    if (winY < y) winY = y;
    if (winY + winHeight > y + height) winY = y + height - winHeight;
  } else {
    winX = Math.round(x + (width - winWidth) / 2);
    winY = Math.round(y + (height - winHeight) / 2);
  }
  
  win.setPosition(winX, winY);
  win.show();
  win.focus();
  win.webContents.send('window-show');
}

function hideWindow() {
  if (win) {
    win.hide();
    win.webContents.send('window-hide');
  }
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused()) {
    hideWindow();
  } else {
    showWindowCentered();
  }
}

function createWindow() {
  const config = loadConfig();
  const width = config.settings.windowSize?.width || 800;
  const height = config.settings.windowSize?.height || 480;
  
  win = new BrowserWindow({
    width: width,
    height: height,
    minWidth: 400,
    minHeight: 240,
    frame: false,
    transparent: true,
    resizable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 沙箱开启后渲染进程与 preload 运行在受限环境，无法直接触达 Node.js。
      // 拖放文件的真实路径通过 preload 里的 webUtils.getPathForFile 获取，
      // 不再依赖被沙箱移除的 File.path，因此功能不受影响。
      sandbox: true
    }
  });

  hardenRendererWindow(win, TRUSTED_RENDERER_URLS.main);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('resize', () => {
    const [w, h] = win.getSize();
    const cfg = loadConfig();
    if (!cfg.settings.windowSize) {
      cfg.settings.windowSize = {};
    }
    cfg.settings.windowSize.width = w;
    cfg.settings.windowSize.height = h;
    saveConfigDebounced(cfg, 500);
  });

  win.on('close', () => {
    const cfg = loadConfig();
    saveConfigSync(cfg);
  });

  win.once('ready-to-show', () => {
    const isHiddenStartup = process.argv.includes('--hidden');
    if (!isHiddenStartup) {
      showWindowCentered();
    }
  });

  win.on('blur', () => {
    const cfg = loadConfig();
    if (cfg.settings.autoHideOnBlur) {
      // Do not hide launcher window if settings window is active/focused (Req 24)
      if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isFocused()) {
        return;
      }
      hideWindow();
    }
  });

  // Register shortcut on startup
  registerGlobalShortcut(config.settings.hotkey);

  win.on('closed', () => {
    win = null;
  });
}

function registerGlobalShortcut(accelerator) {
  globalShortcut.unregisterAll();
  if (!accelerator) return;
  
  try {
    const ret = globalShortcut.register(accelerator, () => {
      toggleWindow();
    });
    if (!ret) {
      console.error(`Registration failed for shortcut: ${accelerator}`);
    }
  } catch (e) {
    console.error(`Invalid shortcut string: ${accelerator}`, e);
  }
}

function getTrayIcon() {
  const exeDir = path.dirname(app.getPath('exe'));
  
  // 1. Check next to executable (portable mode)
  const exeDirIco = path.join(exeDir, 'tray.ico');
  if (fs.existsSync(exeDirIco)) {
    try {
      return nativeImage.createFromPath(exeDirIco);
    } catch (e) {
      console.error('Failed to load tray.ico next to exe:', e);
    }
  }
  
  const exeDirPng = path.join(exeDir, 'tray.png');
  if (fs.existsSync(exeDirPng)) {
    try {
      return nativeImage.createFromPath(exeDirPng);
    } catch (e) {
      console.error('Failed to load tray.png next to exe:', e);
    }
  }

  // 2. Check in project root/asar directory
  const localIco = path.join(__dirname, 'tray.ico');
  if (fs.existsSync(localIco)) {
    try {
      return nativeImage.createFromPath(localIco);
    } catch (e) {
      console.error('Failed to load local tray.ico:', e);
    }
  }
  
  const localPng = path.join(__dirname, 'tray.png');
  if (fs.existsSync(localPng)) {
    try {
      return nativeImage.createFromPath(localPng);
    } catch (e) {
      console.error('Failed to load local tray.png:', e);
    }
  }

  // 3. Fallback to Base64 PNG
  return nativeImage.createFromBuffer(Buffer.from(TRAY_PNG_BASE64, 'base64')).resize({ width: 16, height: 16 });
}

function createTray() {
  const trayIcon = getTrayIcon();
  
  tray = new Tray(trayIcon);
  tray.setToolTip('Tar V 快捷启动');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏面板', click: () => toggleWindow() },
    { type: 'separator' },
    { label: '退出 Tar V', click: () => {
      app.isQuiting = true;
      app.quit();
    }}
  ]);
  
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    toggleWindow();
  });
}

// Single Instance Lock
const additionalData = { myKey: 'tar-v-launcher' };
const gotTheLock = app.requestSingleInstanceLock(additionalData);

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    // Focus instance
    if (win) {
      showWindowCentered();
    }
  });

  app.whenReady().then(() => {
    loadConfig();
    createWindow();
    createTray();
    
    // Set auto-start initially
    app.setLoginItemSettings({
      openAtLogin: currentConfig.settings.autostart,
      path: app.getPath('exe'),
      args: ['--hidden']
    });
    
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (saveConfigDebounceTimeout) clearTimeout(saveConfigDebounceTimeout);
  pendingImport = null;
  cancelQueuedPowerShell();
  iconService.dispose();
});

// Helper function to resolve environment variables and relative system commands to their absolute paths on Windows
function resolveAbsolutePath(filePath) {
  if (!filePath) return '';
  
  let cleanPath = filePath.trim();
  if (cleanPath.startsWith('"') && cleanPath.endsWith('"')) {
    cleanPath = cleanPath.slice(1, -1);
  }
  
  // Expand environment variables (e.g. %SystemRoot% or %USERPROFILE%)
  cleanPath = cleanPath.replace(/%([^%]+)%/g, (_, n) => process.env[n] || `%${n}%`);
  
  if (path.isAbsolute(cleanPath)) {
    return cleanPath;
  }
  
  // Check standard Windows System32 and Windows directories
  const sysDir = process.env.SystemRoot || 'C:\\Windows';
  const pathsToCheck = [
    path.join(sysDir, 'System32', cleanPath),
    path.join(sysDir, 'system32', cleanPath + '.exe'),
    path.join(sysDir, cleanPath),
    path.join(sysDir, cleanPath + '.exe'),
  ];
  
  for (const p of pathsToCheck) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  // Fallback: search within system PATH environment directories
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter);
  for (const dir of pathDirs) {
    const fullPath1 = path.join(dir, cleanPath);
    if (fs.existsSync(fullPath1)) return fullPath1;
    const fullPath2 = path.join(dir, cleanPath + '.exe');
    if (fs.existsSync(fullPath2)) return fullPath2;
  }
  
  return cleanPath;
}

// --- IPC IPC IPC ---

// Get config
handleTrustedIpc('get-config', ['main', 'settings'], () => {
  return loadConfig();
});

// Save config
handleTrustedIpc('save-config', ['main', 'settings'], (event, newConfig) => {
  const current = loadConfig();
  const candidate = (
    newConfig && typeof newConfig === 'object' && !Array.isArray(newConfig)
  ) ? {
      ...newConfig,
      settings: (
        newConfig.settings && typeof newConfig.settings === 'object' && !Array.isArray(newConfig.settings)
      ) ? { ...newConfig.settings } : newConfig.settings
    } : newConfig;

  // Preserve window sizing configuration (Req 36)
  if (candidate && candidate.settings && current.settings && current.settings.windowSize) {
    candidate.settings.windowSize = current.settings.windowSize;
  }
  if (candidate && candidate.settings && current.settings && current.settings.settingsWindowSize) {
    candidate.settings.settingsWindowSize = current.settings.settingsWindowSize;
  }

  const migratedCandidate = migratePersistedConfig(candidate).value;
  const validation = validateConfig(migratedCandidate);
  if (!validation.ok) {
    return {
      success: false,
      code: 'CONFIG_VALIDATION_FAILED',
      message: validation.errors.slice(0, 8).join('；')
    };
  }

  const cleanConfig = validation.value;
  try {
    saveConfigSync(cleanConfig);
  } catch (error) {
    console.error('Failed to persist config:', error);
    return {
      success: false,
      code: 'CONFIG_WRITE_FAILED',
      message: '无法写入配置文件，请检查磁盘空间和文件权限'
    };
  }
  // Notify the main window to update its view instantly
  if (win && !win.isDestroyed()) {
    win.webContents.send('config-updated', cleanConfig);
  }
  return { success: true, config: cleanConfig, warnings: validation.warnings };
});

// Preview appearance in the launcher without persisting it. Closing Settings restores
// the last saved settings, while Save makes the preview permanent.
handleTrustedIpc('preview-appearance', ['settings'], (event, previewConfig) => {
  const validation = validateConfig(previewConfig);
  if (!validation.ok) {
    return { success: false, error: validation.errors.slice(0, 8).join('；') };
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('appearance-preview', validation.value.settings);
  }
  return { success: true };
});

// Open separate independent settings window
handleTrustedIpc('open-settings-window', ['main'], () => {
  if (settingsWin) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.focus();
    return;
  }
  
  const config = loadConfig();
  const settingsWidth = config.settings.settingsWindowSize?.width || 920;
  const settingsHeight = config.settings.settingsWindowSize?.height || 680;
  
  settingsWin = new BrowserWindow({
    width: settingsWidth,
    height: settingsHeight,
    minWidth: 480,
    minHeight: 420,
    frame: false,
    transparent: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'Tar V - 设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  
  hardenRendererWindow(settingsWin, TRUSTED_RENDERER_URLS.settings);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.show();
  });
  
  // Keep settings window centered on resize (Req 27) and remember size (Req 30)
  let resizeTimeout = null;
  settingsWin.on('resize', () => {
    const [w, h] = settingsWin.getSize();
    const cfg = loadConfig();
    if (!cfg.settings.settingsWindowSize) {
      cfg.settings.settingsWindowSize = {};
    }
    cfg.settings.settingsWindowSize.width = w;
    cfg.settings.settingsWindowSize.height = h;
    saveConfigDebounced(cfg, 500);

    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.center();
      }
    }, 150);
  });
  
  settingsWin.on('close', () => {
    const cfg = loadConfig();
    saveConfigSync(cfg);
    if (win && !win.isDestroyed()) {
      win.webContents.send('appearance-preview', cfg.settings);
    }
  });
  
  settingsWin.on('closed', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    pendingImport = null;
    settingsWin = null;
  });
});

// Concurrency queue for PowerShell icon extraction to prevent system freezing
let activePowerShellCount = 0;
const powershellQueue = [];
const MAX_POWERSHELL_QUEUE = 256;
let acceptsPowerShellTasks = true;

function runNextPowerShell() {
  if (powershellQueue.length === 0 || activePowerShellCount >= 3) {
    return;
  }
  
  activePowerShellCount++;
  const { task, resolve, reject } = powershellQueue.shift();
  
  task()
    .then(resolve)
    .catch(reject)
    .finally(() => {
      activePowerShellCount--;
      runNextPowerShell();
    });
}

function queuePowerShell(task) {
  return new Promise((resolve, reject) => {
    if (!acceptsPowerShellTasks) {
      reject(new Error('图标提取服务正在退出'));
      return;
    }
    if (powershellQueue.length >= MAX_POWERSHELL_QUEUE) {
      reject(new Error('图标提取队列已满，请稍后重试'));
      return;
    }
    powershellQueue.push({ task, resolve, reject });
    runNextPowerShell();
  });
}

function cancelQueuedPowerShell() {
  acceptsPowerShellTasks = false;
  while (powershellQueue.length > 0) {
    powershellQueue.shift().reject(new Error('应用正在退出，图标提取已取消'));
  }
}

// Helper to extract PE icon using PowerShell and .NET System.Drawing/Win32
function extractIconWithPowerShell(targetPath, iconIndex = 0) {
  return queuePowerShell(async () => {
    // 脚本以 Base64 传入（-EncodedCommand），不经过 cmd.exe，也不拼接命令字符串，
    // 因此路径中的引号、反引号、分号等字符都无法跳出参数边界。
    const result = await runEncodedPowerShell(buildIconExtractScript(targetPath, iconIndex), { timeoutMs: 15000 });
    if (result.code !== 0) {
      throw new Error(result.stderr || `PowerShell 退出码 ${result.code}`);
    }
    return result.stdout;
  });
}

function shortcutFallback(filePath = '') {
  return {
    target: filePath,
    args: '',
    cwd: '',
    shortcutPath: isShortcutPath(filePath) ? filePath : '',
    iconPath: '',
    iconIndex: 0,
    kind: ''
  };
}

function resolveShortcutFile(filePath) {
  const fallback = shortcutFallback(filePath);
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || hasTraversal(filePath)) return fallback;

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return fallback;
  }
  if (!stat.isFile()) return fallback;

  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.lnk') {
    try {
      return normalizeShellShortcut(filePath, shell.readShortcutLink(filePath));
    } catch (err) {
      console.error('Failed to resolve shortcut link:', err.message);
      return fallback;
    }
  }
  if (extension === '.url') {
    if (stat.size > 64 * 1024) return fallback;
    try {
      return parseInternetShortcutBuffer(fs.readFileSync(filePath), { sourcePath: filePath });
    } catch (err) {
      console.error('Failed to resolve URL shortcut:', err.message);
      return fallback;
    }
  }
  return fallback;
}

function findUrlFiles(root, maxDepth = 3, depth = 0, output = []) {
  if (!root || depth > maxDepth || !fs.existsSync(root)) return output;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return output;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.url')) output.push(fullPath);
    if (entry.isDirectory()) findUrlFiles(fullPath, maxDepth, depth + 1, output);
  }
  return output;
}

function findShortcutFiles(root, maxDepth = 8, depth = 0, output = []) {
  if (!root || depth > maxDepth || !fs.existsSync(root)) return output;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return output;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && isShortcutPath(fullPath)) output.push(fullPath);
    if (entry.isDirectory()) findShortcutFiles(fullPath, maxDepth, depth + 1, output);
  }
  return output;
}

const repairCandidateTokens = new Map();
let repairShortcutCache = { expiresAt: 0, candidates: [] };
const REPAIR_TOKEN_TTL_MS = 5 * 60 * 1000;
const REPAIR_INDEX_TTL_MS = 2 * 60 * 1000;

function getRepairShortcutRoots() {
  return [...new Set([
    app.getPath('desktop'),
    process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
    process.env.ProgramData ? path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : ''
  ].filter(Boolean).map((root) => path.resolve(root)))];
}

function getRepairShortcutCandidates({ forceRefresh = false } = {}) {
  if (!forceRefresh && repairShortcutCache.expiresAt > Date.now()) {
    return repairShortcutCache.candidates;
  }

  const seen = new Set();
  const candidates = [];
  for (const shortcutPath of getRepairShortcutRoots().flatMap((root) => findShortcutFiles(root))) {
    const details = resolveShortcutFile(shortcutPath);
    if (!details.target) continue;
    if (!isProtocolTarget(details.target) && !fs.existsSync(details.target)) continue;
    const key = `${shortcutPath.toLowerCase()}|${String(details.target).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      name: path.basename(shortcutPath, path.extname(shortcutPath)),
      target: details.target,
      args: details.args || '',
      cwd: details.cwd || '',
      shortcutPath: details.shortcutPath || shortcutPath,
      iconPath: details.iconPath || '',
      iconIndex: Number.isInteger(details.iconIndex) ? details.iconIndex : 0
    });
  }

  repairShortcutCache = { expiresAt: Date.now() + REPAIR_INDEX_TTL_MS, candidates };
  return candidates;
}

function createRepairToken(itemId, candidate) {
  const token = crypto.randomUUID();
  repairCandidateTokens.set(token, {
    itemId,
    candidate,
    expiresAt: Date.now() + REPAIR_TOKEN_TTL_MS
  });
  return token;
}

function pruneRepairTokens() {
  const now = Date.now();
  for (const [token, record] of repairCandidateTokens) {
    if (record.expiresAt <= now) repairCandidateTokens.delete(token);
  }
}

const steamShortcutCache = new Map();
let steamShortcutIndex = null;

function getSteamShortcutRoots() {
  const configuredRoots = [];
  try {
    for (const category of loadConfig().categories || []) {
      for (const item of category.items || []) {
        const candidate = item.shortcutPath || item.path;
        if (typeof candidate === 'string' && isShortcutPath(candidate)) {
          configuredRoots.push(path.dirname(candidate));
        }
      }
    }
  } catch (err) {
    console.error('Failed to inspect configured shortcut roots:', err.message);
  }

  return [...new Set([
    app.getPath('desktop'),
    process.env.PUBLIC ? path.join(process.env.PUBLIC, 'Desktop') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
    process.env.ProgramData ? path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
    ...configuredRoots
  ].filter(Boolean).map((root) => path.resolve(root)))];
}

function getSteamShortcutIndex() {
  if (steamShortcutIndex) return steamShortcutIndex;
  const index = new Map();
  for (const shortcutPath of getSteamShortcutRoots().flatMap((root) => findUrlFiles(root))) {
    const details = resolveShortcutFile(shortcutPath);
    const appId = steamAppId(details.target);
    if (appId && !index.has(appId)) index.set(appId, details);
  }
  steamShortcutIndex = index;
  return index;
}

function findSteamShortcut(target) {
  const appId = steamAppId(target);
  if (!appId) return null;
  if (steamShortcutCache.has(appId)) return steamShortcutCache.get(appId);
  const result = getSteamShortcutIndex().get(appId) || null;
  steamShortcutCache.set(appId, result);
  return result;
}

function enrichIconRequest(input) {
  const request = typeof input === 'string' ? { path: input } : { ...(input || {}) };
  const sourcePath = request.shortcutPath || (isShortcutPath(request.path) ? request.path : '');
  let details = sourcePath ? resolveShortcutFile(sourcePath) : null;
  if (!details && steamAppId(request.path)) details = findSteamShortcut(request.path);

  if (details) {
    request.path = details.target || request.path;
    request.shortcutPath = details.shortcutPath || sourcePath;
    request.iconPath = details.iconPath || request.iconPath || '';
    request.iconIndex = Number.isInteger(details.iconIndex) ? details.iconIndex : (request.iconIndex || 0);
  }
  if (request.path && !isProtocolTarget(request.path) && !isShortcutPath(request.path)) {
    request.path = resolveAbsolutePath(request.path);
  }
  return request;
}

const iconService = createIconService({
  app,
  nativeImage,
  extractExecutableIcon: extractIconWithPowerShell,
  cacheDir: path.join(app.getPath('userData'), `icon-cache-v${ICON_EXTRACTOR_VERSION}`),
  fallbackIcons: FALLBACK_ICONS
});

// Get a native icon using shortcut metadata, bounded caches and in-flight de-duplication.
handleTrustedIpc('get-file-icon', ['main', 'settings'], async (event, input, forceRefresh = false) => {
  return iconService.getIcon(enrichIconRequest(input), { forceRefresh: forceRefresh === true });
});

handleTrustedIpc('resolve-icon-request', ['main', 'settings'], (event, input) => {
  return enrichIconRequest(input);
});

// 判断是否为"系统命令引用"（例如 cmd.exe 这类相对名），交给系统按 PATH 解析
function isSystemCommandRef(cleanPath) {
  return !path.isAbsolute(cleanPath) && !fs.existsSync(cleanPath);
}

function launchFailure(code, message, details = {}) {
  return { success: false, code, message, details };
}

function mapLaunchException(error, filePath) {
  const rawMessage = String(error && error.message || '');
  const code = String(error && error.code || '').toUpperCase();
  if (code === 'EACCES' || code === 'EPERM') {
    return launchFailure('ACCESS_DENIED', '系统拒绝访问该启动项', { path: filePath });
  }
  if (/\b1223\b|cancel(?:led|ed)|已取消|取消了操作/i.test(rawMessage)) {
    return launchFailure('UAC_CANCELLED', '已取消管理员权限请求', { path: filePath });
  }
  return launchFailure('SYSTEM_LAUNCH_FAILED', '系统无法启动该项目', { path: filePath });
}

function spawnDetached(filePath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(filePath, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      child.on('error', (error) => console.error('Detached process error:', error));
      child.unref();
      resolve();
    });
  });
}

function refreshLaunchFromShortcut(item, selection) {
  const shortcutPath = selection.shortcutPath || (item && item.shortcutPath) || '';
  if (!shortcutPath || !fs.existsSync(shortcutPath)) return selection;
  const details = resolveShortcutFile(shortcutPath);
  if (!details.target) return selection;
  return {
    ...selection,
    filePath: details.target,
    args: typeof details.args === 'string' ? details.args : selection.args,
    shortcutPath: details.shortcutPath || shortcutPath
  };
}

// Launch item
handleTrustedIpc('launch-item', ['main'], async (event, itemId, forceRunAsAdmin = false) => {
  const config = loadConfig();
  const selection = selectConfiguredLaunch(config, itemId, forceRunAsAdmin);
  if (!selection.ok) return launchFailure(selection.code || 'ITEM_NOT_FOUND', selection.error);

  const configuredItem = config.items.find((item) => item.id === itemId);
  const launchItem = refreshLaunchFromShortcut(configuredItem, selection.item);
  const { filePath, args, runAsAdmin } = launchItem;
  // 执行层再次确认最终路径，避免字段映射或调用契约回归时把空路径交给系统外壳。
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return launchFailure('EMPTY_PATH', '启动路径为空');
  }
  
  try {
    // Handle web and registered application protocols (for example steam://).
    if (isProtocolTarget(filePath)) {
      const protocol = protocolName(filePath);
      if (['file', 'javascript', 'data', 'vbscript'].includes(protocol)) {
        return launchFailure('PROTOCOL_BLOCKED', '该协议不允许启动', { protocol });
      }
      await shell.openExternal(filePath);
      if (config.settings.autoHideOnLaunch) {
        hideWindow();
      }
      return { success: true };
    }

    // Standard Files and Commands
    const cleanPath = resolveAbsolutePath(filePath);
    const isCommandRef = isSystemCommandRef(cleanPath);
    
    if (!isCommandRef && !fs.existsSync(cleanPath)) {
      return launchFailure('PATH_NOT_FOUND', '启动文件可能已移动或卸载', { path: cleanPath });
    }

    // 参数按 Windows 命令行规则拆分为数组，后续全程不经过任何 shell
    const argList = parseWindowsArgs(typeof args === 'string' ? args : '');
    const extension = path.extname(cleanPath).toLowerCase();
    const isBatchFile = extension === '.bat' || extension === '.cmd';

    if (isBatchFile) {
      // .bat / .cmd 需要命令解释器承载，参数按 cmd 规则转义后执行
      await launchBatchFile(cleanPath, argList, { runAsAdmin: runAsAdmin === true });
    } else if (runAsAdmin) {
      // 提权只能通过 ShellExecute 的 RunAs 动词，参数以 CreateProcess 规则编码
      await startProcess(cleanPath, argList, { runAsAdmin: true });
    } else if (argList.length > 0) {
      await spawnDetached(cleanPath, argList);
    } else {
      // 无参数：优先交给系统外壳，保留文件关联行为
      const err = await shell.openPath(cleanPath);
      if (err) {
        await spawnDetached(cleanPath, []);
      }
    }

    if (config.settings.autoHideOnLaunch) {
      hideWindow();
    }
    return { success: true };
  } catch (error) {
    console.error('Launch failed:', error);
    return mapLaunchException(error, filePath);
  }
});

handleTrustedIpc('find-item-repair', ['main'], (event, itemId) => {
  pruneRepairTokens();
  const config = loadConfig();
  const matches = config.items.filter((item) => item && item.id === itemId);
  if (matches.length !== 1) return launchFailure('ITEM_NOT_FOUND', '无法找到需要修复的项目');
  const item = matches[0];

  let candidate = null;
  if (item.shortcutPath && fs.existsSync(item.shortcutPath)) {
    const details = resolveShortcutFile(item.shortcutPath);
    if (details.target && (isProtocolTarget(details.target) || fs.existsSync(details.target))) {
      candidate = {
        name: path.basename(item.shortcutPath, path.extname(item.shortcutPath)),
        target: details.target,
        args: details.args || '',
        cwd: details.cwd || '',
        shortcutPath: details.shortcutPath || item.shortcutPath,
        iconPath: details.iconPath || '',
        iconIndex: Number.isInteger(details.iconIndex) ? details.iconIndex : 0,
        score: 999
      };
    }
  }

  if (!candidate) {
    candidate = chooseUniqueRepairCandidate(item, getRepairShortcutCandidates({ forceRefresh: true }));
  }
  if (!candidate) {
    return launchFailure('NO_REPAIR_CANDIDATE', '没有找到唯一且可信的新位置', { oldPath: item.path });
  }

  const token = createRepairToken(item.id, candidate);
  return {
    success: true,
    token,
    candidate: {
      name: candidate.name,
      oldPath: item.path,
      newPath: candidate.target,
      shortcutPath: candidate.shortcutPath,
      score: candidate.score
    }
  };
});

handleTrustedIpc('apply-item-repair', ['main'], (event, itemId, token) => {
  pruneRepairTokens();
  if (typeof token !== 'string' || token.length > 128) {
    return launchFailure('INVALID_REPAIR_TOKEN', '修复请求无效或已经过期');
  }
  const record = repairCandidateTokens.get(token);
  repairCandidateTokens.delete(token);
  if (!record || record.itemId !== itemId || record.expiresAt <= Date.now()) {
    return launchFailure('INVALID_REPAIR_TOKEN', '修复请求无效或已经过期');
  }

  const details = resolveShortcutFile(record.candidate.shortcutPath);
  const expectedTarget = record.candidate.target || '';
  const resolvedTarget = details.target || '';
  const targetMatches = isProtocolTarget(expectedTarget) || isProtocolTarget(resolvedTarget)
    ? resolvedTarget === expectedTarget
    : path.resolve(resolvedTarget).toLowerCase() === path.resolve(expectedTarget).toLowerCase();
  if (!details.target || !targetMatches) {
    return launchFailure('REPAIR_TARGET_CHANGED', '快捷方式目标已经变化，请重新扫描');
  }
  if (!isProtocolTarget(details.target) && !fs.existsSync(details.target)) {
    return launchFailure('PATH_NOT_FOUND', '候选启动文件已经不存在', { path: details.target });
  }

  const draft = JSON.parse(JSON.stringify(loadConfig()));
  const matches = draft.items.filter((item) => item && item.id === itemId);
  if (matches.length !== 1) return launchFailure('ITEM_NOT_FOUND', '无法找到需要修复的项目');
  const item = matches[0];
  item.path = details.target;
  item.args = details.args || '';
  item.shortcutPath = details.shortcutPath || record.candidate.shortcutPath;
  item.iconPath = details.iconPath || '';
  item.iconIndex = Number.isInteger(details.iconIndex) ? details.iconIndex : 0;
  item.iconVersion = 0;
  item.icon = '';

  const validation = validateConfig(draft);
  if (!validation.ok) {
    return launchFailure('CONFIG_VALIDATION_FAILED', validation.errors.slice(0, 8).join('；'));
  }
  try {
    saveConfigSync(validation.value);
  } catch (error) {
    console.error('Failed to save repaired item:', error);
    return launchFailure('CONFIG_WRITE_FAILED', '修复结果无法写入配置文件');
  }
  iconService.clear();
  if (win && !win.isDestroyed()) win.webContents.send('config-updated', validation.value);
  return { success: true, config: validation.value, itemId };
});

// Open the containing folder for a configured item without accepting a renderer-supplied path.
handleTrustedIpc('show-item-in-folder', ['main'], (event, itemId) => {
  const config = loadConfig();
  const selection = selectConfiguredLaunch(config, itemId, false);
  if (!selection.ok) return launchFailure(selection.code || 'ITEM_NOT_FOUND', selection.error);
  const configuredItem = config.items.find((item) => item.id === itemId);
  const { filePath } = refreshLaunchFromShortcut(configuredItem, selection.item);
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return launchFailure('EMPTY_PATH', '启动路径为空');
  }
  if (isProtocolTarget(filePath)) {
    return launchFailure('NO_LOCAL_LOCATION', '协议启动项没有本地位置');
  }

  const cleanPath = resolveAbsolutePath(filePath);
  if (!path.isAbsolute(cleanPath) || !fs.existsSync(cleanPath)) {
    return launchFailure('PATH_NOT_FOUND', '无法找到启动项的本地位置', { path: cleanPath });
  }

  shell.showItemInFolder(cleanPath);
  return { success: true };
});

// File chooser
handleTrustedIpc('select-file', ['main'], async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender) || win;
  const result = await dialog.showOpenDialog(senderWindow, {
    properties: ['openFile'],
    title: '选择快捷启动文件'
  });
  
  if (result.canceled || result.filePaths.length === 0) return null;

  // 用户亲自选中的文件所在目录，加入本次会话的授权范围
  dirAuthorizer.allowParentOf(result.filePaths[0]);
  return result.filePaths[0];
});

// Folder chooser
handleTrustedIpc('select-folder', ['main'], async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender) || win;
  const result = await dialog.showOpenDialog(senderWindow, {
    properties: ['openDirectory'],
    title: '选择快捷启动文件夹'
  });
  
  if (result.canceled || result.filePaths.length === 0) return null;

  // 只有用户亲自选择的目录才允许后续被枚举
  dirAuthorizer.allow(result.filePaths[0]);
  return result.filePaths[0];
});

// Auto-start setting
handleTrustedIpc('update-autostart', ['settings'], (event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe'),
    args: ['--hidden']
  });
  const config = loadConfig();
  config.settings.autostart = enabled;
  saveConfigSync(config);
  return { success: true };
});

// Change Global Hotkey
handleTrustedIpc('register-shortcut', ['settings'], (event, accelerator) => {
  registerGlobalShortcut(accelerator);
  const config = loadConfig();
  config.settings.hotkey = accelerator;
  saveConfigSync(config);
  return { success: true };
});

// Check file paths existence
handleTrustedIpc('check-paths', ['settings'], (event, paths) => {
  if (!Array.isArray(paths)) return [];

  // 只回答"当前配置里确实存在的启动项路径"，避免该接口被当作任意文件系统探测器
  const config = loadConfig();
  const knownPaths = new Set(
    (Array.isArray(config.items) ? config.items : [])
      .filter((item) => item && typeof item.path === 'string' && item.path.length > 0)
      .map((item) => path.resolve(item.path))
  );

  return paths.map((p) => {
    if (typeof p !== 'string' || p.length === 0) return false;
    if (isProtocolTarget(p)) return true;

    // 相对系统命令（如 cmd.exe）不做存在性探测，一律视为可用
    if (!path.isAbsolute(p)) return true;

    if (!knownPaths.has(path.resolve(p))) return false;

    try {
      return fs.existsSync(p);
    } catch (err) {
      return false;
    }
  });
});

handleTrustedIpc('hide-window', ['main'], () => {
  hideWindow();
  return { success: true };
});

handleTrustedIpc('close-app', ['main'], () => {
  app.isQuiting = true;
  app.quit();
});

handleTrustedIpc('center-window', ['main'], () => {
  showWindowCentered();
  return { success: true };
});

// Export Config
handleTrustedIpc('export-config', ['settings'], async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender) || win;
  const result = await dialog.showSaveDialog(senderWindow, {
    title: '导出配置文件',
    defaultPath: path.join(app.getPath('downloads'), 'tar-v-config.json'),
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) return null;

  try {
    const config = loadConfig();
    const exportable = {
      ...config,
      items: config.items.map((item) => ({ ...item, icon: '' }))
    };
    fs.writeFileSync(result.filePath, JSON.stringify(exportable, null, 2), 'utf-8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Import Config — 第一步：读取 + 校验，暂存待确认
handleTrustedIpc('import-config', ['settings'], async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender) || win;
  const result = await dialog.showOpenDialog(senderWindow, {
    title: '导入配置文件',
    filters: [{ name: 'JSON 配置文件', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  try {
    const fileStat = fs.statSync(result.filePaths[0]);
    if (fileStat.size > 8 * 1024 * 1024) {
      throw new Error('配置文件过大（上限 8MB）');
    }

    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(data);

    // 字段与类型白名单校验：未知字段、超长字段、悬空引用一律拒绝
    const validation = validateConfig(parsed);
    if (!validation.ok) {
      return { success: false, error: validation.errors.slice(0, 8).join('；') };
    }

    // 不落盘、不生效，先暂存等待用户二次确认
    pendingImport = { config: validation.value, sourcePath: result.filePaths[0] };

    return {
      success: true,
      requiresConfirmation: true,
      summary: validation.summary,
      warnings: validation.warnings
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Import Config — 第二步：用户确认后才真正应用
handleTrustedIpc('confirm-import-config', ['settings'], async (event, accept) => {
  if (!pendingImport) {
    return { success: false, error: '没有待确认的导入配置' };
  }

  if (accept !== true) {
    pendingImport = null;
    return { success: true, applied: false };
  }

  const importedConfig = pendingImport.config;
  try {
    saveConfigSync(importedConfig);
  } catch (error) {
    console.error('Failed to save imported config:', error);
    return { success: false, error: '无法写入导入配置，请检查磁盘空间和文件权限' };
  }
  pendingImport = null;

  // 自启动与全局热键属于危险设置，只在确认后应用
  registerGlobalShortcut(importedConfig.settings.hotkey);
  app.setLoginItemSettings({
    openAtLogin: importedConfig.settings.autostart === true,
    path: app.getPath('exe'),
    args: ['--hidden']
  });

  if (win && !win.isDestroyed()) {
    win.reload();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('show-import-success');
    });
  }
  return { success: true, applied: true };
});

// Get all files inside a folder (non-recursive) for batch importing
handleTrustedIpc('get-folder-files', ['main'], async (event, folderPath) => {
  try {
    if (typeof folderPath !== 'string' || folderPath.length === 0) {
      return { success: false, error: '路径无效' };
    }
    if (!path.isAbsolute(folderPath)) {
      return { success: false, error: '只支持绝对路径' };
    }
    // 目录枚举是敏感操作：只允许用户通过「选择文件夹」对话框亲自授权过的目录
    if (!dirAuthorizer.isAllowed(folderPath)) {
      return { success: false, error: '该目录未获授权，请通过「文件夹」按钮重新选择' };
    }

    const folderStat = fs.statSync(folderPath);
    if (!folderStat.isDirectory()) {
      return { success: false, error: '目标不是文件夹' };
    }

    const files = fs.readdirSync(folderPath);
    const result = [];
    
    for (const file of files) {
      const fullPath = path.join(folderPath, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (err) {
        continue; // 跳过无权限或已失效的条目
      }
      
      if (stat.isFile()) {
        result.push({
          name: file,
          path: fullPath
        });
      }
    }
    return { success: true, files: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Resolve windows .lnk and .url shortcuts target
handleTrustedIpc('resolve-shortcut', ['main'], (event, filePath) => {
  if (typeof filePath !== 'string' || filePath.length === 0) return shortcutFallback('');
  return resolveShortcutFile(filePath);
});
