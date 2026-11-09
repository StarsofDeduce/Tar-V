'use strict';

class WeightedLruCache {
  constructor({ maxEntries = 256, maxBytes = 32 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.map = new Map();
    this.totalBytes = 0;
  }

  get size() {
    return this.map.size;
  }

  get bytes() {
    return this.totalBytes;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    this.delete(key);
    if (bytes > this.maxBytes) return false;

    this.map.set(key, { value, bytes });
    this.totalBytes += bytes;
    this.trim();
    return true;
  }

  delete(key) {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.map.delete(key);
    this.totalBytes -= entry.bytes;
    return true;
  }

  clear() {
    this.map.clear();
    this.totalBytes = 0;
  }

  trim() {
    while (this.map.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
    }
  }
}

module.exports = { WeightedLruCache };
