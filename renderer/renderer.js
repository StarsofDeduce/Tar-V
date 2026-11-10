// Renderer Process logic for Tar V Launcher
let config = null;
let activeTabId = null;
let selectedItemId = null;
let isBatchMode = false;
let selectedItemsForBatch = new Set();
let draggedItemId = null;
let draggedTabId = null;
const ICON_EXTRACTOR_VERSION = 4;
const runtimeIconCache = new Map();
const runtimeIconLoads = new Map();
let persistedConfig = null;
let contextMenuTrigger = null;

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function acceptCanonicalConfig(value) {
  config = value;
  persistedConfig = cloneConfig(value);
}

function isProtocolPath(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function iconRequestFromItem(item) {
  return {
    name: item.name || '',
    path: item.path || '',
    shortcutPath: item.shortcutPath || '',
    iconPath: item.iconPath || '',
    iconIndex: Number.isInteger(item.iconIndex) ? item.iconIndex : 0
  };
}

function applyIconMetadata(item, request, iconResult = null) {
  if (!request.inferredShortcutPath) item.shortcutPath = request.shortcutPath || '';
  item.iconPath = request.iconPath || '';
  item.iconIndex = Number.isInteger(request.iconIndex) ? request.iconIndex : 0;
  item.iconVersion = iconResult && iconResult.fallback === false ? ICON_EXTRACTOR_VERSION : 0;
  item.icon = '';
}

async function loadItemIcon(item, { forceRefresh = false } = {}) {
  if (runtimeIconLoads.has(item.id)) return runtimeIconLoads.get(item.id);
  const promise = (async () => {
    const request = await window.api.resolveIconRequest(iconRequestFromItem(item));
    const iconResult = await window.api.getFileIcon(request, forceRefresh);
    runtimeIconCache.set(item.id, iconResult.url);
    applyIconMetadata(item, request, iconResult);
    return iconResult.url;
  })().finally(() => runtimeIconLoads.delete(item.id));
  runtimeIconLoads.set(item.id, promise);
  return promise;
}

async function migrateLegacyIconsInBackground() {
  let changed = 0;
  for (const item of config.items) {
    if (item.iconVersion === ICON_EXTRACTOR_VERSION) continue;
    try {
      await loadItemIcon(item, { forceRefresh: true });
      changed++;
      if (changed % 10 === 0) await persistCurrentConfig({ showError: false });
    } catch (err) {
      console.error('Background icon migration failed:', item.name, err);
    }
  }
  if (changed > 0) await persistCurrentConfig({ showError: false });
}

// Dictionary for multi-language translation (Req 34)
const TRANSLATIONS = {
  zh: {
    searchPlaceholder: "输入关键字搜索...",
    dragOverlayText: "拖拽文件、文件夹或快捷方式到此处添加",
    noMatchHint: "无匹配搜索结果",
    ctxOpen: "打开",
    ctxAdmin: "以管理员身份运行",
    ctxLocation: "打开文件位置",
    ctxBatch: "批量选择/管理...",
    ctxEdit: "编辑属性",
    ctxDelete: "删除快捷方式",
    ctxTabRename: "重命名标签",
    ctxTabDelete: "删除标签",
    ctxBgAdd: "添加快捷项目...",
    ctxBgAddTab: "新建分组标签...",
    ctxBgImportFolder: "批量导入文件夹内容...",
    ctxBgBatch: "批量管理项目...",
    ctxBgSort: "按名称排序当前标签",
    ctxBgClean: "清理当前标签重复项",
    promptNewTab: "请输入新分组名称:",
    promptRenameTab: "修改分组标签名称:",
    confirmDeleteTab: "确定要删除标签 \"{name}\" 及其所有快捷项吗？",
    alertNoTab: "请先新建或选择一个分组标签！",
    alertFolderReadFail: "无法读取该目录: ",
    alertFolderEmpty: "所选文件夹是空的，未找到任何文件项目。",
    alertImportSuccess: "成功在当前分组中导入 {count} 个快捷启动项！",
    confirmDeleteItem: "确定要删除快捷项 \"{name}\" 吗？",
    alertLaunchFail: "启动失败：",
    alertSaveFail: "保存失败：",
    launchErrorTitle: "无法打开项目",
    launch_ITEM_NOT_FOUND: "该项目尚未成功保存，请重新添加。",
    launch_EMPTY_PATH: "该项目没有有效的启动路径。",
    launch_PATH_NOT_FOUND: "启动文件可能已移动、更新或卸载。",
    launch_ACCESS_DENIED: "系统拒绝访问该启动项。",
    launch_UAC_CANCELLED: "已取消管理员权限请求。",
    launch_PROTOCOL_BLOCKED: "出于安全原因，该协议不能启动。",
    launch_SYSTEM_LAUNCH_FAILED: "Windows 无法启动该项目。",
    launch_NO_LOCAL_LOCATION: "该启动项没有可显示的本地文件位置。",
    launch_GENERIC: "启动时发生未知错误。",
    repairSearchPrompt: "是否查找该软件的新位置？",
    repairCandidatePrompt: "找到一个可信的新位置，确认修复吗？\n\n旧路径：{old}\n新路径：{next}",
    repairNotFoundPrompt: "没有找到唯一可信的新位置。是否手动重新选择文件？",
    repairSuccess: "启动路径和图标来源已修复。",
    repairFailed: "修复失败：",
    repairAction: "查找并修复",
    manualRelocateAction: "重新选择文件",
    
    // Modals
    editTitleAdd: "添加快捷项目",
    editTitleEdit: "编辑快捷项属性",
    editLabelName: "快捷名称",
    editLabelPath: "路径 / 网址",
    editLabelArgs: "运行参数",
    editLabelAdmin: "默认以管理员身份运行",
    editPlaceholderName: "输入显示名称",
    editPlaceholderPath: "C:\\Path\\to\\file.exe 或 https://...",
    editPlaceholderArgs: "可选运行参数 (仅可执行文件有效)",
    
    // Buttons
    btnCancel: "取消",
    btnSave: "保存",
    btnConfirm: "确定",
    alertFieldsEmpty: "项目名称和启动路径不可为空！",
    msg_import_success: "备份配置已成功导入！软件将自动重载应用设置。",
    msg_import_fail: "导入配置失败: ",

    // Batch UI
    batchSelectedCount: "已选中 {count} 个项目",
    batchSelectAll: "全选",
    batchMovePlaceholder: "移动到分组...",
    batchEdit: "批量修改",
    batchDelete: "批量删除",
    batchBtnCancel: "取消",
    alertBatchSelectDelete: "请先选中需要删除的项目！",
    confirmBatchDelete: "确定要批量删除这 {count} 个快捷项吗？",
    alertBatchDeleteSuccess: "批量删除完成！",
    alertBatchSelectMove: "请先选中需要移动的快捷项！",
    alertBatchMoveSuccess: "批量移动完成！",

    batchEditTitle: "批量修改属性",
    batchEditDesc: "勾选想要修改的属性并设置新值：",
    batchEditEnableAdmin: "修改“管理员身份运行”属性",
    batchEditAdmin: "默认以管理员身份运行",
    batchEditEnableArgs: "修改“运行参数”属性",
    batchEditPlaceholderArgs: "输入新的运行参数 (留空表示清除参数)",
    batchEditBtnSave: "保存修改",
    alertBatchSelectEdit: "请先选中需要修改的项目！",
    alertBatchSelectProps: "请勾选至少一个想要修改的属性！",
    alertBatchEditSuccess: "批量修改项目属性成功！"
  },
  en: {
    searchPlaceholder: "Search shortcuts...",
    dragOverlayText: "Drag & drop files, folders, or shortcuts here to add",
    noMatchHint: "No matching search results",
    ctxOpen: "Open",
    ctxAdmin: "Run as Administrator",
    ctxLocation: "Open File Location",
    ctxBatch: "Batch Select/Manage...",
    ctxEdit: "Edit Properties",
    ctxDelete: "Delete Shortcut",
    ctxTabRename: "Rename Tab",
    ctxTabDelete: "Delete Tab",
    ctxBgAdd: "Add Shortcut...",
    ctxBgAddTab: "New Tab Group...",
    ctxBgImportFolder: "Batch Import Folder...",
    ctxBgBatch: "Batch Manage...",
    ctxBgSort: "Sort Current Tab",
    ctxBgClean: "Clean Duplicates",
    promptNewTab: "Please enter new group name:",
    promptRenameTab: "Modify group tab name:",
    confirmDeleteTab: "Are you sure you want to delete tab \"{name}\" and all its shortcuts?",
    alertNoTab: "Please create or select a tab first!",
    alertFolderReadFail: "Cannot read directory: ",
    alertFolderEmpty: "The selected folder is empty. No files found.",
    alertImportSuccess: "Successfully imported {count} items into the current tab!",
    confirmDeleteItem: "Are you sure you want to delete shortcut \"{name}\"?",
    alertLaunchFail: "Failed to launch: ",
    alertSaveFail: "Failed to save: ",
    launchErrorTitle: "Unable to Open Item",
    launch_ITEM_NOT_FOUND: "This item was not saved successfully. Please add it again.",
    launch_EMPTY_PATH: "This item does not have a valid launch path.",
    launch_PATH_NOT_FOUND: "The launch file may have moved, updated, or been uninstalled.",
    launch_ACCESS_DENIED: "Windows denied access to this item.",
    launch_UAC_CANCELLED: "The administrator permission request was cancelled.",
    launch_PROTOCOL_BLOCKED: "This protocol is blocked for security reasons.",
    launch_SYSTEM_LAUNCH_FAILED: "Windows could not start this item.",
    launch_NO_LOCAL_LOCATION: "This item does not have a local file location to show.",
    launch_GENERIC: "An unknown launch error occurred.",
    repairSearchPrompt: "Search for the application's new location?",
    repairCandidatePrompt: "A trusted new location was found. Apply this repair?\n\nOld path: {old}\nNew path: {next}",
    repairNotFoundPrompt: "No unique trusted location was found. Select the file manually?",
    repairSuccess: "The launch path and icon source were repaired.",
    repairFailed: "Repair failed: ",
    repairAction: "Find and Repair",
    manualRelocateAction: "Select File",
    
    // Modals
    editTitleAdd: "Add Shortcut",
    editTitleEdit: "Edit Properties",
    editLabelName: "Shortcut Name",
    editLabelPath: "Path / URL",
    editLabelArgs: "Arguments",
    editLabelAdmin: "Run as Administrator by default",
    editPlaceholderName: "Enter display name",
    editPlaceholderPath: "C:\\Path\\to\\file.exe or https://...",
    editPlaceholderArgs: "Optional run arguments (executables only)",
    
    // Buttons
    btnCancel: "Cancel",
    btnSave: "Save",
    btnConfirm: "Confirm",
    alertFieldsEmpty: "Shortcut name and path cannot be empty!",
    msg_import_success: "Configurations imported successfully! Reloading application settings.",
    msg_import_fail: "Import backup failed: ",

    // Batch UI
    batchSelectedCount: "{count} items selected",
    batchSelectAll: "Select All",
    batchMovePlaceholder: "Move to group...",
    batchEdit: "Batch Edit",
    batchDelete: "Batch Delete",
    batchBtnCancel: "Cancel",
    alertBatchSelectDelete: "Please select items to delete first!",
    confirmBatchDelete: "Are you sure you want to delete {count} selected shortcuts?",
    alertBatchDeleteSuccess: "Batch deletion completed!",
    alertBatchSelectMove: "Please select items to move first!",
    alertBatchMoveSuccess: "Batch move completed!",

    batchEditTitle: "Batch Edit Properties",
    batchEditDesc: "Check properties to modify and set new values:",
    batchEditEnableAdmin: "Modify 'Run as Administrator' property",
    batchEditAdmin: "Run as Administrator by default",
    batchEditEnableArgs: "Modify 'Arguments' property",
    batchEditPlaceholderArgs: "Enter new arguments (leave empty to clear)",
    batchEditBtnSave: "Save Changes",
    alertBatchSelectEdit: "Please select items to edit first!",
    alertBatchSelectProps: "Please check at least one property to modify!",
    alertBatchEditSuccess: "Batch properties updated successfully!"
  }
};

function translateUI() {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;

  // Header and static components
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.placeholder = t.searchPlaceholder;

  const dragOverlayP = document.querySelector('#drag-overlay p');
  if (dragOverlayP) dragOverlayP.textContent = t.dragOverlayText;

  // Edit Modal labels
  const labelName = document.querySelector('label[for="item-name"]');
  if (labelName) labelName.textContent = t.editLabelName;
  const placeholderName = document.getElementById('item-name');
  if (placeholderName) placeholderName.placeholder = t.editPlaceholderName;

  const labelPath = document.querySelector('label[for="item-path"]');
  if (labelPath) labelPath.textContent = t.editLabelPath;
  const placeholderPath = document.getElementById('item-path');
  if (placeholderPath) placeholderPath.placeholder = t.editPlaceholderPath;

  const labelArgs = document.querySelector('label[for="item-args"]');
  if (labelArgs) labelArgs.textContent = t.editLabelArgs;
  const placeholderArgs = document.getElementById('item-args');
  if (placeholderArgs) placeholderArgs.placeholder = t.editPlaceholderArgs;

  const labelAdmin = document.querySelector('label[for="item-admin"]');
  if (labelAdmin) labelAdmin.textContent = t.editLabelAdmin;

  const editCancelBtn = document.getElementById('modal-cancel-btn');
  if (editCancelBtn) editCancelBtn.textContent = t.btnCancel;
  const editSaveBtn = document.getElementById('modal-save-btn');
  if (editSaveBtn) editSaveBtn.textContent = t.btnSave;

  // Batch action bar static texts
  const batchSelectAllBtn = document.getElementById('batch-select-all-btn');
  if (batchSelectAllBtn) batchSelectAllBtn.textContent = t.batchSelectAll;
  
  const batchEditBtn = document.getElementById('batch-edit-btn');
  if (batchEditBtn) batchEditBtn.textContent = t.batchEdit;

  const batchDeleteBtn = document.getElementById('batch-delete-btn');
  if (batchDeleteBtn) batchDeleteBtn.textContent = t.batchDelete;

  const batchCancelBtn = document.getElementById('batch-cancel-btn');
  if (batchCancelBtn) batchCancelBtn.textContent = t.batchBtnCancel;

  // Batch Edit Modal
  const batchEditTitleEl = document.getElementById('batch-edit-title');
  if (batchEditTitleEl) batchEditTitleEl.textContent = t.batchEditTitle;
  
  const batchEditDescP = document.querySelector('#batch-edit-modal .modal-body p');
  if (batchEditDescP) batchEditDescP.textContent = t.batchEditDesc;

  const labelBatchEnableAdmin = document.querySelector('label[for="batch-enable-admin"]');
  if (labelBatchEnableAdmin) labelBatchEnableAdmin.textContent = t.batchEditEnableAdmin;

  const labelBatchAdmin = document.querySelector('label[for="batch-item-admin"]');
  if (labelBatchAdmin) labelBatchAdmin.textContent = t.batchEditAdmin;

  const labelBatchEnableArgs = document.querySelector('label[for="batch-enable-args"]');
  if (labelBatchEnableArgs) labelBatchEnableArgs.textContent = t.batchEditEnableArgs;

  const inputBatchArgs = document.getElementById('batch-item-args');
  if (inputBatchArgs) inputBatchArgs.placeholder = t.batchEditPlaceholderArgs;

  const batchEditCancelBtn = document.getElementById('batch-edit-cancel-btn');
  if (batchEditCancelBtn) batchEditCancelBtn.textContent = t.btnCancel;
  
  const batchEditSaveBtn = document.getElementById('batch-edit-save-btn');
  if (batchEditSaveBtn) batchEditSaveBtn.textContent = t.batchEditBtnSave;

  // Dialog/Prompt modals Confirm/Cancel labels
  const dialogCancelBtn = document.getElementById('dialog-cancel-btn');
  if (dialogCancelBtn) dialogCancelBtn.textContent = t.btnCancel;
  const dialogConfirmBtn = document.getElementById('dialog-confirm-btn');
  if (dialogConfirmBtn) dialogConfirmBtn.textContent = t.btnConfirm;

  const promptCancelBtn = document.getElementById('prompt-cancel-btn');
  if (promptCancelBtn) promptCancelBtn.textContent = t.btnCancel;
  const promptConfirmBtn = document.getElementById('prompt-confirm-btn');
  if (promptConfirmBtn) promptConfirmBtn.textContent = t.btnConfirm;
  
  // Initialize custom HTML selects (Req 41)
  initCustomSelects();
}

function initCustomSelects() {
  const selects = document.querySelectorAll('select.dropdown-style');
  selects.forEach(select => {
    let container = select.parentElement;
    if (!container.classList.contains('custom-select-container')) {
      container = document.createElement('div');
      container.className = 'custom-select-container';
      select.parentNode.insertBefore(container, select);
      container.appendChild(select);
    }
    
    const oldTrigger = container.querySelector('.custom-select-trigger');
    if (oldTrigger) oldTrigger.remove();
    const oldOptions = container.querySelector('.custom-select-options');
    if (oldOptions) oldOptions.remove();
    
    select.style.display = 'none';
    
    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger dropdown-style';
    
    const selectedOpt = select.options[select.selectedIndex] || select.options[0];
    trigger.textContent = selectedOpt ? selectedOpt.textContent : '';
    container.appendChild(trigger);
    
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';
    
    Array.from(select.options).forEach((opt, idx) => {
      const optDiv = document.createElement('div');
      optDiv.className = 'custom-select-option';
      if (opt.selected) {
        optDiv.classList.add('selected');
      }
      optDiv.textContent = opt.textContent;
      optDiv.dataset.value = opt.value;
      optDiv.dataset.index = idx;
      
      optDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        select.value = opt.value;
        const event = new Event('change', { bubbles: true });
        select.dispatchEvent(event);
        
        trigger.textContent = opt.textContent;
        optionsContainer.querySelectorAll('.custom-select-option').forEach(child => {
          child.classList.remove('selected');
        });
        optDiv.classList.add('selected');
        optionsContainer.classList.remove('active');
      });
      optionsContainer.appendChild(optDiv);
    });
    
    container.appendChild(optionsContainer);
    
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-select-options').forEach(el => {
        if (el !== optionsContainer) el.classList.remove('active');
      });
      optionsContainer.classList.toggle('active');
    });
  });
}

// Global click handler to dismiss custom dropdowns
document.addEventListener('click', () => {
  document.querySelectorAll('.custom-select-options').forEach(el => {
    el.classList.remove('active');
  });
});

// DOM Elements
const tabsContainer = document.getElementById('tabs-container');
const tabsList = document.getElementById('tabs-list');
const addTabBtn = document.getElementById('add-tab-btn');
const itemsGrid = document.getElementById('items-grid');
const dragOverlay = document.getElementById('drag-overlay');
const gridContainer = document.getElementById('grid-container');

// Search Bar
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search');

// Header Buttons
const settingsBtn = document.getElementById('settings-btn');
const closeBtn = document.getElementById('close-btn');

// Context Menu Element
const contextMenu = document.getElementById('context-menu');

// Edit Item Modal
const editModal = document.getElementById('edit-modal');
const modalTitle = document.getElementById('modal-title');
const itemNameInput = document.getElementById('item-name');
const itemPathInput = document.getElementById('item-path');
const itemArgsInput = document.getElementById('item-args');
const itemAdminCheck = document.getElementById('item-admin');
const modalSaveBtn = document.getElementById('modal-save-btn');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalCloseX = editModal.querySelector('.modal-close');

// Debounced save config helper
let saveConfigTimeout = null;
function debouncedSaveConfig() {
  if (saveConfigTimeout) clearTimeout(saveConfigTimeout);
  saveConfigTimeout = setTimeout(() => {
    persistCurrentConfig({ showError: false });
  }, 1000);
}

// Custom Alert Modal
function showCustomAlert(message, { title = null } = {}) {
  return new Promise((resolve) => {
    const dialogModal = document.getElementById('dialog-modal');
    const dialogTitle = document.getElementById('dialog-title');
    const dialogMessage = document.getElementById('dialog-message');
    const confirmBtn = document.getElementById('dialog-confirm-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');
    const closeX = document.getElementById('dialog-close-x');
    
    const lang = config && config.settings ? (config.settings.language || 'zh') : 'zh';
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    dialogTitle.textContent = title || (lang === 'zh' ? '提示' : 'Notice');
    dialogMessage.textContent = message;
    cancelBtn.style.display = 'none';
    dialogModal.style.display = 'flex';
    
    const cleanUp = () => {
      dialogModal.style.display = 'none';
      cancelBtn.style.display = 'inline-block';
      confirmBtn.removeEventListener('click', onConfirm);
      closeX.removeEventListener('click', onConfirm);
      document.removeEventListener('keydown', onKeyDown);
      confirmBtn.textContent = t.btnConfirm;
      resolve();
    };
    
    const onConfirm = () => cleanUp();
    const onKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') cleanUp();
    };
    
    confirmBtn.addEventListener('click', onConfirm);
    closeX.addEventListener('click', onConfirm);
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => confirmBtn.focus());
  });
}

// Custom Confirm Modal
function showCustomConfirm(message, { title = null, confirmLabel = null, cancelLabel = null } = {}) {
  return new Promise((resolve) => {
    const dialogModal = document.getElementById('dialog-modal');
    const dialogTitle = document.getElementById('dialog-title');
    const dialogMessage = document.getElementById('dialog-message');
    const confirmBtn = document.getElementById('dialog-confirm-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');
    const closeX = document.getElementById('dialog-close-x');
    
    const lang = config && config.settings ? (config.settings.language || 'zh') : 'zh';
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    dialogTitle.textContent = title || (lang === 'zh' ? '提示' : 'Notice');
    dialogMessage.textContent = message;
    confirmBtn.textContent = confirmLabel || t.btnConfirm;
    cancelBtn.textContent = cancelLabel || t.btnCancel;
    cancelBtn.style.display = 'inline-block';
    dialogModal.style.display = 'flex';
    
    const cleanUp = (value) => {
      dialogModal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeX.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeyDown);
      confirmBtn.textContent = t.btnConfirm;
      cancelBtn.textContent = t.btnCancel;
      resolve(value);
    };
    
    const onConfirm = () => cleanUp(true);
    const onCancel = () => cleanUp(false);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') onConfirm();
    };
    
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeX.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => confirmBtn.focus());
  });
}

async function persistCurrentConfig({ showError = true } = {}) {
  const saved = await window.api.saveConfig(config);
  if (saved && saved.success) {
    acceptCanonicalConfig(saved.config || config);
    return true;
  }

  if (persistedConfig) {
    config = cloneConfig(persistedConfig);
    if (!config.tabs.some((tab) => tab.id === activeTabId)) {
      activeTabId = config.tabs.length > 0 ? config.tabs[0].id : null;
    }
    if (tabsList && itemsGrid) {
      renderTabs();
      renderItems(searchInput ? searchInput.value : '');
    }
  }
  if (showError) {
    const lang = config && config.settings ? (config.settings.language || 'zh') : 'zh';
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    await showCustomAlert(t.alertSaveFail + (saved && (saved.message || saved.error) || t.launch_GENERIC));
  }
  return false;
}

function launchErrorText(result) {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const code = result && result.code ? result.code : 'GENERIC';
  const reason = t[`launch_${code}`] || t.launch_GENERIC;
  const failedPath = result && result.details && result.details.path;
  return failedPath ? `${reason}\n\n${failedPath}` : reason;
}

async function manuallyRelocateItem(itemId) {
  const selectedPath = await window.api.selectFile();
  if (!selectedPath) return false;

  const draftItem = config.items.find((item) => item.id === itemId);
  if (!draftItem) return false;

  let targetPath = selectedPath;
  let targetArgs = draftItem.args || '';
  let shortcutDetails = null;
  if (/\.(lnk|url)$/i.test(selectedPath)) {
    shortcutDetails = await window.api.resolveShortcut(selectedPath);
    if (!shortcutDetails || !shortcutDetails.target) return false;
    targetPath = shortcutDetails.target;
    targetArgs = shortcutDetails.args || '';
  }

  const iconRequest = await window.api.resolveIconRequest({
    name: draftItem.name,
    path: targetPath,
    shortcutPath: shortcutDetails ? shortcutDetails.shortcutPath : '',
    iconPath: shortcutDetails ? shortcutDetails.iconPath : '',
    iconIndex: shortcutDetails ? shortcutDetails.iconIndex : 0
  });
  const iconResult = await window.api.getFileIcon(iconRequest, true);
  draftItem.path = targetPath;
  draftItem.args = targetArgs;
  applyIconMetadata(draftItem, iconRequest, iconResult);
  runtimeIconCache.set(draftItem.id, iconResult.url);

  if (!await persistCurrentConfig()) {
    renderItems();
    return false;
  }
  renderItems();
  return true;
}

async function repairMissingItem(itemId) {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const result = await window.api.findItemRepair(itemId);

  if (result && result.success) {
    const candidate = result.candidate;
    const approved = await showCustomConfirm(
      t.repairCandidatePrompt.replace('{old}', candidate.oldPath || '').replace('{next}', candidate.newPath || ''),
      { title: t.launchErrorTitle, confirmLabel: t.repairAction }
    );
    if (!approved) return false;

    const applied = await window.api.applyItemRepair(itemId, result.token);
    if (!applied || !applied.success) {
      await showCustomAlert(t.repairFailed + (applied && applied.message || t.launch_GENERIC), { title: t.launchErrorTitle });
      return false;
    }

    acceptCanonicalConfig(applied.config);
    const repairedItem = config.items.find((item) => item.id === itemId);
    if (repairedItem) {
      try {
        await loadItemIcon(repairedItem, { forceRefresh: true });
        await persistCurrentConfig({ showError: false });
      } catch (error) {
        console.error('Failed to refresh repaired icon:', error);
      }
    }
    renderTabs();
    renderItems();
    await showCustomAlert(t.repairSuccess);
    return true;
  }

  if (result && result.code && result.code !== 'NO_REPAIR_CANDIDATE') {
    await showCustomAlert(t.repairFailed + (result.message || t.launch_GENERIC), { title: t.launchErrorTitle });
    return false;
  }

  const manual = await showCustomConfirm(t.repairNotFoundPrompt, {
    title: t.launchErrorTitle,
    confirmLabel: t.manualRelocateAction
  });
  if (!manual) return false;
  const repaired = await manuallyRelocateItem(itemId);
  if (repaired) await showCustomAlert(t.repairSuccess);
  return repaired;
}

async function handleLaunchFailure(itemId, result) {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  if (result && result.code === 'PATH_NOT_FOUND') {
    const shouldRepair = await showCustomConfirm(
      `${launchErrorText(result)}\n\n${t.repairSearchPrompt}`,
      { title: t.launchErrorTitle, confirmLabel: t.repairAction }
    );
    if (shouldRepair) await repairMissingItem(itemId);
    return;
  }
  await showCustomAlert(launchErrorText(result), { title: t.launchErrorTitle });
}

async function launchConfiguredItem(itemId, forceRunAsAdmin = false) {
  const result = await window.api.launchItem(itemId, forceRunAsAdmin);
  if (!result || !result.success) await handleLaunchFailure(itemId, result || { code: 'GENERIC' });
  return Boolean(result && result.success);
}

// Custom Prompt Modal
function showCustomPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    const promptModal = document.getElementById('prompt-modal');
    const promptMessage = document.getElementById('prompt-message');
    const promptInput = document.getElementById('prompt-input');
    const confirmBtn = document.getElementById('prompt-confirm-btn');
    const cancelBtn = document.getElementById('prompt-cancel-btn');
    const closeX = document.getElementById('prompt-close-x');
    
    promptMessage.textContent = message;
    promptInput.value = defaultValue;
    promptModal.style.display = 'flex';
    setTimeout(() => promptInput.focus(), 50);
    
    const cleanUp = (value) => {
      promptModal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeX.removeEventListener('click', onCancel);
      promptInput.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    
    const onConfirm = () => cleanUp(promptInput.value.trim());
    const onCancel = () => cleanUp(null);
    const onKeyDown = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };
    
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeX.addEventListener('click', onCancel);
    promptInput.addEventListener('keydown', onKeyDown);
  });
}

// Initialize the app
async function init() {
  acceptCanonicalConfig(await window.api.getConfig());
  
  mergeDefaultSettings();
  
  if (config.tabs.length > 0) {
    activeTabId = config.tabs[0].id;
  }
  
  translateUI(); // Apply language translations dynamically (Req 34)
  applyAppearanceSettings();
  renderTabs();
  renderItems();
  setupEventListeners();
  setTimeout(() => migrateLegacyIconsInBackground(), 750);

  // Listen to prefers-color-scheme theme changes dynamically (Req 35)
  const themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  themeMediaQuery.addEventListener('change', () => {
    if (config.settings.styleMode === 'system') {
      applyAppearanceSettings();
    }
  });
}

function mergeDefaultSettings() {
  const defaults = {
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
    styleMode: 'dark',
    borderRadius: '8px',
    bgColor: '#1e1e1e',
    accentColor: '#e04f35',
    showSearch: true,
    fontSizeTab: 14,
    fontSizeItem: 13,
    fontSizeSettings: 14
  };
  
  if (!config.settings) config.settings = {};
  for (const key in defaults) {
    if (config.settings[key] === undefined) {
      config.settings[key] = defaults[key];
    }
  }
  // Migrate old styleModes (Req 35)
  if (config.settings.styleMode === 'glass' || config.settings.styleMode === 'liquid' || config.settings.styleMode === 'original') {
    config.settings.styleMode = 'dark';
  }
}

// Apply settings and customization sizers to HTML CSS variables
function applyAppearanceSettings(settings = config.settings) {
  const styleMode = settings.styleMode || 'dark';
  const radius = settings.borderRadius || '8px';
  const accentColor = settings.accentColor || '#e04f35';
  const opacity = settings.opacity !== undefined ? settings.opacity : 85;
  const alpha = opacity / 100;

  // Set theme background color with opacity (Req 35)
  let baseColor = { r: 30, g: 30, b: 30 }; // dark theme background
  if (styleMode === 'light' || (styleMode === 'system' && !window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    baseColor = { r: 245, g: 245, b: 247 }; // light theme background
  }

  // Apply theme class to body
  document.body.classList.remove('light-theme', 'dark-theme');
  if (styleMode === 'light') {
    document.body.classList.add('light-theme');
  } else if (styleMode === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (styleMode === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.add(isDark ? 'dark-theme' : 'light-theme');
  }

  // Set columns
  const cols = settings.columns || 8;
  itemsGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  
  if (settings.hideNames) {
    itemsGrid.classList.add('hide-names');
  } else {
    itemsGrid.classList.remove('hide-names');
  }

  // Apply rounded corners and blurred background to launcher
  const container = document.querySelector('.app-container');
  if (container) {
    container.style.borderRadius = radius;
    container.style.background = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
    container.style.backdropFilter = 'none';
    container.style.webkitBackdropFilter = 'none';
  }

  // Search box visibility
  const searchBox = document.querySelector('.search-box');
  if (searchBox) {
    searchBox.style.display = settings.showSearch !== false ? 'flex' : 'none';
  }

  // Custom font sizers variables
  const fsTab = settings.fontSizeTab || 14;
  const fsItem = settings.fontSizeItem || 13;
  const fsSettings = settings.fontSizeSettings || 14;

  document.documentElement.style.setProperty('--accent', accentColor);
  document.documentElement.style.setProperty('--border-focus', accentColor);
  document.documentElement.style.setProperty('--accent-gradient', accentColor);
  document.documentElement.style.setProperty('--accent-light', lightenColor(accentColor, 15));
  
  // Apply the font size variables
  document.documentElement.style.setProperty('--font-size-tab', `${fsTab}px`);
  document.documentElement.style.setProperty('--font-size-item', `${fsItem}px`);
  document.documentElement.style.setProperty('--font-size-settings', `${fsSettings}px`);
}

function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-fd])([a-fd])([a-fd])$/i;
  const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-fd]{2})([a-fd]{2})([a-fd]{2})$/i.exec(fullHex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 30, g: 30, b: 30 };
}

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace("#", ""), 16),
        amt = Math.round(2.55 * percent),
        R = (num >> 16) + amt,
        G = (num >> 8 & 0x00FF) + amt,
        B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R < 255 ? R < 0 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 0 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 0 ? 0 : B : 255)).toString(16).slice(1);
}

function getVisualLength(str) {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0x4e00 && code <= 0x9fff) || 
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0x3000 && code <= 0x303f)) {
      len += 1.0;
    } else {
      len += 0.5;
    }
  }
  return len;
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hasCJK(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if ((code >= 0x4e00 && code <= 0x9fff) || 
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0x3000 && code <= 0x303f)) {
      return true;
    }
  }
  return false;
}

function formatItemName(name) {
  if (!name) return '';
  const escapedName = escapeHTML(name);
  const visualLen = getVisualLength(name);
  if (visualLen <= 5.0) {
    return `<div class="name-line">${escapedName}</div>`;
  }
  const containsCJK = hasCJK(name);
  if (containsCJK) {
    const L = name.length;
    const A = Math.floor(L / 2);
    const part1 = name.substring(0, A);
    const part2 = name.substring(A);
    return `<div class="name-line">${escapeHTML(part1)}</div><div class="name-line">${escapeHTML(part2)}</div>`;
  } else {
    if (name.includes(' ')) {
      const words = name.trim().split(/\s+/);
      if (words.length > 1) {
        let minDiff = Infinity;
        let splitIdx = 1;
        for (let i = 1; i < words.length; i++) {
          const part1 = words.slice(0, i).join(' ');
          const part2 = words.slice(i).join(' ');
          const len1 = getVisualLength(part1);
          const len2 = getVisualLength(part2);
          const diff = Math.abs(len1 - len2);
          if (diff < minDiff) {
            minDiff = diff;
            splitIdx = i;
          }
        }
        const part1 = words.slice(0, splitIdx).join(' ');
        const part2 = words.slice(splitIdx).join(' ');
        return `<div class="name-line">${escapeHTML(part1)}</div><div class="name-line">${escapeHTML(part2)}</div>`;
      }
    }
    return `<div class="name-line">${escapedName}</div>`;
  }
}

function renderTabs() {
  tabsList.innerHTML = '';
  config.tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab-item ${tab.id === activeTabId ? 'active' : ''}`;
    tabEl.textContent = tab.name;
    tabEl.dataset.id = tab.id;
    tabEl.tabIndex = 0;
    
    tabEl.addEventListener('click', () => {
      activeTabId = tab.id;
      renderTabs();
      renderItems();
    });

    let hoverTimeout = null;
    tabEl.addEventListener('mouseenter', () => {
      if (config.settings.tabHover) {
        hoverTimeout = setTimeout(() => {
          activeTabId = tab.id;
          renderTabs();
          renderItems();
        }, 200);
      }
    });
    
    tabEl.addEventListener('mouseleave', () => {
      if (hoverTimeout) clearTimeout(hoverTimeout);
    });

    tabEl.addEventListener('dblclick', () => {
      renameTab(tab.id);
    });

    // Make tabs exchangeable (reorderable by drag-and-drop) (Req 2)
    tabEl.setAttribute('draggable', 'true');
    
    tabEl.addEventListener('dragstart', (e) => {
      draggedTabId = tab.id;
      e.dataTransfer.setData('text/plain', tab.id);
      tabEl.classList.add('tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('tab-dragging');
      tabsList.querySelectorAll('.tab-item').forEach(el => {
        el.classList.remove('tab-drag-over');
      });
      draggedTabId = null;
    });

    tabEl.addEventListener('dragover', (e) => {
      if (draggedTabId && draggedTabId !== tab.id) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabEl.classList.add('tab-drag-over');
      }
    });

    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('tab-drag-over');
    });

    tabEl.addEventListener('drop', async (e) => {
      if (!draggedTabId || draggedTabId === tab.id) return;
      e.preventDefault();
      
      const draggedIdx = config.tabs.findIndex(t => t.id === draggedTabId);
      const targetIdx = config.tabs.findIndex(t => t.id === tab.id);
      
      if (draggedIdx !== -1 && targetIdx !== -1) {
        const draggedTab = config.tabs[draggedIdx];
        config.tabs.splice(draggedIdx, 1);
        config.tabs.splice(targetIdx, 0, draggedTab);
        
        if (await persistCurrentConfig()) renderTabs();
      }
      draggedTabId = null;
    });

    tabsList.appendChild(tabEl);
  });
}

async function renderItems(query = '') {
  const currentIds = new Set(config.items.map((item) => item.id));
  for (const itemId of runtimeIconCache.keys()) {
    if (!currentIds.has(itemId)) runtimeIconCache.delete(itemId);
  }
  itemsGrid.innerHTML = '';
  
  let itemsToRender = [];
  const isSearch = query.trim().length > 0;
  
  if (isSearch) {
    const cleanQuery = query.toLowerCase().trim();
    itemsToRender = config.items.filter(item => 
      item.name.toLowerCase().includes(cleanQuery) || 
      item.path.toLowerCase().includes(cleanQuery)
    );
  } else {
    itemsToRender = config.items.filter(item => item.tabId === activeTabId);
  }

  if (itemsToRender.length === 0) {
    if (isSearch) {
      const lang = config.settings.language || 'zh';
      const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
      const hint = document.createElement('div');
      hint.style.gridColumn = `span ${config.settings.columns || 8}`;
      hint.style.textAlign = 'center';
      hint.style.padding = '40px 0';
      hint.style.color = 'var(--text-muted)';
      hint.style.fontSize = '12px';
      hint.textContent = t.noMatchHint;
      itemsGrid.appendChild(hint);
    }
    return;
  }

  for (const item of itemsToRender) {
    const card = document.createElement('div');
    card.className = `grid-item ${isBatchMode ? 'batch-mode-item' : ''} ${isBatchMode && selectedItemsForBatch.has(item.id) ? 'batch-selected' : ''}`;
    card.dataset.id = item.id;
    card.tabIndex = 0;

    if (isBatchMode) {
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'batch-checkbox';
      chk.checked = selectedItemsForBatch.has(item.id);
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBatchItemSelection(item.id);
      });
      card.appendChild(chk);
    }

    const iconWrap = document.createElement('div');
    iconWrap.className = 'item-icon-wrapper';

    const iconImg = document.createElement('img');
    iconImg.className = 'item-icon';
    iconImg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2FhYSIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgyMTZhMiAyIDAgMCAwIDItMlY4eiIvPjxwYXRoIGQ9Ik0xNCAydjZoNnoiIGZpbGw9IiNmZmYiIG9wYWNpdHk9IjAuMyIvPjwvc3ZnPg==';
    iconImg.addEventListener('error', () => {
      runtimeIconCache.delete(item.id);
      iconImg.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iI2FhYSIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgyMTZhMiAyIDAgMCAwIDItMlY4eiIvPjxwYXRoIGQ9Ik0xNCAydjZoNnoiIGZpbGw9IiNmZmYiIG9wYWNpdHk9IjAuMyIvPjwvc3ZnPg==';
    }, { once: true });
    
    iconWrap.appendChild(iconImg);
    iconImg.setAttribute('draggable', 'false'); // Prevents browser image drag delay (Req 46)
    card.appendChild(iconWrap);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'item-name';
    nameSpan.innerHTML = formatItemName(item.name);
    card.appendChild(nameSpan);

    if (isSearch) {
      const parentTab = config.tabs.find(t => t.id === item.tabId);
      if (parentTab) {
        const tabSpan = document.createElement('span');
        tabSpan.className = 'item-search-tab';
        tabSpan.textContent = parentTab.name;
        card.appendChild(tabSpan);
      }
    }

    itemsGrid.appendChild(card);

    // Keep icon payloads out of config. The main process owns bounded memory/disk caches.
    const runtimeIcon = runtimeIconCache.get(item.id);
    if (runtimeIcon) iconImg.src = runtimeIcon;
    else if (item.icon) iconImg.src = item.icon; // legacy placeholder while migration runs

    if (!runtimeIcon) {
      const requiresMigration = item.iconVersion !== ICON_EXTRACTOR_VERSION;
      loadItemIcon(item, { forceRefresh: requiresMigration }).then((url) => {
        if (iconImg.isConnected) iconImg.src = url;
        if (requiresMigration) debouncedSaveConfig();
      }).catch((err) => {
        console.error('File icon extraction error', err);
      });
    }

    const launchHandler = () => launchConfiguredItem(item.id);

    if (isBatchMode) {
      card.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleBatchItemSelection(item.id);
      });
    } else {
      // Direct Ctrl+Click toggle batch select (Req 31)
      card.addEventListener('click', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          
          if (!isBatchMode) {
            isBatchMode = true;
            selectedItemsForBatch.clear();
            
            // Populate move dropdown
            const moveSelect = document.getElementById('batch-move-select');
            if (moveSelect) {
              const lang = config.settings.language || 'zh';
              const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
              moveSelect.innerHTML = `<option value="">${t.batchMovePlaceholder}</option>`;
              config.tabs.forEach(tab => {
                const opt = document.createElement('option');
                opt.value = tab.id;
                opt.textContent = tab.name;
                moveSelect.appendChild(opt);
              });
            }
          }
          toggleBatchItemSelection(item.id);
        } else if (config.settings.clickMode === 'single') {
          launchHandler();
        }
      });

      if (config.settings.clickMode === 'double') {
        card.addEventListener('dblclick', (e) => {
          if (!e.ctrlKey) {
            launchHandler();
          }
        });
      }
    }

    // --- Reordering Drag and Drop listeners (Req 45 & 46) ---
    if (!isBatchMode && !isSearch) {
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        draggedItemId = item.id;
        e.dataTransfer.setData('text/plain', item.id);
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.grid-item').forEach(el => {
          el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-swap');
        });
      });
    }
  }
}

function toggleBatchItemSelection(itemId) {
  const card = itemsGrid.querySelector(`.grid-item[data-id="${itemId}"]`);
  const checkbox = card ? card.querySelector('.batch-checkbox') : null;
  
  if (selectedItemsForBatch.has(itemId)) {
    selectedItemsForBatch.delete(itemId);
    if (card) card.classList.remove('batch-selected');
    if (checkbox) checkbox.checked = false;
  } else {
    selectedItemsForBatch.add(itemId);
    if (card) card.classList.add('batch-selected');
    if (checkbox) checkbox.checked = true;
  }
  updateBatchActionBar();
}

function updateBatchActionBar() {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const bar = document.getElementById('batch-action-bar');
  const countSpan = document.getElementById('batch-selected-count');
  
  if (bar && countSpan) {
    countSpan.textContent = t.batchSelectedCount.replace('{count}', selectedItemsForBatch.size);
    bar.style.display = isBatchMode ? 'flex' : 'none';
  }
}

const CONTEXT_ICONS = {
  play: '<path d="M6 4.8v14.4L18 12 6 4.8z"/>',
  shield: '<path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z"/><path d="M9.5 12l1.7 1.7 3.6-3.8"/>',
  folder: '<path d="M3 6.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tag: '<path d="M3 12l9 9 9-9-9-9H5a2 2 0 0 0-2 2v7z"/><path d="M8 8h.01"/>',
  import: '<path d="M3 6.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5z"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/>',
  sort: '<path d="M4 7h10M4 12h7M4 17h4M17 5v14M14.5 16.5L17 19l2.5-2.5"/>',
  clean: '<path d="M4 16l8-12 8 5-8 12H7l-3-5z"/><path d="M9.5 14h7"/>'
};

function createContextIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'context-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = CONTEXT_ICONS[name] || CONTEXT_ICONS.list;
  return svg;
}

function buildContextMenu(items) {
  contextMenu.replaceChildren();
  for (const item of items) {
    if (item.separator) {
      const divider = document.createElement('div');
      divider.className = 'divider';
      divider.setAttribute('role', 'separator');
      contextMenu.appendChild(divider);
      continue;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `context-item${item.danger ? ' text-danger' : ''}`;
    button.dataset.action = item.action;
    button.setAttribute('role', 'menuitem');
    button.disabled = Boolean(item.disabled);
    button.appendChild(createContextIcon(item.icon));

    const label = document.createElement('span');
    label.textContent = item.label;
    button.appendChild(label);
    contextMenu.appendChild(button);
  }
}

function closeContextMenu({ restoreFocus = false } = {}) {
  contextMenu.style.display = 'none';
  contextMenu.setAttribute('aria-hidden', 'true');
  if (restoreFocus && contextMenuTrigger && contextMenuTrigger.isConnected) {
    contextMenuTrigger.focus({ preventScroll: true });
  }
  contextMenuTrigger = null;
}

function positionAndShowContextMenu(x, y, trigger) {
  contextMenuTrigger = trigger || document.activeElement;
  contextMenu.style.display = 'block';
  contextMenu.setAttribute('aria-hidden', 'false');
  const menuWidth = contextMenu.offsetWidth || 224;
  const menuHeight = contextMenu.offsetHeight || 200;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  let adjustedX = x;
  let adjustedY = y;
  
  if (x + menuWidth > windowWidth) {
    adjustedX = windowWidth - menuWidth - 8;
  }
  if (y + menuHeight > windowHeight) {
    adjustedY = windowHeight - menuHeight - 8;
  }
  if (adjustedX < 8) adjustedX = 8;
  if (adjustedY < 8) adjustedY = 8;
  
  contextMenu.style.left = `${adjustedX}px`;
  contextMenu.style.top = `${adjustedY}px`;
  const firstItem = contextMenu.querySelector('.context-item:not(:disabled)');
  if (firstItem) firstItem.focus({ preventScroll: true });
}

function showCardContextMenu(itemId, x, y, trigger) {
  selectedItemId = itemId;
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const item = config.items.find(i => i.id === itemId);
  if (!item) return;
  const isExe = /\.(exe|bat|cmd)$/i.test(item.path || '');
  const isUrl = isProtocolPath(item.path);
  const menuItems = [
    { action: 'open', icon: 'play', label: t.ctxOpen },
    ...(isExe ? [{ action: 'admin', icon: 'shield', label: t.ctxAdmin }] : []),
    ...(!isUrl ? [{ action: 'location', icon: 'folder', label: t.ctxLocation }] : []),
    { separator: true },
    { action: 'batch-mode-item-menu', icon: 'list', label: t.ctxBatch },
    { action: 'edit', icon: 'edit', label: t.ctxEdit },
    { action: 'delete', icon: 'trash', label: t.ctxDelete, danger: true }
  ];
  buildContextMenu(menuItems);
  positionAndShowContextMenu(x, y, trigger);
}

function showTabContextMenu(tabId, x, y, trigger) {
  selectedItemId = tabId;
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  buildContextMenu([
    { action: 'rename-tab', icon: 'edit', label: t.ctxTabRename },
    { action: 'delete-tab', icon: 'trash', label: t.ctxTabDelete, danger: true }
  ]);
  positionAndShowContextMenu(x, y, trigger);
}

function showBackgroundContextMenu(x, y, trigger) {
  selectedItemId = null;
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const noTabs = config.tabs.length === 0;
  buildContextMenu([
    { action: 'add-item', icon: 'plus', label: t.ctxBgAdd, disabled: noTabs },
    { action: 'add-tab-bg', icon: 'tag', label: t.ctxBgAddTab },
    { action: 'import-folder-bg', icon: 'import', label: t.ctxBgImportFolder, disabled: noTabs },
    { action: 'batch-mode-bg', icon: 'list', label: t.ctxBgBatch, disabled: noTabs },
    { separator: true },
    { action: 'sort-tab-bg', icon: 'sort', label: t.ctxBgSort, disabled: noTabs },
    { action: 'clean-tab-dup-bg', icon: 'clean', label: t.ctxBgClean, disabled: noTabs }
  ]);
  positionAndShowContextMenu(x, y, trigger);
}

async function addNewTab() {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  
  const name = await showCustomPrompt(t.promptNewTab);
  if (!name || name.trim() === '') return;
  
  const id = 'tab-' + Date.now();
  config.tabs.push({ id: id, name: name.trim() });
  activeTabId = id;
  
  if (!await persistCurrentConfig()) return;
  renderTabs();
  renderItems();
}

async function renameTab(tabId) {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  const tab = config.tabs.find(t => t.id === tabId);
  if (!tab) return;
  
  const name = await showCustomPrompt(t.promptRenameTab, tab.name);
  if (!name || name.trim() === '' || name.trim() === tab.name) return;
  
  tab.name = name.trim();
  if (!await persistCurrentConfig()) return;
  renderTabs();
}

async function deleteTab(tabId) {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
  
  const idx = config.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  
  const tab = config.tabs[idx];
  if (!await showCustomConfirm(t.confirmDeleteTab.replace('{name}', tab.name))) return;
  
  config.tabs.splice(idx, 1);
  config.items = config.items.filter(item => item.tabId !== tabId);
  
  if (activeTabId === tabId) {
    activeTabId = config.tabs.length > 0 ? config.tabs[0].id : null;
  }
  
  if (!await persistCurrentConfig()) return;
  renderTabs();
  renderItems();
}

async function batchImportFolder() {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;

  if (!activeTabId) {
    await showCustomAlert(t.alertNoTab);
    return;
  }
  
  const folderPath = await window.api.selectFolder();
  if (!folderPath) return;
  
  const res = await window.api.getFolderFiles(folderPath);
  if (!res || !res.success) {
    await showCustomAlert(t.alertFolderReadFail + (res ? res.error : ''));
    return;
  }
  
  const files = res.files;
  if (files.length === 0) {
    await showCustomAlert(t.alertFolderEmpty);
    return;
  }
  
  let count = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let finalPath = file.path;
    let finalArgs = '';
    let name = file.name;
    
    if (name.includes('.')) {
      name = name.substring(0, name.lastIndexOf('.'));
    }
    
    let shortcutDetails = null;
    if (file.path.toLowerCase().endsWith('.lnk') || file.path.toLowerCase().endsWith('.url')) {
      shortcutDetails = await window.api.resolveShortcut(file.path);
      finalPath = shortcutDetails.target;
      finalArgs = shortcutDetails.args;
    }

    const itemId = 'item-batch-' + Date.now() + '-' + i + '-' + Math.floor(Math.random()*1000);
    const iconRequest = await window.api.resolveIconRequest({
      name,
      path: finalPath,
      shortcutPath: shortcutDetails ? shortcutDetails.shortcutPath : '',
      iconPath: shortcutDetails ? shortcutDetails.iconPath : '',
      iconIndex: shortcutDetails ? shortcutDetails.iconIndex : 0
    });
    const iconResult = await window.api.getFileIcon(iconRequest);
    runtimeIconCache.set(itemId, iconResult.url);

    config.items.push({
      id: itemId,
      tabId: activeTabId,
      name: name,
      path: finalPath,
      args: finalArgs,
      runAsAdmin: false,
      icon: '',
      shortcutPath: iconRequest.shortcutPath || '',
      iconPath: iconRequest.iconPath || '',
      iconIndex: iconRequest.iconIndex || 0,
      iconVersion: iconResult.fallback ? 0 : ICON_EXTRACTOR_VERSION
    });
    count++;
  }
  
  if (!await persistCurrentConfig()) return;
  renderItems();
  await showCustomAlert(t.alertImportSuccess.replace('{count}', count));
}

function openEditModal(itemId = null) {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;

  if (itemId) {
    selectedItemId = itemId;
    const item = config.items.find(i => i.id === itemId);
    if (!item) return;
    
    modalTitle.textContent = t.editTitleEdit;
    itemNameInput.value = item.name;
    itemPathInput.value = item.path || '';
    itemArgsInput.value = item.args || '';
    itemAdminCheck.checked = item.runAsAdmin || false;
  } else {
    selectedItemId = null;
    modalTitle.textContent = t.editTitleAdd;
    itemNameInput.value = '';
    itemPathInput.value = '';
    itemArgsInput.value = '';
    itemAdminCheck.checked = false;
  }
  editModal.style.display = 'flex';
  itemNameInput.focus();
}

async function saveItemDetails() {
  const lang = config.settings.language || 'zh';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;

  const name = itemNameInput.value.trim();
  const filePath = itemPathInput.value.trim();
  const args = itemArgsInput.value.trim();
  const admin = itemAdminCheck.checked;
  
  if (!name || !filePath) {
    await showCustomAlert(t.alertFieldsEmpty);
    return;
  }
  
  let targetPath = filePath;
  let targetArgs = args;
  
  let shortcutDetails = null;
  if (filePath.toLowerCase().endsWith('.lnk') || filePath.toLowerCase().endsWith('.url')) {
    shortcutDetails = await window.api.resolveShortcut(filePath);
    targetPath = shortcutDetails.target;
    if (shortcutDetails.args) targetArgs = shortcutDetails.args;
  }

  const iconRequest = await window.api.resolveIconRequest({
    name,
    path: targetPath,
    shortcutPath: shortcutDetails ? shortcutDetails.shortcutPath : '',
    iconPath: shortcutDetails ? shortcutDetails.iconPath : '',
    iconIndex: shortcutDetails ? shortcutDetails.iconIndex : 0
  });
  const iconResult = await window.api.getFileIcon(iconRequest, true);

  if (selectedItemId) {
    const item = config.items.find(i => i.id === selectedItemId);
    if (item) {
      item.name = name;
      item.path = targetPath;
      item.args = targetArgs;
      item.runAsAdmin = admin;
      applyIconMetadata(item, iconRequest, iconResult);
      runtimeIconCache.set(item.id, iconResult.url);
    }
  } else {
    const itemId = 'item-' + Date.now();
    const newItem = {
      id: itemId,
      tabId: activeTabId,
      name: name,
      path: targetPath,
      args: targetArgs,
      runAsAdmin: admin,
      icon: ''
    };
    applyIconMetadata(newItem, iconRequest, iconResult);
    runtimeIconCache.set(itemId, iconResult.url);
    config.items.push(newItem);
  }
  
  if (!await persistCurrentConfig()) {
    renderItems();
    return;
  }
  editModal.style.display = 'none';
  renderItems();
}

function getClosestGridItem(gridElement, clientX, clientY, excludeId = null) {
  let cards = Array.from(gridElement.querySelectorAll('.grid-item:not(.dragging)'));
  if (excludeId) {
    cards = cards.filter(card => card.dataset.id !== excludeId);
  }
  if (cards.length === 0) return null;
  
  let closestCard = null;
  let minDistance = Infinity;
  
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const cardCenterX = rect.left + rect.width / 2;
    const cardCenterY = rect.top + rect.height / 2;
    
    const dx = clientX - cardCenterX;
    const dy = clientY - cardCenterY;
    const distance = dx * dx + dy * dy;
    
    if (distance < minDistance) {
      minDistance = distance;
      closestCard = card;
    }
  });
  
  return closestCard;
}

function setupEventListeners() {
  closeBtn.addEventListener('click', () => {
    window.api.hideWindow();
  });

  settingsBtn.addEventListener('click', () => {
    window.api.openSettingsWindow();
  });

  addTabBtn.addEventListener('click', addNewTab);

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    clearSearchBtn.style.display = val.length > 0 ? 'block' : 'none';
    renderItems(val);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    renderItems();
    searchInput.focus();
  });

  modalSaveBtn.addEventListener('click', saveItemDetails);
  modalCancelBtn.addEventListener('click', () => editModal.style.display = 'none');
  modalCloseX.addEventListener('click', () => editModal.style.display = 'none');

  // Container-level drag & drop handlers for responsive card reordering (Req 46)
  itemsGrid.addEventListener('dragover', (e) => {
    if (isBatchMode || searchInput.value.trim().length > 0) return;
    
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    let closestCard = e.target.closest('.grid-item');
    if (closestCard && closestCard.classList.contains('dragging')) {
      closestCard = null;
    }
    if (!closestCard) {
      closestCard = getClosestGridItem(itemsGrid, e.clientX, e.clientY, draggedItemId);
    }
    
    // Clear other drag highlights
    itemsGrid.querySelectorAll('.grid-item').forEach(el => {
      if (el !== closestCard) {
        el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-swap');
      }
    });
    
    if (closestCard) {
      const dragMode = config.settings.dragMode || 'sort';
      if (dragMode === 'swap') {
        closestCard.classList.add('drag-over-swap');
      } else {
        const rect = closestCard.getBoundingClientRect();
        const isAfter = e.clientX > rect.left + rect.width / 2;
        
        if (isAfter) {
          closestCard.classList.add('drag-over-after');
          closestCard.classList.remove('drag-over-before');
        } else {
          closestCard.classList.add('drag-over-before');
          closestCard.classList.remove('drag-over-after');
        }
      }
    }
  });

  itemsGrid.addEventListener('dragleave', (e) => {
    // Check if dragging completely outside the grid bounds
    const rect = itemsGrid.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      itemsGrid.querySelectorAll('.grid-item').forEach(el => {
        el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-swap');
      });
    }
  });

  itemsGrid.addEventListener('drop', async (e) => {
    if (isBatchMode || searchInput.value.trim().length > 0) return;
    e.preventDefault();
    
    itemsGrid.querySelectorAll('.grid-item').forEach(el => {
      el.classList.remove('drag-over-before', 'drag-over-after', 'drag-over-swap');
    });
    
    const draggedId = e.dataTransfer.getData('text/plain') || draggedItemId;
    let closestCard = e.target.closest('.grid-item');
    if (closestCard && closestCard.dataset.id === draggedId) {
      closestCard = null;
    }
    if (!closestCard) {
      closestCard = getClosestGridItem(itemsGrid, e.clientX, e.clientY, draggedId);
    }
    if (!closestCard || !draggedId || draggedId === closestCard.dataset.id) return;
    
    const draggedIdx = config.items.findIndex(i => i.id === draggedId);
    const targetIdx = config.items.findIndex(i => i.id === closestCard.dataset.id);
    
    if (draggedIdx === -1 || targetIdx === -1) return;
    
    const dragMode = config.settings.dragMode || 'sort';
    
    if (dragMode === 'swap') {
      // Swap items (exchange positions) (Req 46)
      const draggedItem = config.items[draggedIdx];
      const targetItem = config.items[targetIdx];
      config.items.splice(draggedIdx, 1, targetItem);
      config.items.splice(targetIdx, 1, draggedItem);
    } else {
      // Sort/Insert item at target index (Req 46)
      const rect = closestCard.getBoundingClientRect();
      const isAfter = e.clientX > rect.left + rect.width / 2;
      
      const [draggedItem] = config.items.splice(draggedIdx, 1);
      
      let newTargetIdx = config.items.findIndex(i => i.id === closestCard.dataset.id);
      if (isAfter) {
        newTargetIdx += 1;
      }
      
      config.items.splice(newTargetIdx, 0, draggedItem);
    }
    
    if (await persistCurrentConfig()) renderItems();
  });

  document.getElementById('browse-file-btn').addEventListener('click', async () => {
    const p = await window.api.selectFile();
    if (p) {
      itemPathInput.value = p;
      if (!itemNameInput.value.trim()) {
        const parts = p.split('\\');
        const filename = parts[parts.length - 1];
        itemNameInput.value = filename.substring(0, filename.lastIndexOf('.')) || filename;
      }
    }
  });

  document.getElementById('browse-folder-btn').addEventListener('click', async () => {
    const p = await window.api.selectFolder();
    if (p) {
      itemPathInput.value = p;
      if (!itemNameInput.value.trim()) {
        const parts = p.split('\\');
        itemNameInput.value = parts[parts.length - 1];
      }
    }
  });

  document.addEventListener('contextmenu', (e) => {
    if (editModal.style.display === 'flex' || (typeof batchEditModal !== 'undefined' && batchEditModal && batchEditModal.style.display === 'flex')) return;
    
    const card = e.target.closest('.grid-item');
    const tab = e.target.closest('.tab-item');
    const isGrid = e.target.closest('.grid-container');
    const isTabs = e.target.closest('.tabs-container');
    const trigger = card || tab || isGrid || isTabs;
    const triggerRect = trigger ? trigger.getBoundingClientRect() : null;
    const menuX = e.clientX || (triggerRect ? triggerRect.left + 12 : 12);
    const menuY = e.clientY || (triggerRect ? triggerRect.top + 12 : 12);
    
    if (card) {
      e.preventDefault();
      showCardContextMenu(card.dataset.id, menuX, menuY, card);
    } else if (tab) {
      e.preventDefault();
      showTabContextMenu(tab.dataset.id, menuX, menuY, tab);
    } else if (isGrid || isTabs) {
      e.preventDefault();
      showBackgroundContextMenu(menuX, menuY, trigger);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (contextMenu.style.display !== 'none' && !contextMenu.contains(event.target)) {
      closeContextMenu({ restoreFocus: true });
    }
  });

  contextMenu.addEventListener('keydown', (event) => {
    const enabledItems = Array.from(contextMenu.querySelectorAll('.context-item:not(:disabled)'));
    if (enabledItems.length === 0) return;
    const currentIndex = enabledItems.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + enabledItems.length) % enabledItems.length;
    else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = enabledItems.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeContextMenu({ restoreFocus: true });
      return;
    } else return;
    event.preventDefault();
    enabledItems[nextIndex].focus({ preventScroll: true });
  });

  contextMenu.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('.context-item');
    if (!actionEl || actionEl.disabled) return;
    
    const action = actionEl.dataset.action;
    closeContextMenu({ restoreFocus: true });

    if (action === 'rename-tab') {
      renameTab(selectedItemId);
    } else if (action === 'delete-tab') {
      deleteTab(selectedItemId);
    } else if (action === 'add-item') {
      openEditModal();
    } else if (action === 'add-tab-bg') {
      addNewTab();
    } else if (action === 'import-folder-bg') {
      await batchImportFolder();
    } else if (action === 'sort-tab-bg') {
      const tabItems = config.items.filter(item => item.tabId === activeTabId);
      tabItems.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      config.items = config.items.filter(item => item.tabId !== activeTabId).concat(tabItems);
      if (await persistCurrentConfig()) renderItems();
    } else if (action === 'clean-tab-dup-bg') {
      const tabItems = config.items.filter(item => item.tabId === activeTabId);
      const seen = new Set();
      const unique = [];
      tabItems.forEach(i => {
        if (!seen.has(i.path)) {
          seen.add(i.path);
          unique.push(i);
        }
      });
      config.items = config.items.filter(item => item.tabId !== activeTabId).concat(unique);
      if (await persistCurrentConfig()) renderItems();
    } else if (action === 'batch-mode-bg') {
      isBatchMode = true;
      selectedItemsForBatch.clear();
      renderItems();
      
      const moveSelect = document.getElementById('batch-move-select');
      if (moveSelect) {
        const lang = config.settings.language || 'zh';
        const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
        moveSelect.innerHTML = `<option value="">${t.batchMovePlaceholder}</option>`;
        config.tabs.forEach(tab => {
          const opt = document.createElement('option');
          opt.value = tab.id;
          opt.textContent = tab.name;
          moveSelect.appendChild(opt);
        });
        initCustomSelects(); // Beautify select dropdown
      }
      updateBatchActionBar();
    } else {
      switch(action) {
        case 'open':
          const openItem = config.items.find(i => i.id === selectedItemId);
          if (openItem) await launchConfiguredItem(openItem.id);
          break;
        case 'admin':
          const adminItem = config.items.find(i => i.id === selectedItemId);
          if (adminItem) await launchConfiguredItem(adminItem.id, true);
          break;
        case 'location':
          const locItem = config.items.find(i => i.id === selectedItemId);
          if (locItem) {
            const result = await window.api.showItemInFolder(locItem.id);
            if (!result || !result.success) await handleLaunchFailure(locItem.id, result || { code: 'GENERIC' });
          }
          break;
        case 'batch-mode-item-menu':
          isBatchMode = true;
          selectedItemsForBatch.clear();
          
          // Populate move dropdown
          const moveSelect = document.getElementById('batch-move-select');
          if (moveSelect) {
            moveSelect.innerHTML = '<option value="">移动到分组...</option>';
            config.tabs.forEach(tab => {
              const opt = document.createElement('option');
              opt.value = tab.id;
              opt.textContent = tab.name;
              moveSelect.appendChild(opt);
            });
            initCustomSelects(); // Beautify select dropdown
          }
          renderItems();
          toggleBatchItemSelection(selectedItemId); // Select the clicked item automatically
          updateBatchActionBar();
          break;
        case 'edit':
          openEditModal(selectedItemId);
          break;
        case 'delete':
          const lang = config.settings.language || 'zh';
          const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
          const itemToDelete = config.items.find(i => i.id === selectedItemId);
          if (itemToDelete) {
            if (await showCustomConfirm(t.confirmDeleteItem.replace('{name}', itemToDelete.name))) {
              config.items = config.items.filter(i => i.id !== selectedItemId);
              if (await persistCurrentConfig()) renderItems();
            }
          }
          break;
      }
    }
  });

  window.api.onFilesDropped(async (droppedFiles) => {
    if (editModal.style.display === 'flex') return;
    if (config.tabs.length === 0) return;

    for (let i = 0; i < droppedFiles.length; i++) {
      const file = droppedFiles[i];
      let targetPath = file.path;
      let targetArgs = '';
      let originalName = file.name;
      
      if (!targetPath) continue;
      
      let dispName = originalName;
      if (originalName.includes('.')) {
        dispName = originalName.substring(0, originalName.lastIndexOf('.'));
      }
      
      let shortcutDetails = null;
      if (targetPath.toLowerCase().endsWith('.lnk') || targetPath.toLowerCase().endsWith('.url')) {
        shortcutDetails = await window.api.resolveShortcut(targetPath);
        targetPath = shortcutDetails.target;
        targetArgs = shortcutDetails.args;
      }

      const itemId = 'item-drop-' + Date.now() + '-' + i + '-' + Math.floor(Math.random() * 1000);
      const iconRequest = await window.api.resolveIconRequest({
        name: dispName,
        path: targetPath,
        shortcutPath: shortcutDetails ? shortcutDetails.shortcutPath : '',
        iconPath: shortcutDetails ? shortcutDetails.iconPath : '',
        iconIndex: shortcutDetails ? shortcutDetails.iconIndex : 0
      });
      const iconResult = await window.api.getFileIcon(iconRequest);
      runtimeIconCache.set(itemId, iconResult.url);

      config.items.push({
        id: itemId,
        tabId: activeTabId,
        name: dispName,
        path: targetPath,
        args: targetArgs,
        runAsAdmin: false,
        icon: '',
        shortcutPath: iconRequest.shortcutPath || '',
        iconPath: iconRequest.iconPath || '',
        iconIndex: iconRequest.iconIndex || 0,
        iconVersion: iconResult.fallback ? 0 : ICON_EXTRACTOR_VERSION
      });
    }

    if (!await persistCurrentConfig()) {
      renderItems();
      return;
    }
    renderItems();
  });

  document.addEventListener('wheel', (e) => {
    if (!config || !config.settings || !config.settings.tabScroll || config.tabs.length <= 1) return;
    
    // Do not switch tabs if any modal/dialog is visible
    if (editModal.style.display === 'flex' || 
        (typeof batchEditModal !== 'undefined' && batchEditModal && batchEditModal.style.display === 'flex') ||
        document.getElementById('dialog-modal').style.display === 'flex' ||
        document.getElementById('prompt-modal').style.display === 'flex') {
      return;
    }

    // Do not switch if scrolling inside a scrollable dropdown or input or batch-action-bar
    if (e.target.closest('.dropdown-style') || e.target.closest('input') || e.target.closest('select') || e.target.closest('#batch-action-bar')) {
      return;
    }

    e.preventDefault();

    const idx = config.tabs.findIndex(t => t.id === activeTabId);
    let nextIdx = idx;

    if (e.deltaY > 0) {
      nextIdx = (idx + 1) % config.tabs.length;
    } else {
      nextIdx = (idx - 1 + config.tabs.length) % config.tabs.length;
    }

    activeTabId = config.tabs[nextIdx].id;
    renderTabs();
    renderItems();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (editModal.style.display === 'flex') {
        editModal.style.display = 'none';
      } else if (typeof batchEditModal !== 'undefined' && batchEditModal && batchEditModal.style.display === 'flex') {
        batchEditModal.style.display = 'none';
      } else if (isBatchMode) {
        isBatchMode = false;
        selectedItemsForBatch.clear();
        renderItems();
        updateBatchActionBar();
      } else if (config.settings.pressEscToHide) {
        window.api.hideWindow();
      }
      return;
    }

    const isInput = (
      document.activeElement.tagName === 'INPUT' || 
      document.activeElement.tagName === 'TEXTAREA' || 
      document.activeElement.tagName === 'SELECT'
    );
    
    if (config.settings.tabKeys && !isInput && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (idx < config.tabs.length) {
        activeTabId = config.tabs[idx].id;
        renderTabs();
        renderItems();
      }
    }
  });

  window.api.onWindowShow(() => {
    editModal.style.display = 'none';
  });

  window.api.onConfigUpdated((newConfig) => {
    acceptCanonicalConfig(newConfig);
    if (!config.tabs.some((tab) => tab.id === activeTabId)) {
      activeTabId = config.tabs.length > 0 ? config.tabs[0].id : null;
    }
    runtimeIconCache.clear();
    translateUI();
    applyAppearanceSettings();
    renderTabs();
    renderItems();
  });

  window.api.onAppearancePreview((settings) => {
    applyAppearanceSettings(settings);
  });

  const batchCancelBtn = document.getElementById('batch-cancel-btn');
  if (batchCancelBtn) {
    batchCancelBtn.addEventListener('click', () => {
      isBatchMode = false;
      selectedItemsForBatch.clear();
      renderItems();
      updateBatchActionBar();
    });
  }

  const batchDeleteBtn = document.getElementById('batch-delete-btn');
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', async () => {
      const lang = config.settings.language || 'zh';
      const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
      
      if (selectedItemsForBatch.size === 0) {
        await showCustomAlert(t.alertBatchSelectDelete);
        return;
      }
      if (await showCustomConfirm(t.confirmBatchDelete.replace('{count}', selectedItemsForBatch.size))) {
        config.items = config.items.filter(item => !selectedItemsForBatch.has(item.id));
        if (!await persistCurrentConfig()) {
          renderItems();
          return;
        }
        isBatchMode = false;
        selectedItemsForBatch.clear();
        renderItems();
        updateBatchActionBar();
        await showCustomAlert(t.alertBatchDeleteSuccess);
      }
    });
  }

  const batchMoveSelect = document.getElementById('batch-move-select');
  if (batchMoveSelect) {
    batchMoveSelect.addEventListener('change', async (e) => {
      const lang = config.settings.language || 'zh';
      const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
      
      const targetTabId = e.target.value;
      if (!targetTabId) return;
      if (selectedItemsForBatch.size === 0) {
        await showCustomAlert(t.alertBatchSelectMove);
        batchMoveSelect.value = '';
        return;
      }
      
      config.items.forEach(item => {
        if (selectedItemsForBatch.has(item.id)) {
          item.tabId = targetTabId;
        }
      });
      
      if (!await persistCurrentConfig()) {
        renderItems();
        return;
      }
      isBatchMode = false;
      selectedItemsForBatch.clear();
      renderItems();
      updateBatchActionBar();
      await showCustomAlert(t.alertBatchMoveSuccess);
    });
  }

  // --- Req 31: Batch select and edit feature implementation ---
  
  // Select All button trigger
  const batchSelectAllBtn = document.getElementById('batch-select-all-btn');
  if (batchSelectAllBtn) {
    batchSelectAllBtn.addEventListener('click', () => {
      const currentTabItems = config.items.filter(item => item.tabId === activeTabId);
      currentTabItems.forEach(item => {
        selectedItemsForBatch.add(item.id);
        const card = itemsGrid.querySelector(`.grid-item[data-id="${item.id}"]`);
        if (card) {
          card.classList.add('batch-selected');
          const checkbox = card.querySelector('.batch-checkbox');
          if (checkbox) checkbox.checked = true;
        }
      });
      updateBatchActionBar();
    });
  }

  // Batch Edit Dialog DOM links
  const batchEditBtn = document.getElementById('batch-edit-btn');
  const batchEditModal = document.getElementById('batch-edit-modal');
  const batchEditCancelBtn = document.getElementById('batch-edit-cancel-btn');
  const batchEditSaveBtn = document.getElementById('batch-edit-save-btn');
  const batchEditCloseX = document.getElementById('batch-edit-close-x');
  
  const batchEnableAdmin = document.getElementById('batch-enable-admin');
  const batchItemAdmin = document.getElementById('batch-item-admin');
  const batchEnableArgs = document.getElementById('batch-enable-args');
  const batchItemArgs = document.getElementById('batch-item-args');

  if (batchEnableAdmin && batchItemAdmin) {
    batchEnableAdmin.addEventListener('change', (e) => {
      batchItemAdmin.disabled = !e.target.checked;
    });
  }
  if (batchEnableArgs && batchItemArgs) {
    batchEnableArgs.addEventListener('change', (e) => {
      batchItemArgs.disabled = !e.target.checked;
    });
  }

  if (batchEditBtn && batchEditModal) {
    batchEditBtn.addEventListener('click', () => {
      if (selectedItemsForBatch.size === 0) {
        showCustomAlert('请先选中需要修改的项目！');
        return;
      }
      
      // Reset enabling toggles and states
      batchEnableAdmin.checked = false;
      batchEnableArgs.checked = false;
      batchItemAdmin.checked = false;
      batchItemAdmin.disabled = true;
      batchItemArgs.value = '';
      batchItemArgs.disabled = true;
      
      // Pre-fill with the first item's current state to be user friendly
      const firstId = Array.from(selectedItemsForBatch)[0];
      const firstItem = config.items.find(i => i.id === firstId);
      if (firstItem) {
        batchItemAdmin.checked = !!firstItem.runAsAdmin;
        batchItemArgs.value = firstItem.args || '';
      }
      
      batchEditModal.style.display = 'flex';
    });

    const closeBatchEdit = () => {
      batchEditModal.style.display = 'none';
    };

    batchEditCancelBtn.addEventListener('click', closeBatchEdit);
    batchEditCloseX.addEventListener('click', closeBatchEdit);

    batchEditSaveBtn.addEventListener('click', async () => {
      const changeAdmin = batchEnableAdmin.checked;
      const changeArgs = batchEnableArgs.checked;
      
      if (!changeAdmin && !changeArgs) {
        await showCustomAlert('请勾选至少一个想要修改的属性！');
        return;
      }

      const runAsAdmin = batchItemAdmin.checked;
      const runArgs = batchItemArgs.value.trim();

      // Batch modify attributes
      config.items.forEach(item => {
        if (selectedItemsForBatch.has(item.id)) {
          if (changeAdmin) {
            item.runAsAdmin = runAsAdmin;
          }
          if (changeArgs) {
            item.args = runArgs;
          }
        }
      });

      if (!await persistCurrentConfig()) {
        renderItems();
        return;
      }
      closeBatchEdit();

      // Exit batch mode
      isBatchMode = false;
      selectedItemsForBatch.clear();
      renderItems();
      updateBatchActionBar();

      await showCustomAlert('批量修改项目属性成功！');
    });
  }

  // Listen for configuration import success (Req 37)
  window.api.onImportSuccess(() => {
    const lang = config.settings.language || 'zh';
    const t = TRANSLATIONS[lang] || TRANSLATIONS.zh;
    showCustomAlert(t.msg_import_success);
  });
}

document.addEventListener('DOMContentLoaded', init);
