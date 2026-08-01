/**
 * Abstract class representing a Storage Provider for rate limiting state.
 * Both In-Memory and Redis storage implementations must inherit from this
 * and implement its methods.
 */
export class StorageProvider {
  /**
   * Get the state of a Token Bucket for a specific client key.
   * @param {string} key - The identifier for the client (e.g., IP, API key)
   * @returns {Promise<{tokens: number, lastRefillTime: number} | null>}
   */
  async getBucket(key) {
    throw new Error('getBucket(key) must be implemented');
  }

  /**
   * Save the state of a Token Bucket for a specific client key.
   * @param {string} key - The identifier for the client
   * @param {number} tokens - The updated token count
   * @param {number} lastRefillTime - The timestamp of this update in milliseconds
   * @returns {Promise<void>}
   */
  async setBucket(key, tokens, lastRefillTime) {
    throw new Error('setBucket(key, tokens, lastRefillTime) must be implemented');
  }

  /**
   * Record a request timestamp for the Sliding Window Log.
   * @param {string} key - The identifier for the client
   * @param {number} timestamp - The current timestamp in milliseconds
   * @param {number} windowMs - The sliding window duration in milliseconds
   * @returns {Promise<void>}
   */
  async addSlidingWindowLog(key, timestamp, windowMs) {
    throw new Error('addSlidingWindowLog(key, timestamp, windowMs) must be implemented');
  }

  /**
   * Retrieve the active request timestamps for a Sliding Window Log client.
   * @param {string} key - The identifier for the client
   * @param {number} timestamp - The current timestamp in milliseconds
   * @param {number} windowMs - The sliding window duration in milliseconds
   * @returns {Promise<number[]>} Array of active timestamps in the window
   */
  async getSlidingWindowLog(key, timestamp, windowMs) {
    throw new Error('getSlidingWindowLog(key, timestamp, windowMs) must be implemented');
  }

  /**
   * Retrieve all active client keys and their current states for admin reporting.
   * @returns {Promise<Array<{key: string, type: 'token-bucket' | 'sliding-window', data: any}>>}
   */
  async getAllKeys() {
    throw new Error('getAllKeys() must be implemented');
  }

  /**
   * Clear all active rate limiting buckets and logs from the store.
   * @returns {Promise<void>}
   */
  async clearAll() {
    throw new Error('clearAll() must be implemented');
  }
}
