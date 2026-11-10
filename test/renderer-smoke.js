'use strict';

/**
 * 渲染层冒烟测试（需要在 Electron 中运行）：
 *
 *   npm run test:renderer
 *
 * 目的：验证在「沙箱开启 + 严格 CSP」之后，页面仍能正常加载、preload 桥接可用、
 * 本地字体生效、控制台没有 CSP 违规。
 *
 * 这里注册了主进程 IPC 的最小桩实现，让渲染层脚本能完整跑一遍初始化流程。
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { isTrustedIpcEvent, hardenRendererWindow } = require('../lib/security-boundary');

const root = path.join(__dirname, '..');
const resultPath = path.join(root, 'test', 'renderer-smoke-result.json');
const profilePath = path.join(root, 'test', 'renderer-smoke-profile');

fs.mkdirSync(profilePath, { recursive: true });
app.setPath('userData', profilePath);
app.setPath('cache', path.join(profilePath, 'cache'));

const pageErrors = [];
let testWindow = null;
let activeTrustedUrl = '';
let previewRequests = 0;
let iconRequests = 0;
let forcedIconRequests = 0;
let saveRequests = 0;
let metadataCommitRequests = 0;

const stubConfig = {
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
    settingsBgColor: '#151517',
    settingsAccentColor: '#61269c',
    settingsFollowTheme: true
  },
  tabs: [{ id: 'tab-1', name: '常用' }],
  items: [
    { id: 'i1', tabId: 'tab-1', name: '命令提示符', path: 'cmd.exe', args: '', icon: '', runAsAdmin: false },
    {
      id: 'xss-item',
      tabId: 'tab-1',
      name: '<img id="tar-v-xss-marker" src=x onerror="window.__tarVXss=true">',
      path: 'C:\\missing\\\"><img id="tar-v-path-xss-marker" src=x>',
      args: '',
      icon: '',
      runAsAdmin: false
    }
  ]
};

const ICON_STUB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ICON_RESULT_STUB = { url: ICON_STUB, source: 'target-resource', fallback: false, errorCode: '' };

const stubs = {
  'get-config': () => stubConfig,
  'save-config': (event, config) => {
    saveRequests++;
    return config.items.some((item) => item.name === '__FAIL_SAVE__')
      ? { success: false, code: 'CONFIG_WRITE_FAILED', message: 'simulated write failure' }
      : { success: true, config };
  },
  'preview-appearance': () => {
    previewRequests++;
    return { success: true };
  },
  'get-file-icon': (event, request, forceRefresh) => {
    iconRequests++;
    if (forceRefresh === true) forcedIconRequests++;
    return ICON_RESULT_STUB;
  },
  'resolve-icon-request': (event, request) => request,
  'commit-icon-metadata': (event, updates) => {
    metadataCommitRequests++;
    return { success: true, applied: updates.length, skipped: 0 };
  },
  'launch-item': () => ({ success: true }),
  'find-item-repair': () => ({ success: false, code: 'NO_REPAIR_CANDIDATE', message: 'not found' }),
  'apply-item-repair': () => ({ success: false, code: 'INVALID_REPAIR_TOKEN', message: 'invalid' }),
  'show-item-in-folder': () => ({ success: true }),
  'select-file': () => null,
  'select-folder': () => null,
  'update-autostart': () => ({ success: true }),
  'register-shortcut': () => ({ success: true }),
  'check-paths': (event, paths) => paths.map(() => false),
  'hide-window': () => ({ success: true }),
  'close-app': () => ({ success: true }),
  'center-window': () => ({ success: true }),
  'export-config': () => null,
  'import-config': () => null,
  'confirm-import-config': () => ({ success: true, applied: false }),
  'get-folder-files': () => ({ success: true, files: [] }),
  'resolve-shortcut': () => ({ target: '', args: '', cwd: '', iconPath: '' }),
  'open-settings-window': () => undefined
};

for (const [channel, handler] of Object.entries(stubs)) {
  ipcMain.handle(channel, (event, ...args) => {
    const allowed = testWindow
      ? [{ webContents: testWindow.webContents, url: activeTrustedUrl }]
      : [];
    if (!isTrustedIpcEvent(event, allowed)) {
      throw new Error(`IPC source rejected during smoke test: ${channel}`);
    }
    return handler(event, ...args);
  });
}

function finish(payload) {
  try {
    fs.writeFileSync(resultPath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('写入结果失败', err);
  }
  console.log(JSON.stringify(payload));
  app.exit(payload.ok ? 0 : 1);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 480,
    webPreferences: {
      preload: path.join(root, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  testWindow = win;

  let messages = [];

  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    if (first && typeof first === 'object' && 'message' in first) {
      messages.push({ level: first.level, message: first.message });
    } else {
      messages.push({ level: args[1], message: args[2] });
    }
  });

  win.webContents.on('render-process-gone', (event, details) => {
    pageErrors.push('render-process-gone: ' + JSON.stringify(details));
  });

  const pages = [
    { file: 'renderer/index.html', label: 'index' },
    { file: 'renderer/settings.html', label: 'settings' }
  ];
  const pageResults = [];

  for (const page of pages) {
    messages = [];
    iconRequests = 0;
    forcedIconRequests = 0;
    saveRequests = 0;
    metadataCommitRequests = 0;
    try {
      const pagePath = path.join(root, page.file);
      activeTrustedUrl = pathToFileURL(pagePath).href;
      hardenRendererWindow(win, activeTrustedUrl);
      await win.loadFile(pagePath);
      await new Promise((r) => setTimeout(r, 1200));
      const initialIconMetrics = { iconRequests, forcedIconRequests, saveRequests, metadataCommitRequests };

      const checks = await win.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        let deadPathEscaped = true;
        let dedicatedSettingsStyles = true;
        let settingsUsesNoGradients = true;
        let aplombSettingsStructure = true;
        let settingsColorsWork = true;
        let floatingButtonsClearContent = true;
        let settingsOuterFrameRemoved = true;
        let controlTextCentered = true;
        let footerButtonsReadable = true;
        let contextMenusAccessible = true;
        let contextMenusDebug = null;
        let saveFailureRollsBack = true;
        if (${JSON.stringify(page.label)} === 'index') {
          const menu = document.getElementById('context-menu');
          const card = document.querySelector('.grid-item');
          const tab = document.querySelector('.tab-item');
          const grid = document.querySelector('.grid-container');
          const openMenu = async (target) => {
            target.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: 120,
              clientY: 120
            }));
            await new Promise((resolve) => setTimeout(resolve, 40));
            return Array.from(menu.querySelectorAll('button.context-item'));
          };
          const cardItems = await openMenu(card);
          const menuStyle = getComputedStyle(menu);
          const firstButtonStyle = getComputedStyle(cardItems[0]);
          const menuWidth = menuStyle.width;
          const menuRadius = menuStyle.borderRadius;
          const menuBackgroundImage = menuStyle.backgroundImage;
          const firstFontSize = firstButtonStyle.fontSize;
          const firstMinHeight = firstButtonStyle.minHeight;
          const firstFocused = document.activeElement === cardItems[0];
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
          const downMovedFocus = document.activeElement === cardItems[1];
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
          const endMovedFocus = document.activeElement === cardItems.at(-1);
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          const focusRestored = document.activeElement === card && menu.getAttribute('aria-hidden') === 'true';

          const tabItems = await openMenu(tab);
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          const backgroundItems = await openMenu(grid);
          menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

          const allMenuItems = [...cardItems, ...tabItems, ...backgroundItems];
          contextMenusDebug = {
            counts: [cardItems.length, tabItems.length, backgroundItems.length],
            rolesAndIcons: allMenuItems.every((button) => button.tagName === 'BUTTON' && button.getAttribute('role') === 'menuitem' && !!button.querySelector('svg[aria-hidden="true"]')),
            hasEmoji: /[\u{1F300}-\u{1FAFF}]/u.test(allMenuItems.map((button) => button.textContent).join('')),
            menuWidth,
            radius: menuRadius,
            backgroundImage: menuBackgroundImage,
            fontSize: firstFontSize,
            minHeight: firstMinHeight,
            firstFocused,
            downMovedFocus,
            endMovedFocus,
            focusRestored
          };
          contextMenusAccessible = cardItems.length >= 5 && tabItems.length === 2 && backgroundItems.length === 6 &&
            allMenuItems.every((button) => button.tagName === 'BUTTON' && button.getAttribute('role') === 'menuitem' &&
              !!button.querySelector('svg[aria-hidden="true"]')) &&
            !/[\u{1F300}-\u{1FAFF}]/u.test(allMenuItems.map((button) => button.textContent).join('')) &&
            menuWidth === '224px' && menuRadius === '10px' && menuBackgroundImage === 'none' &&
            firstFontSize === '14px' && firstMinHeight === '38px' &&
            firstFocused && downMovedFocus && endMovedFocus && focusRestored;

          await openMenu(card);
          menu.querySelector('[data-action="edit"]').click();
          await new Promise((resolve) => setTimeout(resolve, 20));
          document.getElementById('item-name').value = '__FAIL_SAVE__';
          document.getElementById('modal-save-btn').click();
          await new Promise((resolve) => setTimeout(resolve, 80));
          document.getElementById('dialog-confirm-btn').click();
          await new Promise((resolve) => setTimeout(resolve, 80));
          saveFailureRollsBack = !document.body.textContent.includes('__FAIL_SAVE__') &&
            Array.from(document.querySelectorAll('.grid-item .item-name')).some((node) => node.textContent.includes('命令提示符'));
        }
        if (${JSON.stringify(page.label)} === 'settings') {
          dedicatedSettingsStyles = Array.from(document.styleSheets).some((sheet) =>
            String(sheet.href || '').endsWith('/settings.css')
          );
          const visualNodes = [
            document.body,
            document.querySelector('.settings-window-container'),
            document.querySelector('.settings-sidebar'),
            document.querySelector('.settings-section.active'),
            document.querySelector('.sidebar-item.active'),
            document.getElementById('btn-settings-save')
          ].filter(Boolean);
          settingsUsesNoGradients = visualNodes.every((node) =>
            getComputedStyle(node).backgroundImage === 'none'
          );
          document.querySelector('.sidebar-item[data-tab="settings-appearance"]').click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          const appearanceGrid = document.querySelector('#settings-appearance .settings-card-grid');
          const firstCard = document.querySelector('#settings-appearance .settings-card');
          const settingsBgInput = document.getElementById('opt-settings-bg-color');
          const settingsAccentInput = document.getElementById('opt-settings-accent-color');
          const settingsFollowInput = document.getElementById('opt-settings-follow-theme');
          const firstSettingRow = document.querySelector('#settings-appearance .setting-row');
          const footer = document.querySelector('.settings-footer');
          const settingsWindow = document.querySelector('.settings-window-container');
          const saveButton = document.getElementById('btn-settings-save');
          const cancelButton = document.getElementById('btn-settings-cancel');
          const firstSelectTrigger = document.querySelector('.custom-select-trigger');
          aplombSettingsStructure = !!document.querySelector('.settings-chrome') &&
            !!document.getElementById('btn-window-close') &&
            !document.querySelector('.sidebar-brand-mark') &&
            document.querySelectorAll('#settings-appearance .settings-card').length >= 3 &&
            !document.querySelector('#settings-appearance .studio-hero') &&
            !document.getElementById('opt-bg-color') &&
            !!appearanceGrid && getComputedStyle(appearanceGrid).display === 'block' &&
            !!firstCard && getComputedStyle(firstCard).boxShadow === 'none' &&
            !!firstSettingRow && getComputedStyle(firstSettingRow).borderRadius === '0px' &&
            !!footer && getComputedStyle(footer).borderTopWidth === '0px' &&
            getComputedStyle(settingsWindow).boxShadow === 'none' &&
            parseFloat(getComputedStyle(document.querySelector('.sidebar-item')).fontSize) >= 17 &&
            getComputedStyle(document.querySelector('.sidebar-nav')).flexDirection === 'row' &&
            !!settingsBgInput && !!settingsAccentInput && !!settingsFollowInput;
          settingsOuterFrameRemoved = getComputedStyle(document.body).padding === '0px' &&
            getComputedStyle(settingsWindow).borderTopWidth === '0px' &&
            getComputedStyle(settingsWindow).borderRightWidth === '0px' &&
            getComputedStyle(settingsWindow).borderBottomWidth === '0px' &&
            getComputedStyle(settingsWindow).borderLeftWidth === '0px';
          controlTextCentered = !!firstSelectTrigger &&
            getComputedStyle(firstSelectTrigger).textAlign === 'center' &&
            getComputedStyle(firstSelectTrigger).justifyContent === 'center' &&
            getComputedStyle(firstSelectTrigger).alignItems === 'center' &&
            getComputedStyle(settingsBgInput).textAlign === 'center';
          footerButtonsReadable = [saveButton, cancelButton].every((button) => {
            const style = getComputedStyle(button);
            return parseFloat(style.fontSize) === 16 &&
              parseInt(style.fontWeight, 10) === 400 &&
              style.justifyContent === 'center' && style.alignItems === 'center' &&
              style.textAlign === 'center';
          });
          const styleMode = document.getElementById('opt-style-mode');
          styleMode.value = 'light';
          styleMode.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 50));
          const followsLightTheme = getComputedStyle(document.body).getPropertyValue('--settings-bg-custom').trim() === '#ffffff' &&
            getComputedStyle(document.body).getPropertyValue('--studio-accent').trim() === '#61269c';
          settingsFollowInput.checked = false;
          settingsFollowInput.dispatchEvent(new Event('change', { bubbles: true }));
          settingsBgInput.value = '#20242b';
          settingsBgInput.dispatchEvent(new Event('input', { bubbles: true }));
          settingsAccentInput.value = '#22c55e';
          settingsAccentInput.dispatchEvent(new Event('input', { bubbles: true }));
          const launcherAccentInput = document.getElementById('opt-accent-color');
          launcherAccentInput.value = '#e85d3f';
          launcherAccentInput.dispatchEvent(new Event('input', { bubbles: true }));
          settingsColorsWork = followsLightTheme &&
            getComputedStyle(document.documentElement).getPropertyValue('--settings-bg-custom').trim() === '#20242b' &&
            getComputedStyle(document.documentElement).getPropertyValue('--studio-accent').trim() === '#22c55e' &&
            getComputedStyle(document.body).getPropertyValue('--settings-bg-custom').trim() === '#20242b' &&
            getComputedStyle(document.body).getPropertyValue('--studio-accent').trim() === '#22c55e';
          const content = document.querySelector('.settings-content');
          content.scrollTop = content.scrollHeight;
          await new Promise((resolve) => setTimeout(resolve, 50));
          const appearanceRows = Array.from(document.querySelectorAll('#settings-appearance .setting-row'));
          const lastRow = appearanceRows.at(-1);
          floatingButtonsClearContent = !!lastRow && !!saveButton &&
            lastRow.getBoundingClientRect().bottom + 10 <= saveButton.getBoundingClientRect().top;
          document.getElementById('btn-scan-paths').click();
          await new Promise((resolve) => setTimeout(resolve, 100));
          const pathName = document.querySelector('.path-item-row .path-name');
          deadPathEscaped = !!pathName &&
            pathName.textContent.includes('<img id="tar-v-xss-marker"') &&
            !document.getElementById('tar-v-xss-marker') &&
            !document.getElementById('tar-v-path-xss-marker') &&
            window.__tarVXss !== true;
        }
        return {
          hasApi: typeof window.api === 'object' && window.api !== null,
          hasRequire: typeof window.require !== 'undefined',
          hasProcess: typeof window.process !== 'undefined',
          hasModule: typeof window.module !== 'undefined',
          cspMeta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
          interLoaded: document.fonts.check('16px Inter'),
          title: document.title,
          deadPathEscaped,
          dedicatedSettingsStyles,
          settingsUsesNoGradients,
          aplombSettingsStructure,
          settingsColorsWork,
          floatingButtonsClearContent,
          settingsOuterFrameRemoved,
          controlTextCentered,
          footerButtonsReadable,
          contextMenusAccessible,
          contextMenusDebug,
          saveFailureRollsBack,
          popupBlocked: window.open('https://example.com/') === null
        };
      })()`);

      checks.mainPreviewSent = page.label !== 'settings' || previewRequests > 0;
      checks.iconMigrationDeduplicated = page.label !== 'index' || (
        initialIconMetrics.iconRequests === stubConfig.items.length &&
        initialIconMetrics.forcedIconRequests === stubConfig.items.length &&
        initialIconMetrics.saveRequests === 0 &&
        initialIconMetrics.metadataCommitRequests === 1
      );
      checks.initialIconMetrics = initialIconMetrics;

      await win.webContents.executeJavaScript("window.location.href = 'https://example.com/'; true");
      await new Promise((r) => setTimeout(r, 100));
      checks.navigationBlocked = win.webContents.getURL() === activeTrustedUrl;

      const snapshot = messages.slice();
      const cspViolations = snapshot.filter((m) =>
        /Content Security Policy|Refused to/i.test(String(m.message))
      );
      const errorMessages = snapshot
        .filter((m) => {
          const level = typeof m.level === 'number' ? m.level : String(m.level);
          return level === 3 || level === 'error';
        })
        .map((m) => m.message);

      pageResults.push({
        page: page.label,
        checks,
        cspViolations,
        errorMessages,
        consoleCount: snapshot.length
      });
    } catch (err) {
      pageErrors.push(`${page.label} exception: ` + err.message);
    }
  }

  const allGood = pageResults.length === pages.length && pageResults.every((r) =>
    r.checks && r.checks.hasApi && !r.checks.hasRequire && !r.checks.hasProcess &&
    !r.checks.hasModule && r.checks.cspMeta && r.checks.interLoaded && r.checks.deadPathEscaped &&
    r.checks.dedicatedSettingsStyles && r.checks.settingsUsesNoGradients && r.checks.aplombSettingsStructure &&
    r.checks.settingsColorsWork &&
    r.checks.floatingButtonsClearContent && r.checks.settingsOuterFrameRemoved &&
    r.checks.controlTextCentered && r.checks.footerButtonsReadable && r.checks.mainPreviewSent &&
    r.checks.contextMenusAccessible &&
    r.checks.iconMigrationDeduplicated &&
    r.checks.saveFailureRollsBack &&
    r.checks.popupBlocked && r.checks.navigationBlocked &&
    r.cspViolations.length === 0 && r.errorMessages.length === 0
  );

  finish({
    ok: allGood && pageErrors.length === 0,
    pages: pageResults,
    pageErrors
  });
});

setTimeout(() => finish({ ok: false, pageErrors: ['timeout'] }), 25000);
