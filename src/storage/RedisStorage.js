import Redis from 'ioredis';
import { StorageProvider } from './StorageProvider.js';

/**
 * High-performance Distributed Redis Storage Provider for rate limiting state.
 * Implements atomic hash and sorted-set operations for Token Bucket and Sliding Window Log.
 */
export class RedisStorage extends StorageProvider {
  /**
   * @param {string} [redisUrl] - Connection string (e.g. redis://127.0.0.1:6379)
   * @param {object} [options] - ioredis configuration options
   */
  constructor(redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379', options = {}) {
    super();
    this.redisUrl = redisUrl;
    this.connected = false;
    this.status = 'connecting';
    this.keyPrefix = 'rl:';

    // Initialize Redis client with automatic reconnection and fallback safety
    this.client = new Redis(this.redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        // Reconnect backoff up to 5 seconds
        return Math.min(times * 200, 5000);
      },
      enableOfflineQueue: false, // Fail fast if disconnected rather than hanging requests
      ...options
    });

    this.client.on('connect', () => {
      this.status = 'connecting';
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.status = 'ready';
      console.log(`[RedisStorage] Connected and ready at ${this.redisUrl}`);
    });

    this.client.on('error', (err) => {
      this.connected = false;
      this.status = 'error';
      // Suppress noisy crash on ECONNREFUSED in development/sandbox
      if (err.code === 'ECONNREFUSED') {
        // Redis server not running locally
      } else {
        console.warn(`[RedisStorage] Redis warning: ${err.message}`);
      }
    });

    this.client.on('close', () => {
      this.connected = false;
      this.status = 'closed';
    });
  }

  /**
   * Check connection status
   * @returns {{ isConnected: boolean, status: string, redisUrl: string }}
   */
  getStatus() {
    return {
      isConnected: this.connected,
      status: this.status,
      redisUrl: this.redisUrl
    };
  }

  /**
   * Helper to build bucket key
   */
  _bucketKey(key) {
    return `${this.keyPrefix}bucket:${key}`;
  }

  /**
   * Helper to build sliding window log key
   */
  _slidingKey(key) {
    return `${this.keyPrefix}sliding:${key}`;
  }

  /**
   * Retrieve the state of a Token Bucket from Redis hash.
   * @param {string} key
   * @returns {Promise<{tokens: number, lastRefillTime: number} | null>}
   */
  async getBucket(key) {
    try {
      const bucketKey = this._bucketKey(key);
      const data = await this.client.hgetall(bucketKey);

      if (!data || !data.tokens || !data.lastRefillTime) {
        return null;
      }

      return {
        tokens: parseFloat(data.tokens),
        lastRefillTime: parseInt(data.lastRefillTime, 10)
      };
    } catch (err) {
      console.error(`[RedisStorage] getBucket error for key "${key}":`, err.message);
      throw err;
    }
  }

  /**
   * Save the Token Bucket state as a Redis hash with expiration.
   * @param {string} key
   * @param {number} tokens
   * @param {number} lastRefillTime
   * @returns {Promise<void>}
   */
  async setBucket(key, tokens, lastRefillTime) {
    try {
      const bucketKey = this._bucketKey(key);
      const pipeline = this.client.pipeline();

      pipeline.hset(bucketKey, {
        tokens: tokens.toString(),
        lastRefillTime: lastRefillTime.toString()
      });
      // Safety TTL of 5 minutes to clean inactive client keys automatically
      pipeline.expire(bucketKey, 300);

      await pipeline.exec();
    } catch (err) {
      console.error(`[RedisStorage] setBucket error for key "${key}":`, err.message);
      throw err;
    }
  }

  /**
   * Record a request timestamp for Sliding Window Log in a Redis Sorted Set (ZSET).
   * @param {string} key
   * @param {number} timestamp
   * @param {number} windowMs
   * @returns {Promise<void>}
   */
  async addSlidingWindowLog(key, timestamp, windowMs) {
    try {
      const slidingKey = this._slidingKey(key);
      const threshold = timestamp - windowMs;
      // Use unique member suffix (timestamp:random) so multiple concurrent calls in the same ms are preserved
      const uniqueMember = `${timestamp}:${Math.random().toString(36).substring(2, 8)}`;
      const ttlSecs = Math.max(60, Math.ceil((windowMs * 2) / 1000));

      const pipeline = this.client.pipeline();
      pipeline.zadd(slidingKey, timestamp, uniqueMember);
      pipeline.zremrangebyscore(slidingKey, '-inf', threshold);
      pipeline.expire(slidingKey, ttlSecs);

      await pipeline.exec();
    } catch (err) {
      console.error(`[RedisStorage] addSlidingWindowLog error for key "${key}":`, err.message);
      throw err;
    }
  }

  /**
   * Retrieve active timestamps from the Redis Sorted Set within the sliding window.
   * @param {string} key
   * @param {number} timestamp
   * @param {number} windowMs
   * @returns {Promise<number[]>}
   */
  async getSlidingWindowLog(key, timestamp, windowMs) {
    try {
      const slidingKey = this._slidingKey(key);
      const threshold = timestamp - windowMs;

      // Pipeline prune and fetch active scores
      const pipeline = this.client.pipeline();
      pipeline.zremrangebyscore(slidingKey, '-inf', threshold);
      pipeline.zrangebyscore(slidingKey, `(${threshold}`, '+inf', 'WITHSCORES');

      const results = await pipeline.exec();
      // results[1] is [err, [member1, score1, member2, score2, ...]]
      const rangeResult = results[1][1] || [];

      const timestamps = [];
      for (let i = 1; i < rangeResult.length; i += 2) {
        timestamps.push(parseFloat(rangeResult[i]));
      }

      return timestamps;
    } catch (err) {
      console.error(`[RedisStorage] getSlidingWindowLog error for key "${key}":`, err.message);
      throw err;
    }
  }

  /**
   * Scan and collect all active client keys and their metrics.
   * @returns {Promise<Array<{key: string, type: 'token-bucket' | 'sliding-window', data: any}>>}
   */
  async getAllKeys() {
    try {
      const result = [];
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.client.keys(pattern);

      for (const fullKey of keys) {
        if (fullKey.startsWith(`${this.keyPrefix}bucket:`)) {
          const clientKey = fullKey.replace(`${this.keyPrefix}bucket:`, '');
          const data = await this.client.hgetall(fullKey);
          if (data && data.tokens) {
            result.push({
              key: clientKey,
              type: 'token-bucket',
              data: {
                tokens: parseFloat(parseFloat(data.tokens).toFixed(3)),
                lastRefillTime: parseInt(data.lastRefillTime, 10)
              }
            });
          }
        } else if (fullKey.startsWith(`${this.keyPrefix}sliding:`)) {
          const clientKey = fullKey.replace(`${this.keyPrefix}sliding:`, '');
          const rangeResult = await this.client.zrangebyscore(fullKey, '-inf', '+inf', 'WITHSCORES');
          const timestamps = [];
          for (let i = 1; i < rangeResult.length; i += 2) {
            timestamps.push(parseFloat(rangeResult[i]));
          }

          result.push({
            key: clientKey,
            type: 'sliding-window',
            data: {
              count: timestamps.length,
              timestamps
            }
          });
        }
      }

      return result;
    } catch (err) {
      console.error('[RedisStorage] getAllKeys error:', err.message);
      return [];
    }
  }

  /**
   * Clear all active rate limiter keys in Redis matching the prefix.
   * @returns {Promise<void>}
   */
  async clearAll() {
    try {
      const keys = await this.client.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      console.error('[RedisStorage] clearAll error:', err.message);
      throw err;
    }
  }

  /**
   * Gracefully close Redis connection.
   */
  async disconnect() {
    try {
      await this.client.quit();
    } catch (err) {
      this.client.disconnect();
    }
  }
}
