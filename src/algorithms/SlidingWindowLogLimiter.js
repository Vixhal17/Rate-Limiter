/**
 * Sliding Window Log Rate Limiter Algorithm implementation.
 */
export class SlidingWindowLogLimiter {
  /**
   * @param {StorageProvider} storage - The storage engine (Memory or Redis)
   */
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Attempt to consume 1 slot in the sliding window.
   * @param {string} key - Unique identifier for the client (IP or API key)
   * @param {object} config - Config for the client tier
   * @param {number} config.limit - Maximum number of requests allowed in the window
   * @param {number} config.windowMs - Sliding window duration in milliseconds
   * @returns {Promise<{allowed: boolean, count: number, limit: number, windowMs: number, remaining: number, retryAfter: number, resetTimeSecs: number}>}
   */
  async consume(key, config) {
    const { limit, windowMs } = config;
    const now = Date.now();

    // Fetch active request timestamps from storage
    const log = await this.storage.getSlidingWindowLog(key, now, windowMs);
    const count = log.length;

    let allowed = false;
    let retryAfter = 0;
    let remaining = limit - count;

    if (count < limit) {
      allowed = true;
      remaining = limit - (count + 1);
      // Log the current request
      await this.storage.addSlidingWindowLog(key, now, windowMs);
    } else {
      // Calculate how long until the oldest request slides out of the window
      const oldestTimestamp = log[0] || now;
      const msUntilExpiry = (oldestTimestamp + windowMs) - now;
      retryAfter = parseFloat((msUntilExpiry / 1000).toFixed(2));
    }

    // Determine when the window will be completely clear of all requests
    let resetTimeSecs;
    if (allowed) {
      // The newest request will expire in windowMs
      resetTimeSecs = parseFloat((windowMs / 1000).toFixed(2));
    } else {
      // The newest logged request will expire at log[last] + windowMs
      const newestTimestamp = log[log.length - 1] || now;
      const msUntilFullExpiry = (newestTimestamp + windowMs) - now;
      resetTimeSecs = parseFloat((msUntilFullExpiry / 1000).toFixed(2));
    }

    return {
      allowed,
      count: allowed ? count + 1 : count,
      limit,
      windowMs,
      remaining: Math.max(0, remaining),
      retryAfter: allowed ? 0 : Math.max(1, Math.ceil(retryAfter)), // Return standard integer seconds for HTTP Retry-After
      resetTimeSecs: Math.max(0, resetTimeSecs)
    };
  }
}
