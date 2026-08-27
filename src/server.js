import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import client from 'prom-client';

import { MemoryStorage } from './storage/MemoryStorage.js';
import { RedisStorage } from './storage/RedisStorage.js';
import {
  rateLimiter,
  configureLimiter,
  registerTelemetryCallback,
  getLimiterState
} from './middleware/limiter.js';

const app = express();
const port = process.env.PORT || 3000;

// Trust reverse proxies (Render, Railway, Heroku, AWS, Vercel, Cloudflare, etc.)
app.set('trust proxy', true);

// Enable CORS and parsing of JSON payloads
app.use(cors());
app.use(express.json());

// Serve the frontend dashboard statically from /public
app.use(express.static('public'));

// Initialize storage providers
const memoryStorage = new MemoryStorage();
const redisStorage = new RedisStorage();

let currentStorageType = 'memory';

function getActiveStorage() {
  return currentStorageType === 'redis' ? redisStorage : memoryStorage;
}

// Initial configuration of the rate limiter (default algorithm: token-bucket, storage: memory)
configureLimiter(memoryStorage, 'token-bucket', 'memory');

/* ==========================================================================
   API ENDPOINTS
   ========================================================================== */

/**
 * Public rate-limited test resource.
 */
app.get('/api/request', rateLimiter, (req, res) => {
  res.json({
    success: true,
    message: 'API request completed successfully!',
    timestamp: Date.now(),
    client: {
      id: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
    }
  });
});

/**
 * Endpoint to inspect and update rate-limiter configuration.
 */
app.get('/api/config', (req, res) => {
  res.json({
    ...getLimiterState(),
    redis: redisStorage.getStatus()
  });
});

app.post('/api/config', async (req, res) => {
  const { algorithm, storage } = req.body;

  if (algorithm && !['token-bucket', 'sliding-window'].includes(algorithm)) {
    return res.status(400).json({ error: 'Invalid algorithm specified' });
  }

  if (storage && !['memory', 'redis'].includes(storage)) {
    return res.status(400).json({ error: 'Invalid storage specified. Must be "memory" or "redis".' });
  }

  if (storage) {
    currentStorageType = storage;
  }

  // Apply new settings
  const targetAlgorithm = algorithm || getLimiterState().algorithm;
  configureLimiter(getActiveStorage(), targetAlgorithm, currentStorageType);

  // Broadcast the updated configuration to all connected WebSocket clients
  broadcast({
    type: 'CONFIG_STATE',
    config: getLimiterState(),
    redis: redisStorage.getStatus()
  });

  res.json({
    success: true,
    message: 'Configuration updated successfully',
    ...getLimiterState(),
    redis: redisStorage.getStatus()
  });
});

/**
 * Admin API: Retrieve list of all client rate limit bucket states from active storage.
 */
app.get('/api/admin/keys', async (req, res) => {
  try {
    const keysData = await getActiveStorage().getAllKeys();
    res.json(keysData);
  } catch (err) {
    console.error('Error fetching admin keys:', err);
    res.status(500).json({ error: 'Failed to retrieve active client states' });
  }
});

/**
 * Admin API: Flush all client states in both memory and redis storage engines.
 */
app.post('/api/admin/clear', async (req, res) => {
  try {
    await Promise.all([
      memoryStorage.clearAll(),
      redisStorage.clearAll().catch((err) => console.warn('Redis clearAll skipped:', err.message))
    ]);
    // Notify dashboard users of configuration reset
    broadcast({ type: 'RESET', timestamp: Date.now() });
    res.json({ success: true, message: 'All storage engines cleared.' });
  } catch (err) {
    console.error('Error clearing storage:', err);
    res.status(500).json({ error: 'Failed to clear rate limiter storage' });
  }
});

/**
 * Prometheus metrics scrape endpoint.
 */
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

/* ==========================================================================
   WEBSOCKET TELEMETRY SERVER
   ========================================================================== */

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  
  // Push initial configuration & redis status immediately on connection
  ws.send(JSON.stringify({
    type: 'CONFIG_STATE',
    config: getLimiterState(),
    redis: redisStorage.getStatus()
  }));

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
});

/**
 * Helper to broadcast JSON messages to all connected WebSocket clients.
 */
function broadcast(data) {
  const message = JSON.stringify(data);
  for (const client of connectedClients) {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  }
}

// Bind rate limiter telemetry events directly to WebSocket broadcast
registerTelemetryCallback((eventData) => {
  broadcast({
    type: 'TELEMETRY_EVENT',
    data: eventData
  });
});

/* ==========================================================================
   START SERVER
   ========================================================================== */

server.listen(port, () => {
  console.log(`===================================================`);
  console.log(`Rate Limiting Sandbox Server listening on port ${port}`);
  console.log(`Dashboard UI: http://localhost:${port}`);
  console.log(`Prometheus Metrics: http://localhost:${port}/metrics`);
  console.log(`===================================================`);
});
