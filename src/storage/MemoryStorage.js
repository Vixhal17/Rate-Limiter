import { StorageProvider } from './StorageProvider.js';

export class MemoryStorage extends StorageProvider {
  constructor() {
    super();
    this.tokenBuckets = new Map(); // key -> { tokens, lastRefillTime }
    this.slidingLogs = new Map();  // key -> Array of timestamps (numbers)
  }

  async getBucket(key) {
    const bucket = this.tokenBuckets.get(key);
    return bucket ? { ...bucket } : null;
  }

  async setBucket(key, tokens, lastRefillTime) {
    this.tokenBuckets.set(key, { tokens, lastRefillTime });
  }

  async addSlidingWindowLog(key, timestamp, windowMs) {
    if (!this.slidingLogs.has(key)) {
      this.slidingLogs.set(key, []);
    }
    const log = this.slidingLogs.get(key);
    log.push(timestamp);

    // Prune logs older than the window threshold
    const threshold = timestamp - windowMs;
    const prunedLog = log.filter(t => t > threshold);
    this.slidingLogs.set(key, prunedLog);
  }

  async getSlidingWindowLog(key, timestamp, windowMs) {
    const log = this.slidingLogs.get(key);
    if (!log || log.length === 0) return [];

    const threshold = timestamp - windowMs;
    const prunedLog = log.filter(t => t > threshold);
    this.slidingLogs.set(key, prunedLog);

    return [...prunedLog];
  }

  async getAllKeys() {
    const result = [];

    // Gather token buckets
    for (const [key, data] of this.tokenBuckets.entries()) {
      result.push({
        key,
        type: 'token-bucket',
        data: {
          tokens: parseFloat(data.tokens.toFixed(3)),
          lastRefillTime: data.lastRefillTime
        }
      });
    }

    // Gather sliding window logs
    for (const [key, log] of this.slidingLogs.entries()) {
      result.push({
        key,
        type: 'sliding-window',
        data: {
          count: log.length,
          timestamps: [...log]
        }
      });
    }

    return result;
  }

  async clearAll() {
    this.tokenBuckets.clear();
    this.slidingLogs.clear();
  }
}
