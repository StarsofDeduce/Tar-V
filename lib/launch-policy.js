'use strict';

/**
 * 只允许启动已保存在当前配置中的唯一项。
 * 渲染器只提供 ID 和一次性的「以管理员身份运行」选择，路径与参数
 * 始终由主进程从配置中重新取得。
 */
function selectConfiguredLaunch(config, itemId, forceRunAsAdmin = false) {
  if (typeof itemId !== 'string' || itemId.length === 0 || itemId.length > 128) {
    return { ok: false, code: 'INVALID_ITEM_ID', error: '启动项 ID 无效' };
  }
  if (typeof forceRunAsAdmin !== 'boolean') {
    return { ok: false, code: 'INVALID_ADMIN_FLAG', error: '管理员启动标记无效' };
  }

  const items = config && Array.isArray(config.items) ? config.items : [];
  const matches = items.filter((item) => item && item.id === itemId);
  if (matches.length !== 1) {
    return { ok: false, code: 'ITEM_NOT_FOUND', error: '启动项不存在或 ID 不唯一' };
  }

  const item = matches[0];
  if (typeof item.path !== 'string' || item.path.length === 0) {
    return { ok: false, code: 'EMPTY_PATH', error: '启动路径为空' };
  }

  return {
    ok: true,
    item: {
      id: item.id,
      filePath: item.path,
      args: typeof item.args === 'string' ? item.args : '',
      runAsAdmin: item.runAsAdmin === true || forceRunAsAdmin,
      shortcutPath: typeof item.shortcutPath === 'string' ? item.shortcutPath : ''
    }
  };
}

module.exports = { selectConfiguredLaunch };
