/**
 * Token Bucket Rate Limiter Algorithm implementation.
 */
export class TokenBucketLimiter {
  /**
   * @param {StorageProvider} storage - The storage engine (Memory or Redis)
   */
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Attempt to consume 1 token from the client's bucket.
   * @param {string} key - Unique identifier for the client (IP or API key)
   * @param {object} config - Config for the client tier
   * @param {number} config.capacity - Maximum bucket size
   * @param {number} config.refillRate - Tokens added per second
   * @returns {Promise<{allowed: boolean, tokens: number, capacity: number, refillRate: number, retryAfter: number, resetTimeSecs: number}>}
   */
  async consume(key, config) {
    const { capacity, refillRate } = config;
    const now = Date.now();
    
    // Fetch state from storage
    let state = await this.storage.getBucket(key);
    
    let tokens;
    let lastRefillTime;

    if (!state) {
      // First request: initialize bucket to full capacity
      tokens = capacity;
      lastRefillTime = now;
    } else {
      // Calculate token replenishment since last refill time
      const elapsedMs = now - state.lastRefillTime;
      const refilledTokens = (elapsedMs / 1000) * refillRate;
      
      tokens = Math.min(capacity, state.tokens + refilledTokens);
      lastRefillTime = now;
    }

    let allowed = false;
    let retryAfter = 0;

    if (tokens >= 1) {
      allowed = true;
      tokens -= 1;
    } else {
      // Calculate how many seconds until at least 1 token is available
      const tokensNeeded = 1 - tokens;
      retryAfter = parseFloat((tokensNeeded / refillRate).toFixed(2));
    }

    // Save updated state to storage
    await this.storage.setBucket(key, tokens, lastRefillTime);

    // Calculate seconds until the bucket is completely full again
    const resetTimeSecs = parseFloat(((capacity - tokens) / refillRate).toFixed(2));

    return {
      allowed,
      tokens: parseFloat(tokens.toFixed(3)),
      capacity,
      refillRate,
      retryAfter: allowed ? 0 : Math.max(1, Math.ceil(retryAfter)), // Return standard integer seconds for HTTP Retry-After
      resetTimeSecs
    };
  }
}
