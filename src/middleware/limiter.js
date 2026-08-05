import client from 'prom-client';
import { TokenBucketLimiter } from '../algorithms/TokenBucketLimiter.js';
import { SlidingWindowLogLimiter } from '../algorithms/SlidingWindowLogLimiter.js';

// Configuration parameters for rate limiting algorithms
export const LIMIT_CONFIG = {
  'token-bucket': { capacity: 10, refillRate: 1 }, // 10 max, refilled at 1/sec
  'sliding-window': { limit: 10, windowMs: 10000 }  // 10 requests per 10 seconds
};

// Global active configuration state
let activeStorage = null;
let activeStorageName = 'memory'; // 'memory' | 'redis'
let activeAlgorithmName = 'token-bucket'; // 'token-bucket' | 'sliding-window'
let telemetryCallback = null;

// Prometheus metrics setup
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

const requestCounter = new client.Counter({
  name: 'rate_limiter_requests_total',
  help: 'Total rate limited requests processed',
  labelNames: ['client_tier', 'status', 'algorithm', 'storage_mode']
});

const latencySummary = new client.Summary({
  name: 'rate_limiter_latency_seconds',
  help: 'Rate limiting validation latency in seconds',
  labelNames: ['algorithm', 'storage_mode']
});

/**
 * Configure the active storage provider and rate limiter algorithm.
 * @param {StorageProvider} storage - Storage engine instance
 * @param {string} algorithmName - 'token-bucket' | 'sliding-window'
 * @param {string} storageName - 'memory' | 'redis'
 */
export function configureLimiter(storage, algorithmName = 'token-bucket', storageName = 'memory') {
  activeStorage = storage;
  activeAlgorithmName = algorithmName;
  activeStorageName = storageName;
}

/**
 * Register a callback to pipe telemetry events to WebSockets.
 * @param {function} callback
 */
export function registerTelemetryCallback(callback) {
  telemetryCallback = callback;
}

/**
 * Express middleware applying the active rate limiting checks.
 */
export async function rateLimiter(req, res, next) {
  if (!activeStorage) {
    return next(); // If not configured, bypass
  }

  const clientId = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const clientName = `Client (${clientId})`;
  const clientTier = 'standard';

  const storageMode = activeStorageName;
  const config = LIMIT_CONFIG[activeAlgorithmName];
  
  // Choose algorithm instance
  let algorithmInstance;
  if (activeAlgorithmName === 'token-bucket') {
    algorithmInstance = new TokenBucketLimiter(activeStorage);
  } else {
    algorithmInstance = new SlidingWindowLogLimiter(activeStorage);
  }

  const start = process.hrtime();
  let result;
  
  try {
    result = await algorithmInstance.consume(clientId, config);
  } catch (error) {
    console.error('Rate limiter execution error:', error);
    return res.status(500).json({ error: 'Internal rate limiting error' });
  }

  const diff = process.hrtime(start);
  const latencySecs = diff[0] + diff[1] / 1e9;

  // Record metrics
  const statusLabel = result.allowed ? 'allowed' : 'blocked';
  requestCounter.inc({
    client_tier: clientTier,
    status: statusLabel,
    algorithm: activeAlgorithmName,
    storage_mode: storageMode
  });
  latencySummary.observe({
    algorithm: activeAlgorithmName,
    storage_mode: storageMode
  }, latencySecs);

  // Determine headers
  const limitValue = activeAlgorithmName === 'token-bucket' ? result.capacity : result.limit;
  const remainingValue = activeAlgorithmName === 'token-bucket' ? result.tokens : result.remaining;

  res.setHeader('X-RateLimit-Limit', limitValue);
  res.setHeader('X-RateLimit-Remaining', Math.floor(remainingValue));
  res.setHeader('X-RateLimit-Reset', result.resetTimeSecs);

  // Send real-time telemetry log via WebSocket callback
  if (telemetryCallback) {
    telemetryCallback({
      timestamp: Date.now(),
      clientId,
      clientName,
      clientTier,
      algorithm: activeAlgorithmName,
      storageMode,
      allowed: result.allowed,
      remaining: remainingValue,
      capacity: limitValue,
      retryAfter: result.retryAfter,
      resetTimeSecs: result.resetTimeSecs,
      method: req.method,
      url: req.originalUrl,
      latencyMs: parseFloat((latencySecs * 1000).toFixed(3))
    });
  }

  if (result.allowed) {
    next();
  } else {
    res.setHeader('Retry-After', result.retryAfter);
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Please retry in ${result.retryAfter}s.`,
      retryAfter: result.retryAfter,
      resetTimeSecs: result.resetTimeSecs
    });
  }
}

// Expose active configuration getters for the admin APIs
export function getLimiterState() {
  return {
    algorithm: activeAlgorithmName,
    storage: activeStorageName
  };
}
