'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WeightedLruCache } = require('./icon-cache');
const { isProtocolTarget, protocolName } = require('./shortcut');

const ICON_EXTRACTOR_VERSION = 3;
const DIRECT_IMAGE_EXTENSIONS = new Set(['.ico', '.png', '.jpg', '.jpeg', '.bmp', '.webp']);
const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.dll']);
const MAX_DISK_CACHE_BYTES = 100 * 1024 * 1024;
const MAX_DISK_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

function createIconService({ app, nativeImage, extractExecutableIcon, cacheDir, fallbackIcons }) {
  const memory = new WeightedLruCache({ maxEntries: 256, maxBytes: 32 * 1024 * 1024 });
  const negative = new Map();
  const inFlight = new Map();
  let disposed = false;
  let diskWrites = 0;

  function pruneDiskCache() {
    let entries;
    try {
      entries = fs.readdirSync(cacheDir)
        .filter((name) => name.endsWith('.json'))
        .map((name) => {
          const filePath = path.join(cacheDir, name);
          const stat = fs.statSync(filePath);
          return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
    } catch (_) {
      return;
    }

    const now = Date.now();
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries) {
      if (now - entry.mtimeMs <= MAX_DISK_CACHE_AGE_MS && total <= MAX_DISK_CACHE_BYTES) break;
      try {
        fs.unlinkSync(entry.filePath);
        total -= entry.size;
      } catch (_) {
        /* another process may already have removed it */
      }
    }
  }

  function normalizeRequest(input) {
    if (typeof input === 'string') return { path: input, shortcutPath: '', iconPath: '', iconIndex: 0 };
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { path: '', shortcutPath: '', iconPath: '', iconIndex: 0 };
    }
    return {
      path: typeof input.path === 'string' ? input.path : '',
      shortcutPath: typeof input.shortcutPath === 'string' ? input.shortcutPath : '',
      iconPath: typeof input.iconPath === 'string' ? input.iconPath : '',
      iconIndex: Number.isInteger(input.iconIndex) ? input.iconIndex : 0
    };
  }

  function fileFingerprint(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    } catch (_) {
      return 'missing';
    }
  }

  function requestKey(request) {
    const fields = [request.path, request.shortcutPath, request.iconPath]
      .filter(Boolean)
      .map((value) => {
        if (isProtocolTarget(value)) return value.toLowerCase();
        return `${path.resolve(value).toLowerCase()}@${fileFingerprint(value)}`;
      });
    fields.push(String(request.iconIndex || 0), String(ICON_EXTRACTOR_VERSION));
    return fields.join('|');
  }

  function diskPathForKey(key) {
    return path.join(cacheDir, `${crypto.createHash('sha256').update(key).digest('hex')}.json`);
  }

  function isResolvedResult(value) {
    return Boolean(
      value && typeof value === 'object' && value.fallback === false &&
      typeof value.url === 'string' && value.url.startsWith('data:image/')
    );
  }

  function readDisk(key) {
    try {
      const record = JSON.parse(fs.readFileSync(diskPathForKey(key), 'utf8'));
      if (record.version !== ICON_EXTRACTOR_VERSION || !isResolvedResult(record.result)) return null;
      return record.result;
    } catch (_) {
      return null;
    }
  }

  function writeDisk(key, result) {
    if (!isResolvedResult(result)) return;
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(diskPathForKey(key), JSON.stringify({
        version: ICON_EXTRACTOR_VERSION,
        createdAt: Date.now(),
        result
      }), 'utf8');
      diskWrites++;
      if (diskWrites % 32 === 0) pruneDiskCache();
    } catch (err) {
      console.error('Failed to write icon cache:', err.message);
    }
  }

  function imageToDataUrl(image) {
    if (!image || image.isEmpty()) return '';
    return image.toDataURL();
  }

  function resolved(url, source) {
    return { url, source, fallback: false, errorCode: '' };
  }

  async function loadShellIcon(candidatePath, source) {
    try {
      const url = imageToDataUrl(await app.getFileIcon(candidatePath, { size: 'large' }));
      return url ? resolved(url, source) : null;
    } catch (_) {
      return null;
    }
  }

  async function loadCandidate(candidatePath, iconIndex = 0, sourcePrefix = 'target') {
    if (!candidatePath || isProtocolTarget(candidatePath) || !fs.existsSync(candidatePath)) return null;
    const extension = path.extname(candidatePath).toLowerCase();

    if (DIRECT_IMAGE_EXTENSIONS.has(extension)) {
      const url = imageToDataUrl(nativeImage.createFromPath(candidatePath));
      return url ? resolved(url, `${sourcePrefix}-image`) : null;
    }

    if (EXECUTABLE_EXTENSIONS.has(extension)) {
      try {
        const base64 = await extractExecutableIcon(candidatePath, iconIndex);
        if (base64) return resolved(`data:image/png;base64,${base64}`, `${sourcePrefix}-resource`);
      } catch (err) {
        console.error('Executable icon extraction failed:', err.message);
      }
    }

    return loadShellIcon(candidatePath, `${sourcePrefix}-shell`);
  }

  function fallbackFor(request, errorCode = 'ICON_NOT_FOUND') {
    const protocol = protocolName(request.path);
    let url = fallbackIcons.file;
    let source = 'fallback-file';
    if (protocol === 'http' || protocol === 'https') {
      url = fallbackIcons.web;
      source = 'fallback-web';
    } else if (protocol === 'steam') {
      url = fallbackIcons.steam || fallbackIcons.web;
      source = 'fallback-steam';
    } else {
      try {
        if (request.path && fs.statSync(request.path).isDirectory()) {
          url = fallbackIcons.folder;
          source = 'fallback-folder';
        }
      } catch (_) {
        /* missing paths use the generic file icon */
      }
    }
    return { url, source, fallback: true, errorCode };
  }

  async function extract(request) {
    const seen = new Set();
    const tryCandidate = async (candidatePath, iconIndex, source) => {
      const key = `${String(candidatePath).toLowerCase()}|${iconIndex}|${source}`;
      if (!candidatePath || seen.has(key)) return null;
      seen.add(key);
      return loadCandidate(candidatePath, iconIndex, source);
    };

    // Explicit icon metadata is authoritative. When it is absent, resolve the
    // shortcut target before asking Windows for the generic .lnk icon.
    let result = await tryCandidate(request.iconPath, request.iconIndex, 'explicit');
    if (result) return result;

    result = await tryCandidate(request.path, 0, 'target');
    if (result) return result;

    if (request.shortcutPath && fs.existsSync(request.shortcutPath)) {
      result = await loadShellIcon(request.shortcutPath, 'shortcut-shell');
      if (result) return result;
    }

    return fallbackFor(request, request.path && !isProtocolTarget(request.path) && !fs.existsSync(request.path)
      ? 'TARGET_MISSING'
      : 'ICON_NOT_FOUND');
  }

  async function getIcon(input, { forceRefresh = false } = {}) {
    if (disposed) throw new Error('Icon service is disposed');
    const request = normalizeRequest(input);
    if (!request.path && !request.iconPath && !request.shortcutPath) {
      return fallbackFor(request, 'NO_ICON_SOURCE');
    }
    const key = requestKey(request);

    if (forceRefresh) {
      memory.delete(key);
      negative.delete(key);
      try { fs.unlinkSync(diskPathForKey(key)); } catch (_) { /* cache miss */ }
    } else {
      const cached = memory.get(key);
      if (cached) return cached;
      const disk = readDisk(key);
      if (disk) {
        memory.set(key, disk);
        return disk;
      }
      const miss = negative.get(key);
      if (miss && miss.expiresAt > Date.now()) return miss.result;
      if (miss) negative.delete(key);
    }

    if (inFlight.has(key)) return inFlight.get(key);
    const promise = extract(request)
      .then((result) => {
        if (result.fallback) {
          negative.set(key, { result, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
        } else {
          memory.set(key, result);
          writeDisk(key, result);
        }
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  function clear() {
    memory.clear();
    negative.clear();
  }

  function dispose() {
    disposed = true;
    memory.clear();
    negative.clear();
    inFlight.clear();
  }

  function stats() {
    return { entries: memory.size, bytes: memory.bytes, negative: negative.size, inFlight: inFlight.size };
  }

  pruneDiskCache();
  return { getIcon, clear, dispose, stats };
}

module.exports = {
  createIconService,
  ICON_EXTRACTOR_VERSION,
  MAX_DISK_CACHE_BYTES,
  MAX_DISK_CACHE_AGE_MS,
  NEGATIVE_CACHE_TTL_MS
};
