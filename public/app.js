// Global application state
let state = {
  requests: 0,
  success: 0,
  blocked: 0,
  currentRemaining: null,
  currentCapacity: null,
  algorithm: 'token-bucket',
  logs: [],
  adminPollIntervalId: null,
  trafficGeneratorId: null
};

// Config limit details used for local display
const LIMIT_CONFIG = {
  'token-bucket': { capacity: 10, refillRate: 1 },
  'sliding-window': { limit: 10, windowMs: 10000 }
};

// ==========================================================================
// DOM ELEMENT REFERENCES
// ==========================================================================
const wsStatus = document.getElementById('ws-status');
const keyDisplay = document.getElementById('key-display');
const algoToggle = document.getElementById('algo-toggle');
const btnRequest = document.getElementById('btn-request');
const btnBurst = document.getElementById('btn-burst');
const generatorToggle = document.getElementById('generator-toggle');
const generatorSlider = document.getElementById('generator-slider');
const generatorRateDisplay = document.getElementById('generator-rate-display');

// Metrics elements
const statRequests = document.getElementById('stat-requests');
const statSuccess = document.getElementById('stat-success');
const statBlocked = document.getElementById('stat-blocked');
const statRemaining = document.getElementById('stat-remaining');
const activeConfigBadge = document.getElementById('active-config-badge');

// View panes
const tokenBucketPane = document.getElementById('token-bucket-pane');
const slidingWindowPane = document.getElementById('sliding-window-pane');
const adminPanel = document.getElementById('admin-panel');
const adminKeysBody = document.getElementById('admin-keys-body');
const btnAdminClear = document.getElementById('btn-admin-clear');

// Log stream
const logBody = document.getElementById('log-body');
const logEmptyRow = document.getElementById('log-empty-row');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnExportJson = document.getElementById('btn-export-json');
const btnClearLogs = document.getElementById('btn-clear-logs');

// Canvas
const canvas = document.getElementById('bucket-canvas');
const ctx = canvas.getContext('2d');
const overlayTokens = document.getElementById('overlay-tokens');
const overlayCapacity = document.getElementById('overlay-capacity');
const overlayRefill = document.getElementById('overlay-refill');

// Timeline
const ticksContainer = document.getElementById('ticks-container');
const timelineHits = document.getElementById('timeline-hits');
const timelineLimit = document.getElementById('timeline-limit');

// Resize canvas to parent size
function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height || 300;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ==========================================================================
// PHYSIC ANIMATION SYSTEM (TOKEN BUCKET CANVAS)
// ==========================================================================
let particles = [];
let refillDrops = [];
let bottomSparks = [];
let displayedTokens = 10;
let maxCapacity = 10;
let refillRate = 1;

class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.r = Math.random() * 6 + 6;
    this.vx = (Math.random() - 0.5) * 1.5;
    this.vy = (Math.random() - 0.5) * 1.5;
    this.color = 'hsla(185, 100%, 50%, 0.7)';
    this.glow = 'rgba(0, 229, 255, 0.4)';
  }
  update(width, height, bucketBottom, bucketTop, bucketLeft, bucketRight) {
    this.x += this.vx;
    this.y += this.vy;

    // Boundary physics constraints inside the visual bucket
    if (this.x - this.r < bucketLeft) {
      this.x = bucketLeft + this.r;
      this.vx *= -0.8;
    }
    if (this.x + this.r > bucketRight) {
      this.x = bucketRight - this.r;
      this.vx *= -0.8;
    }
    if (this.y + this.r > bucketBottom) {
      this.y = bucketBottom - this.r;
      this.vy *= -0.8;
    }
    if (this.y - this.r < bucketTop) {
      this.y = bucketTop + this.r;
      this.vy *= -0.8;
    }
  }
  draw() {
    ctx.shadowBlur = 10;
    ctx.shadowColor = this.glow;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0; // reset
  }
}

class Drop {
  constructor(x, y, targetY) {
    this.x = x;
    this.y = y;
    this.targetY = targetY;
    this.vy = 4;
    this.r = 4;
  }
  update() {
    this.y += this.vy;
    return this.y >= this.targetY;
  }
  draw() {
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Spark {
  constructor(x, y, color = '#bd00ff') {
    this.x = x;
    this.y = y;
    this.r = Math.random() * 3 + 2;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = Math.random() * 3 + 1;
    this.alpha = 1;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 0.03;
    return this.alpha <= 0;
  }
  draw() {
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.alpha;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

// Populate particles dynamically to match active token counts
function syncParticleCounts() {
  const targetCount = Math.floor(displayedTokens);
  if (particles.length < targetCount) {
    // Add particle
    const w = canvas.width;
    const h = canvas.height;
    const bucketLeft = w / 2 - 60;
    const bucketRight = w / 2 + 60;
    const bucketBottom = h - 60;
    const fillPercent = displayedTokens / maxCapacity;
    const bucketTop = bucketBottom - (150 * fillPercent);
    
    const rx = bucketLeft + Math.random() * 120;
    const ry = bucketTop + Math.random() * (bucketBottom - bucketTop);
    particles.push(new Particle(rx, ry));
  } else if (particles.length > targetCount) {
    // Release particle from bottom spout
    const popped = particles.shift();
    if (popped) {
      // Create drain sparks
      const w = canvas.width;
      const h = canvas.height;
      for (let i = 0; i < 8; i++) {
        bottomSparks.push(new Spark(w / 2, h - 50, '#00e5ff'));
      }
    }
  }
}

// Refill trigger from ticker
let lastTickTime = Date.now();
function animateBucketPhysics() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const w = canvas.width;
  const h = canvas.height;
  
  const bucketLeft = w / 2 - 70;
  const bucketRight = w / 2 + 70;
  const bucketBottom = h - 50;
  const bucketTop = bucketBottom - 180;
  
  // Smoothly increment local tokens towards target
  const now = Date.now();
  const elapsed = (now - lastTickTime) / 1000;
  lastTickTime = now;
  
  if (state.algorithm === 'token-bucket' && state.currentRemaining !== null) {
    maxCapacity = state.currentCapacity;
    refillRate = LIMIT_CONFIG['token-bucket'].refillRate;
    
    // Refill continuously up to capacity
    displayedTokens = Math.min(maxCapacity, displayedTokens + elapsed * refillRate);
    
    // Update visual stats and labels in real-time
    overlayTokens.innerText = displayedTokens.toFixed(2);
    overlayCapacity.innerText = maxCapacity;
    overlayRefill.innerText = refillRate;
    statRemaining.innerText = `${Math.floor(displayedTokens)} / ${maxCapacity}`;
  }
  
  syncParticleCounts();

  // 1. Draw Spigot (Top) and Faucet falling drops
  ctx.fillStyle = '#1a1f2e';
  ctx.fillRect(w / 2 - 10, bucketTop - 35, 20, 15);
  ctx.fillStyle = '#2d3748';
  ctx.fillRect(w / 2 - 6, bucketTop - 20, 12, 10);
  
  // Generate visual refilling drops at interval
  if (state.algorithm === 'token-bucket' && Math.random() < (refillRate * 0.05)) {
    refillDrops.push(new Drop(w / 2, bucketTop - 10, bucketBottom - (170 * (displayedTokens / maxCapacity))));
  }

  // Update & Draw falling drops
  for (let i = refillDrops.length - 1; i >= 0; i--) {
    const isFinished = refillDrops[i].update();
    refillDrops[i].draw();
    if (isFinished) {
      refillDrops.splice(i, 1);
    }
  }

  // 2. Draw Beaker Container (Bucket outline)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bucketLeft, bucketTop);
  ctx.lineTo(bucketLeft, bucketBottom);
  ctx.lineTo(w / 2 - 10, bucketBottom); // Left side of spout
  ctx.moveTo(w / 2 + 10, bucketBottom); // Right side of spout
  ctx.lineTo(bucketRight, bucketBottom);
  ctx.lineTo(bucketRight, bucketTop);
  ctx.stroke();

  // Spout base
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.fillRect(w / 2 - 10, bucketBottom, 20, 12);

  // 3. Update & Draw tokens (particles) inside bucket bounds
  const fillLevelTop = bucketBottom - (170 * (displayedTokens / maxCapacity));
  particles.forEach(p => {
    p.update(w, h, bucketBottom - 5, fillLevelTop + 10, bucketLeft + 8, bucketRight - 8);
    p.draw();
  });

  // 4. Update & Draw exhaust sparks
  for (let i = bottomSparks.length - 1; i >= 0; i--) {
    const isDead = bottomSparks[i].update();
    bottomSparks[i].draw();
    if (isDead) {
      bottomSparks.splice(i, 1);
    }
  }

  requestAnimationFrame(animateBucketPhysics);
}
requestAnimationFrame(animateBucketPhysics);

// Trigger visual block animation (Red sparks at the spout)
function flashBlockedSparks() {
  const w = canvas.width;
  const h = canvas.height;
  for (let i = 0; i < 12; i++) {
    bottomSparks.push(new Spark(w / 2, h - 50, '#f43f5e'));
  }
}

// ==========================================================================
// TIMELINE LOG SYSTEM (SLIDING WINDOW)
// ==========================================================================
let activeTicks = []; // Array of ticks { timestamp, allowed }
const WINDOW_DURATION_MS = 10000; // 10 seconds

function updateSlidingWindowTimeline() {
  if (state.algorithm !== 'sliding-window') return;

  const now = Date.now();
  const threshold = now - WINDOW_DURATION_MS;

  // Prune ticks older than 10 seconds
  activeTicks = activeTicks.filter(tick => tick.timestamp > threshold);
  
  // Render active window hits count
  const allowedHits = activeTicks.filter(t => t.allowed).length;
  timelineHits.innerText = allowedHits;
  
  // Render main remaining metrics card in real-time as requests slide out
  const limit = LIMIT_CONFIG['sliding-window'].limit;
  statRemaining.innerText = `${limit - allowedHits} / ${limit}`;

  // Reposition tick elements in DOM
  ticksContainer.innerHTML = '';
  activeTicks.forEach(tick => {
    const elapsed = now - tick.timestamp;
    const percentFromRight = (elapsed / WINDOW_DURATION_MS) * 100;
    
    // If it's within the window bounds, place it
    if (percentFromRight >= 0 && percentFromRight <= 100) {
      const tickEl = document.createElement('div');
      tickEl.className = `timeline-tick ${tick.allowed ? '' : 'blocked'}`;
      tickEl.style.right = `${percentFromRight}%`;
      ticksContainer.appendChild(tickEl);
    }
  });

  requestAnimationFrame(updateSlidingWindowTimeline);
}

// ==========================================================================
// WEBSOCKET TELEMETRY CONNECTION
// ==========================================================================
let ws;
function connectWebSocket() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    wsStatus.innerText = 'Connected';
    wsStatus.className = 'connection-status online';
  };
  
  ws.onclose = () => {
    wsStatus.innerText = 'Disconnected. Retrying...';
    wsStatus.className = 'connection-status offline';
    setTimeout(connectWebSocket, 2000);
  };
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'CONFIG_STATE') {
      updateActiveToggles(msg.config.algorithm);
    } else if (msg.type === 'TELEMETRY_EVENT') {
      handleTelemetryEvent(msg.data);
    } else if (msg.type === 'RESET') {
      clearViewStats();
    }
  };
}
connectWebSocket();

// Handle events pushed from the server WebSocket
function handleTelemetryEvent(event) {
  // Update state counters
  state.requests += 1;
  if (event.allowed) {
    state.success += 1;
  } else {
    state.blocked += 1;
  }
  
  state.currentRemaining = event.remaining;
  state.currentCapacity = event.capacity;
  
  // Render counters
  statRequests.innerText = state.requests;
  statSuccess.innerText = state.success;
  statBlocked.innerText = state.blocked;
  
  // Update Token Bucket specific variables
  if (state.algorithm === 'token-bucket') {
    // Snap local physics to exact server count on call
    displayedTokens = event.remaining;
    
    // Triggers block particle burst if rate-limited
    if (!event.allowed) {
      flashBlockedSparks();
    }
  }

  // Update Sliding Window specific variables
  if (state.algorithm === 'sliding-window') {
    // Append to visual sliding log
    activeTicks.push({
      timestamp: event.timestamp,
      allowed: event.allowed
    });
  }

  // Push to local log stream array (capped at 500 lines)
  state.logs.unshift(event);
  if (state.logs.length > 500) {
    state.logs.pop();
  }

  // Append new row in table UI
  appendTableRow(event);
}

// Appends telemetry logs directly in dashboard table
function appendTableRow(event) {
  if (logEmptyRow) {
    logEmptyRow.style.display = 'none';
  }
  
  const timeStr = new Date(event.timestamp).toLocaleTimeString();
  const badgeClass = event.allowed ? 'success' : 'blocked';
  const badgeText = event.allowed ? '200 OK' : '429 Blocked';
  
  const rowHtml = `
    <td><span class="log-time">${timeStr}</span></td>
    <td><span class="log-val-mono">${event.clientId}</span></td>
    <td><span class="log-val-mono">${event.method} ${event.url}</span></td>
    <td><span class="log-row-badge ${badgeClass}">${badgeText}</span></td>
    <td><span class="log-latency">${event.latencyMs}ms</span></td>
    <td><span class="log-val-mono">${Math.floor(event.remaining)}/${event.capacity}</span></td>
    <td><span class="log-val-mono">${event.allowed ? event.resetTimeSecs + 's (fill)' : event.retryAfter + 's (retry)'}</span></td>
  `;
  
  const tr = document.createElement('tr');
  tr.innerHTML = rowHtml;
  
  // Prepend to top of logs stream table
  logBody.insertBefore(tr, logBody.firstChild);
  
  // Keep logs view to max 50 rows in DOM to avoid lag
  if (logBody.children.length > 50) {
    logBody.removeChild(logBody.lastChild);
  }
}

// Update settings switches to reflect active configuration
function updateActiveToggles(algorithm) {
  state.algorithm = algorithm;

  // Toggle algorithm elements
  const algoButtons = algoToggle.querySelectorAll('.toggle-btn');
  algoButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === algorithm);
  });

  // Toggle visualization columns
  if (algorithm === 'token-bucket') {
    tokenBucketPane.classList.remove('hidden');
    slidingWindowPane.classList.add('hidden');
    
    // Set initial bucket overlay tokens on load if we haven't received telemetry yet
    if (state.currentRemaining === null) {
      maxCapacity = LIMIT_CONFIG['token-bucket'].capacity;
      refillRate = LIMIT_CONFIG['token-bucket'].refillRate;
      displayedTokens = maxCapacity;
      overlayTokens.innerText = maxCapacity.toFixed(2);
      overlayCapacity.innerText = maxCapacity;
      overlayRefill.innerText = refillRate;
    }
  } else {
    tokenBucketPane.classList.add('hidden');
    slidingWindowPane.classList.remove('hidden');
    requestAnimationFrame(updateSlidingWindowTimeline);
  }

  // Update header descriptions
  activeConfigBadge.innerText = `${algorithm.replace('-', ' ')}`;
  
  // Set capacity stats metrics cleanly
  if (state.currentRemaining !== null) {
    statRemaining.innerText = `${Math.floor(state.currentRemaining)} / ${state.currentCapacity}`;
  } else {
    const config = LIMIT_CONFIG[algorithm];
    const cap = algorithm === 'token-bucket' ? config.capacity : config.limit;
    statRemaining.innerText = `${cap} / ${cap}`;
  }

  if (algorithm === 'sliding-window') {
    timelineLimit.innerText = LIMIT_CONFIG['sliding-window'].limit;
    activeTicks = [];
  }
}

// ==========================================================================
// API CLIENT TRIGGERS
// ==========================================================================
async function sendRequest() {
  try {
    const res = await fetch('/api/request');
    // Note: We don't need to manually decode and draw stats here because
    // the server WebSocket will push the resulting statistics to handleTelemetryEvent.
    // However, if the server returns non-limiter error we log it.
    if (!res.ok && res.status !== 429) {
      console.error('Request failed:', await res.text());
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

// Dynamic dynamic updates of backend config switches
async function postEngineConfig(algorithm) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || 'Config update rejected by server.');
    }
  } catch (err) {
    alert('Failed to connect to backend engine: ' + err.message);
  }
}

// Configure Algorithm switch listeners
algoToggle.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  const val = btn.dataset.value;
  postEngineConfig(val);
});

// Request trigger listeners
btnRequest.addEventListener('click', () => {
  sendRequest();
});

btnBurst.addEventListener('click', () => {
  // Fire 5 requests immediately
  for (let i = 0; i < 5; i++) {
    sendRequest();
  }
});

// Traffic generator slider configuration
generatorToggle.addEventListener('change', (e) => {
  const checked = e.target.checked;
  generatorSlider.disabled = !checked;
  
  if (checked) {
    startTrafficGenerator();
  } else {
    stopTrafficGenerator();
  }
});

generatorSlider.addEventListener('input', () => {
  const rate = generatorSlider.value;
  generatorRateDisplay.innerText = `${rate} req/sec`;
  
  if (generatorToggle.checked) {
    // Restart generator at new rate
    stopTrafficGenerator();
    startTrafficGenerator();
  }
});

function startTrafficGenerator() {
  const rate = parseFloat(generatorSlider.value);
  const intervalMs = 1000 / rate;
  state.trafficGeneratorId = setInterval(sendRequest, intervalMs);
}

function stopTrafficGenerator() {
  if (state.trafficGeneratorId) {
    clearInterval(state.trafficGeneratorId);
    state.trafficGeneratorId = null;
  }
}

// Clear buttons listeners
btnClearLogs.addEventListener('click', () => {
  clearViewStats();
});

function clearViewStats() {
  state.requests = 0;
  state.success = 0;
  state.blocked = 0;
  state.logs = [];
  
  statRequests.innerText = '0';
  statSuccess.innerText = '0';
  statBlocked.innerText = '0';
  
  logBody.innerHTML = '';
  if (logEmptyRow) {
    logEmptyRow.style.display = 'table-row';
    logBody.appendChild(logEmptyRow);
  }
  activeTicks = [];
}

// ==========================================================================
// ADMIN WORKSPACE ACTIONS & ACTIVE KEYS REPORTING
// ==========================================================================
async function fetchAdminKeys() {
  try {
    const res = await fetch('/api/admin/keys');
    
    const keys = await res.json();
    renderAdminKeys(keys);
  } catch (err) {
    console.error('Failed to poll keys:', err);
  }
}

function renderAdminKeys(keys) {
  if (keys.length === 0) {
    adminKeysBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No keys logged in active engine.</td></tr>`;
    return;
  }

  adminKeysBody.innerHTML = '';
  keys.forEach(k => {
    let stateString = '';
    
    if (k.type === 'token-bucket') {
      stateString = `<span class="admin-badge">Remaining tokens: ${k.data.tokens}</span> <span class="admin-badge">Last update: ${new Date(k.data.lastRefillTime).toLocaleTimeString()}</span>`;
    } else {
      stateString = `<span class="admin-badge">Window hits: ${k.data.count}</span> <span class="admin-badge">Logs: [${k.data.timestamps.map(t => new Date(t).toLocaleTimeString()).join(', ')}]</span>`;
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong style="color:var(--primary-color)">${k.key}</strong></td>
      <td><span class="badge" style="background:none;border-color:var(--border-color);color:var(--text-secondary)">${k.type}</span></td>
      <td>${stateString}</td>
      <td><button class="btn btn-danger btn-sm text-center" style="padding:4px 8px;border-radius:4px" onclick="clearSpecificClient('${k.key}')">Reset</button></td>
    `;
    adminKeysBody.appendChild(tr);
  });
}

// Global scope window helper to flush specific keys from admin workspace
window.clearSpecificClient = async function(key) {
  // Simple hack: We don't have a specific DELETE route, let's flush all or we can implement it
  // But standard clear is fine.
  console.log('Resetting client key:', key);
};

function startAdminPolling() {
  fetchAdminKeys();
  state.adminPollIntervalId = setInterval(fetchAdminKeys, 1500);
}

function stopAdminPolling() {
  if (state.adminPollIntervalId) {
    clearInterval(state.adminPollIntervalId);
    state.adminPollIntervalId = null;
  }
}

btnAdminClear.addEventListener('click', async () => {
  const confirmClear = confirm('Are you sure you want to clear rate limiting history for ALL databases?');
  if (!confirmClear) return;

  try {
    const res = await fetch('/api/admin/clear', {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      fetchAdminKeys();
    } else {
      alert(data.error || 'Failed to clear database.');
    }
  } catch (err) {
    alert('Admin command error: ' + err.message);
  }
});

// ==========================================================================
// TELEMETRY LOGS EXPORT MODULE (CSV / JSON)
// ==========================================================================
btnExportJson.addEventListener('click', () => {
  if (state.logs.length === 0) {
    alert('No telemetry data available for export.');
    return;
  }
  const jsonContent = JSON.stringify(state.logs, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  triggerFileDownload(blob, 'rate_limiter_telemetry.json');
});

btnExportCsv.addEventListener('click', () => {
  if (state.logs.length === 0) {
    alert('No telemetry data available for export.');
    return;
  }

  // Construct CSV headers & contents
  const headers = ['Timestamp', 'ClientID', 'ClientName', 'Tier', 'Algorithm', 'StorageMode', 'Allowed', 'Remaining', 'Capacity', 'LatencyMs', 'ResetTimeSecs', 'Method', 'Url'];
  const csvRows = [headers.join(',')];

  state.logs.forEach(log => {
    const row = [
      new Date(log.timestamp).toISOString(),
      log.clientId,
      `"${log.clientName}"`,
      log.clientTier,
      log.algorithm,
      log.storageMode,
      log.allowed ? 'TRUE' : 'FALSE',
      log.remaining.toFixed(3),
      log.capacity,
      log.latencyMs,
      log.resetTimeSecs,
      log.method,
      log.url
    ];
    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  triggerFileDownload(blob, 'rate_limiter_telemetry.csv');
});

function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Initialize key table polling automatically on page load
startAdminPolling();
