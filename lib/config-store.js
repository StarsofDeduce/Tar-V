'use strict';

const fs = require('fs');
const path = require('path');

const REMOVED_EXPERIMENTAL_SETTINGS = Object.freeze([
  'liquidGlassEnabled',
  'mainRoundedCorners',
  'frostedGlassEnabled'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function migratePersistedConfig(input) {
  if (!isPlainObject(input) || !isPlainObject(input.settings)) {
    return { value: input, changed: false, removedSettings: [] };
  }

  const settings = { ...input.settings };
  const removedSettings = [];
  for (const key of REMOVED_EXPERIMENTAL_SETTINGS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      delete settings[key];
      removedSettings.push(key);
    }
  }

  return {
    value: removedSettings.length > 0 ? { ...input, settings } : input,
    changed: removedSettings.length > 0,
    removedSettings
  };
}

function timestampForFile(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function backupConfigFile(configPath, { fsImpl = fs, now = new Date() } = {}) {
  if (!fsImpl.existsSync(configPath)) return '';
  const parsed = path.parse(configPath);
  const backupPath = path.join(
    parsed.dir,
    `${parsed.name}.bak-before-compat-${timestampForFile(now)}${parsed.ext || '.json'}`
  );
  fsImpl.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function writeJsonAtomic(filePath, value, { fsImpl = fs } = {}) {
  const parent = path.dirname(filePath);
  fsImpl.mkdirSync(parent, { recursive: true });
  const tempPath = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const payload = JSON.stringify(value, null, 2);

  try {
    fsImpl.writeFileSync(tempPath, payload, 'utf8');
    fsImpl.renameSync(tempPath, filePath);
  } catch (error) {
    try { fsImpl.unlinkSync(tempPath); } catch (_) { /* temp file may not exist */ }
    throw error;
  }
}

module.exports = {
  REMOVED_EXPERIMENTAL_SETTINGS,
  migratePersistedConfig,
  backupConfigFile,
  writeJsonAtomic,
  timestampForFile
};
