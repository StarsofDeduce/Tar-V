'use strict';

const fs = require('fs');
const path = require('path');
const { parseWindowsArgs } = require('./args');

function existingFile(filePath, fsImpl) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * Resolve icons for Squirrel.Windows launchers such as
 * `Update.exe --processStart Product.exe` without relying on a product name.
 */
function findSquirrelIconSource(targetPath, rawArguments, { fsImpl = fs } = {}) {
  if (
    typeof targetPath !== 'string' || !path.isAbsolute(targetPath) ||
    path.basename(targetPath).toLowerCase() !== 'update.exe' ||
    !existingFile(targetPath, fsImpl)
  ) return null;
  const root = path.dirname(targetPath);
  const rootIcon = path.join(root, 'app.ico');
  if (existingFile(rootIcon, fsImpl)) {
    return { iconPath: rootIcon, iconIndex: 0, source: 'squirrel-root-icon' };
  }

  const args = parseWindowsArgs(rawArguments || '');
  let processName = '';
  for (let index = 0; index < args.length; index++) {
    const value = String(args[index]);
    if (value.toLowerCase() === '--processstart' && args[index + 1]) {
      processName = path.basename(String(args[index + 1]));
      break;
    }
    if (value.toLowerCase().startsWith('--processstart=')) {
      processName = path.basename(value.slice(value.indexOf('=') + 1));
      break;
    }
  }
  if (!processName || path.extname(processName).toLowerCase() !== '.exe') return null;

  let appDirectories;
  try {
    appDirectories = fsImpl.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^app-/i.test(entry.name))
      .map((entry) => path.join(root, entry.name))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .slice(0, 128);
  } catch (_) {
    return null;
  }

  for (const directory of appDirectories) {
    const versionIcon = path.join(directory, 'app.ico');
    if (existingFile(versionIcon, fsImpl)) {
      return { iconPath: versionIcon, iconIndex: 0, source: 'squirrel-version-icon' };
    }
    const executable = path.join(directory, processName);
    if (existingFile(executable, fsImpl)) {
      return { iconPath: executable, iconIndex: 0, source: 'squirrel-process-resource' };
    }
  }
  return null;
}

module.exports = { findSquirrelIconSource };
