// ==========================================================================
// RATELAB SANDBOX & TELEMETRY APPLICATION LOGIC (DASHBOARD)
// ==========================================================================

// Global application state
let state = {
  requests: 0,
  success: 0,
  blocked: 0,
  currentRemaining: null,
  currentCapacity: null,
  algorithm: 'token-bucket',
  storage: 'memory',
  redisStatus: null,
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
const wsStatusText = document.getElementById('ws-status-text');
const heroStatusText = document.getElementById('hero-status-text');
const heroConnectionPill = document.getElementById('hero-connection-pill');
const algoToggle = document.getElementById('algo-toggle');
const storageToggle = document.getElementById('storage-toggle');
const redisIndicator = document.getElementById('redis-indicator');
const redisIndicatorText = document.getElementById('redis-indicator-text');
const redisBadgeStatus = document.getElementById('redis-badge-status');

const btnRequest = document.getElementById('btn-request');
const btnBurst = document.getElementById('btn-burst');
const generatorToggle = document.getElementById('generator-toggle');
const generatorSlider = document.getElementById('generator-slider');
const generatorRateDisplay = document.getElementById('generator-rate-display');
const stepperRateText = document.getElementById('stepper-rate-text');

// Metrics elements
const statRequests = document.getElementById('stat-requests');
const statSuccess = document.getElementById('stat-success');
const statBlocked = document.getElementById('stat-blocked');
const statRemaining = document.getElementById('stat-remaining');
const capacitySublabelText = document.getElementById('capacity-sublabel-text');
const activeConfigBadge = document.getElementById('active-config-badge');

// Decision path nodes
const flowIncomingVal = document.getElementById('flow-incoming-val');
const flowRateVal = document.getElementById('flow-rate-val');
const flowAllowedVal = document.getElementById('flow-allowed-val');
const flowBlockedVal = document.getElementById('flow-blocked-val');
const decisionLimiterTitle = document.getElementById('decision-limiter-title');
const decisionLimiterStatus = document.getElementById('decision-limiter-status');
const mainLimiterNodeBox = document.getElementById('main-limiter-node-box');
const summaryDecisionText = document.getElementById('summary-decision-text');
const summaryPolicyDecision = document.getElementById('summary-policy-decision');
const summaryRefillText = document.getElementById('summary-refill-text');
const summaryPersistenceText = document.getElementById('summary-persistence-text');

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
const ctx = canvas ? canvas.getContext('2d') : null;
const overlayTokens = document.getElementById('overlay-tokens');
const overlayCapacity = document.getElementById('overlay-capacity');
const overlayRefill = document.getElementById('overlay-refill');

// Timeline
const ticksContainer = document.getElementById('ticks-container');
const timelineHits = document.getElementById('timeline-hits');
const timelineLimit = document.getElementById('timeline-limit');

// Resize canvas to parent size
function resizeCanvas() {
  if (!canvas || !canvas.parentElement) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width || 400;
  canvas.height = rect.height || 220;
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

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
    this.r = Math.random() * 4 + 5;
    this.vx = (Math.random() - 0.5) * 1.2;
    this.vy = (Math.random() - 0.5) * 1.2;
    this.color = '#ea580c';
  }
  update(width, height, bucketBottom, bucketTop, bucketLeft, bucketRight) {
    this.x += this.vx;
    this.y += this.vy;

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
    if (!ctx) return;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Drop {
  constructor(x, y, targetY) {
    this.x = x;
    this.y = y;
    this.targetY = targetY;
    this.vy = 4.5;
    this.r = 3.5;
  }
  update() {
    this.y += this.vy;
    return this.y >= this.targetY;
  }
  draw() {
    if (!ctx) return;
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Spark {
  constructor(x, y, color = '#ea580c') {
    this.x = x;
    this.y = y;
    this.r = Math.random() * 3 + 1.5;
    this.vx = (Math.random() - 0.5) * 3.5;
    this.vy = Math.random() * 2.5 + 1;
    this.alpha = 1;
    this.color = color;
  }
  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= 0.035;
    return this.alpha <= 0;
  }
  draw() {
    if (!ctx) return;
    ctx.fillStyle = this.color;
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }
}

function syncParticleCounts() {
  if (!canvas) return;
  const targetCount = Math.floor(displayedTokens);
  if (particles.length < targetCount) {
    const w = canvas.width;
    const h = canvas.height;
    const bucketLeft = w / 2 - 60;
    const bucketRight = w / 2 + 60;
    const bucketBottom = h - 45;
    const fillPercent = displayedTokens / maxCapacity;
    const bucketTop = bucketBottom - (130 * fillPercent);
    
    const rx = bucketLeft + Math.random() * 120;
    const ry = bucketTop + Math.random() * Math.max(10, bucketBottom - bucketTop);
    particles.push(new Particle(rx, ry));
  } else if (particles.length > targetCount) {
    const popped = particles.shift();
    if (popped) {
      const w = canvas.width;
      const h = canvas.height;
      for (let i = 0; i < 6; i++) {
        bottomSparks.push(new Spark(w / 2, h - 40, '#ea580c'));
      }
    }
  }
}

let lastTickTime = Date.now();
function animateBucketPhysics() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const w = canvas.width;
  const h = canvas.height;
  
  const bucketLeft = w / 2 - 65;
  const bucketRight = w / 2 + 65;
  const bucketBottom = h - 40;
  const bucketTop = bucketBottom - 140;
  
  const now = Date.now();
  const elapsed = (now - lastTickTime) / 1000;
  lastTickTime = now;
  
  if (state.algorithm === 'token-bucket' && state.currentRemaining !== null) {
    maxCapacity = state.currentCapacity || 10;
    refillRate = LIMIT_CONFIG['token-bucket'].refillRate;
    
    displayedTokens = Math.min(maxCapacity, displayedTokens + elapsed * refillRate);
    
    if (overlayTokens) overlayTokens.innerText = displayedTokens.toFixed(2);
    if (overlayCapacity) overlayCapacity.innerText = maxCapacity;
    if (overlayRefill) overlayRefill.innerText = refillRate;
    if (statRemaining) statRemaining.innerText = `${Math.floor(displayedTokens)} / ${maxCapacity}`;
  }
  
  syncParticleCounts();

  // 1. Spigot (Top)
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(w / 2 - 10, bucketTop - 30, 20, 14);
  ctx.fillStyle = '#334155';
  ctx.fillRect(w / 2 - 6, bucketTop - 16, 12, 10);
  
  if (state.algorithm === 'token-bucket' && Math.random() < (refillRate * 0.06)) {
    refillDrops.push(new Drop(w / 2, bucketTop - 10, bucketBottom - (130 * (displayedTokens / maxCapacity))));
  }

  for (let i = refillDrops.length - 1; i >= 0; i--) {
    const isFinished = refillDrops[i].update();
    refillDrops[i].draw();
    if (isFinished) {
      refillDrops.splice(i, 1);
    }
  }

  // 2. Beaker Outline
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bucketLeft, bucketTop);
  ctx.lineTo(bucketLeft, bucketBottom);
  ctx.lineTo(w / 2 - 10, bucketBottom);
  ctx.moveTo(w / 2 + 10, bucketBottom);
  ctx.lineTo(bucketRight, bucketBottom);
  ctx.lineTo(bucketRight, bucketTop);
  ctx.stroke();

  // Spout base
  ctx.fillStyle = '#334155';
  ctx.fillRect(w / 2 - 10, bucketBottom, 20, 8);

  // 3. Tokens (particles)
  const fillLevelTop = bucketBottom - (130 * (displayedTokens / maxCapacity));
  particles.forEach(p => {
    p.update(w, h, bucketBottom - 5, fillLevelTop + 8, bucketLeft + 6, bucketRight - 6);
    p.draw();
  });

  // 4. Exhaust sparks
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

function flashBlockedSparks() {
  if (!canvas) return;
  const w = canvas.width;
  const h = canvas.height;
  for (let i = 0; i < 12; i++) {
    bottomSparks.push(new Spark(w / 2, h - 40, '#dc2626'));
  }
}

// ==========================================================================
// TIMELINE LOG SYSTEM (SLIDING WINDOW)
// ==========================================================================
let activeTicks = [];
const WINDOW_DURATION_MS = 10000;

function updateSlidingWindowTimeline() {
  if (state.algorithm !== 'sliding-window') return;

  const now = Date.now();
  const threshold = now - WINDOW_DURATION_MS;

  activeTicks = activeTicks.filter(tick => tick.timestamp > threshold);
  
  const allowedHits = activeTicks.filter(t => t.allowed).length;
  if (timelineHits) timelineHits.innerText = allowedHits;
  
  const limit = LIMIT_CONFIG['sliding-window'].limit;
  if (statRemaining) statRemaining.innerText = `${Math.max(0, limit - allowedHits)} / ${limit}`;

  if (ticksContainer) {
    ticksContainer.innerHTML = '';
    activeTicks.forEach(tick => {
      const elapsed = now - tick.timestamp;
      const percentFromRight = (elapsed / WINDOW_DURATION_MS) * 100;
      
      if (percentFromRight >= 0 && percentFromRight <= 100) {
        const tickEl = document.createElement('div');
        tickEl.className = `timeline-tick ${tick.allowed ? '' : 'blocked'}`;
        tickEl.style.right = `${percentFromRight}%`;
        ticksContainer.appendChild(tickEl);
      }
    });
  }

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
    if (wsStatus) wsStatus.className = 'status-pill online';
    if (wsStatusText) wsStatusText.innerText = 'Connected';
    if (heroStatusText) heroStatusText.innerText = 'Connected';
  };
  
  ws.onclose = () => {
    if (wsStatus) wsStatus.className = 'status-pill offline';
    if (wsStatusText) wsStatusText.innerText = 'Retrying...';
    if (heroStatusText) heroStatusText.innerText = 'Connecting...';
    setTimeout(connectWebSocket, 2000);
  };
  
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'CONFIG_STATE') {
      updateActiveToggles(msg.config.algorithm, msg.config.storage, msg.redis);
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
  state.requests += 1;
  if (event.allowed) {
    state.success += 1;
  } else {
    state.blocked += 1;
  }
  
  state.currentRemaining = event.remaining;
  state.currentCapacity = event.capacity;
  
  if (statRequests) statRequests.innerText = state.requests;
  if (statSuccess) statSuccess.innerText = state.success;
  if (statBlocked) statBlocked.innerText = state.blocked;

  // Update Decision Path Flow Elements
  if (flowIncomingVal) flowIncomingVal.innerText = state.requests;
  if (flowAllowedVal) flowAllowedVal.innerText = state.success;
  if (flowBlockedVal) flowBlockedVal.innerText = state.blocked;
  
  if (summaryDecisionText) {
    summaryDecisionText.innerText = event.allowed ? 'Request accepted' : 'Rate limit exceeded';
    const dot = summaryPolicyDecision ? summaryPolicyDecision.querySelector('.dot') : null;
    if (dot) {
      dot.style.backgroundColor = event.allowed ? 'var(--semantic-success)' : 'var(--semantic-error)';
    }
  }

  // Visual pulse on active node
  if (mainLimiterNodeBox) {
    mainLimiterNodeBox.style.transform = 'scale(1.02)';
    setTimeout(() => {
      mainLimiterNodeBox.style.transform = 'scale(1)';
    }, 120);
  }
  
  if (state.algorithm === 'token-bucket') {
    displayedTokens = event.remaining;
    if (!event.allowed) {
      flashBlockedSparks();
    }
  }

  if (state.algorithm === 'sliding-window') {
    activeTicks.push({
      timestamp: event.timestamp,
      allowed: event.allowed
    });
  }

  // Keep strictly the last 15 records in memory state
  state.logs.unshift(event);
  if (state.logs.length > 15) {
    state.logs.pop();
  }

  appendTableRow(event);
}

// Appends telemetry logs directly in dashboard table (capped at last 15 records)
function appendTableRow(event) {
  if (logEmptyRow) {
    logEmptyRow.style.display = 'none';
  }
  
  const timeStr = new Date(event.timestamp).toLocaleTimeString();
  const badgeClass = event.allowed ? 'success' : 'error';
  const badgeText = event.allowed ? '200 OK' : '429 Blocked';
  const storageClass = (event.storageMode || 'memory').toLowerCase();
  const storageLabel = storageClass === 'redis' ? 'Redis' : 'Memory';
  
  const rowHtml = `
    <td><span class="log-time">${timeStr}</span></td>
    <td><span class="log-val-mono">${event.clientId}</span></td>
    <td><span class="log-storage-tag ${storageClass}">${storageLabel}</span></td>
    <td><span class="log-val-mono">${event.method} ${event.url}</span></td>
    <td><span class="badge badge-${badgeClass}">${badgeText}</span></td>
    <td><span class="log-latency">${event.latencyMs}ms</span></td>
    <td><span class="log-val-mono">${Math.floor(event.remaining)}/${event.capacity}</span></td>
    <td><span class="log-val-mono">${event.allowed ? event.resetTimeSecs + 's (fill)' : event.retryAfter + 's (retry)'}</span></td>
  `;
  
  const tr = document.createElement('tr');
  tr.innerHTML = rowHtml;
  
  if (logBody) {
    logBody.insertBefore(tr, logBody.firstChild);
    while (logBody.children.length > 15) {
      logBody.removeChild(logBody.lastChild);
    }
  }
}

// Update settings switches to reflect active configuration
function updateActiveToggles(algorithm, storage = state.storage, redisInfo = state.redisStatus) {
  state.algorithm = algorithm;
  state.storage = storage;
  if (redisInfo) {
    state.redisStatus = redisInfo;
  }

  const algoButtons = algoToggle ? algoToggle.querySelectorAll('.toggle-btn') : [];
  algoButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === algorithm);
  });

  if (storageToggle) {
    const storageButtons = storageToggle.querySelectorAll('.toggle-btn');
    storageButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === storage);
    });
  }

  if (redisIndicator && state.redisStatus) {
    if (state.redisStatus.isConnected) {
      redisIndicator.className = 'status-pill online';
      redisIndicatorText.innerText = 'Redis Online';
      if (redisBadgeStatus) {
        redisBadgeStatus.className = 'storage-status-tag';
        redisBadgeStatus.innerText = 'Redis Online';
      }
    } else {
      redisIndicator.className = 'status-pill offline';
      redisIndicatorText.innerText = state.redisStatus.status === 'connecting' ? 'Redis Connecting' : 'Redis Offline';
      if (redisBadgeStatus) {
        redisBadgeStatus.className = 'storage-status-tag offline';
        redisBadgeStatus.innerText = 'Redis Offline';
      }
    }
  }

  if (algorithm === 'token-bucket') {
    if (tokenBucketPane) tokenBucketPane.classList.remove('hidden');
    if (slidingWindowPane) slidingWindowPane.classList.add('hidden');
    if (capacitySublabelText) capacitySublabelText.innerText = 'Token bucket balance';
    if (decisionLimiterTitle) decisionLimiterTitle.innerText = 'Token Bucket';
    if (summaryRefillText) summaryRefillText.innerText = '1 token / second';
    
    if (state.currentRemaining === null) {
      maxCapacity = LIMIT_CONFIG['token-bucket'].capacity;
      refillRate = LIMIT_CONFIG['token-bucket'].refillRate;
      displayedTokens = maxCapacity;
      if (overlayTokens) overlayTokens.innerText = maxCapacity.toFixed(2);
      if (overlayCapacity) overlayCapacity.innerText = maxCapacity;
      if (overlayRefill) overlayRefill.innerText = refillRate;
    }
  } else {
    if (tokenBucketPane) tokenBucketPane.classList.add('hidden');
    if (slidingWindowPane) slidingWindowPane.classList.remove('hidden');
    if (capacitySublabelText) capacitySublabelText.innerText = '10s sliding window';
    if (decisionLimiterTitle) decisionLimiterTitle.innerText = 'Sliding Window Log';
    if (summaryRefillText) summaryRefillText.innerText = '10s window (10 limit)';
    requestAnimationFrame(updateSlidingWindowTimeline);
  }

  const algoName = algorithm === 'token-bucket' ? 'Token Bucket' : 'Sliding Window Log';
  const engineName = storage === 'redis' ? 'Redis Cluster' : 'In-Memory';
  if (activeConfigBadge) activeConfigBadge.innerText = `${algoName} · ${engineName}`;
  if (summaryPersistenceText) summaryPersistenceText.innerText = engineName;
  
  if (state.currentRemaining !== null) {
    if (statRemaining) statRemaining.innerText = `${Math.floor(state.currentRemaining)} / ${state.currentCapacity}`;
  } else {
    const config = LIMIT_CONFIG[algorithm];
    const cap = algorithm === 'token-bucket' ? config.capacity : config.limit;
    if (statRemaining) statRemaining.innerText = `${cap} / ${cap}`;
  }

  if (algorithm === 'sliding-window' && timelineLimit) {
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
    if (!res.ok && res.status !== 429) {
      console.error('Request failed:', await res.text());
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

async function postEngineConfig(algorithm = state.algorithm, storage = state.storage) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ algorithm, storage })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || data.error || 'Config update rejected by server.');
    }
  } catch (err) {
    alert('Failed to connect to backend engine: ' + err.message);
  }
}

if (algoToggle) {
  algoToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const val = btn.dataset.value;
    postEngineConfig(val, state.storage);
  });
}

if (storageToggle) {
  storageToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    const val = btn.dataset.value;
    postEngineConfig(state.algorithm, val);
  });
}

if (btnRequest) {
  btnRequest.addEventListener('click', () => {
    sendRequest();
  });
}

if (btnBurst) {
  btnBurst.addEventListener('click', () => {
    for (let i = 0; i < 5; i++) {
      sendRequest();
    }
  });
}

// Stepper controller for Traffic Rate
window.stepTrafficRate = function(delta) {
  if (!generatorSlider) return;
  let current = parseFloat(generatorSlider.value) || 2;
  current = Math.min(10, Math.max(0.5, current + delta));
  generatorSlider.value = current;
  updateRateVisuals(current);
};

function updateRateVisuals(rate) {
  if (generatorRateDisplay) generatorRateDisplay.innerText = `${rate} req/sec`;
  if (stepperRateText) stepperRateText.innerText = `${rate} / sec`;
  if (flowRateVal) flowRateVal.innerText = `${rate}/s`;
  
  if (generatorToggle && generatorToggle.checked) {
    stopTrafficGenerator();
    startTrafficGenerator();
  }
}

if (generatorToggle) {
  generatorToggle.addEventListener('change', (e) => {
    const checked = e.target.checked;
    if (generatorSlider) generatorSlider.disabled = !checked;
    
    if (checked) {
      startTrafficGenerator();
    } else {
      stopTrafficGenerator();
    }
  });
}

if (generatorSlider) {
  generatorSlider.addEventListener('input', () => {
    const rate = generatorSlider.value;
    updateRateVisuals(rate);
  });
}

function startTrafficGenerator() {
  const rate = parseFloat(generatorSlider ? generatorSlider.value : 2);
  const intervalMs = 1000 / rate;
  state.trafficGeneratorId = setInterval(sendRequest, intervalMs);
}

function stopTrafficGenerator() {
  if (state.trafficGeneratorId) {
    clearInterval(state.trafficGeneratorId);
    state.trafficGeneratorId = null;
  }
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', () => {
    clearViewStats();
  });
}

function clearViewStats() {
  state.requests = 0;
  state.success = 0;
  state.blocked = 0;
  state.logs = [];
  
  if (statRequests) statRequests.innerText = '0';
  if (statSuccess) statSuccess.innerText = '0';
  if (statBlocked) statBlocked.innerText = '0';
  if (flowIncomingVal) flowIncomingVal.innerText = '0';
  if (flowAllowedVal) flowAllowedVal.innerText = '0';
  if (flowBlockedVal) flowBlockedVal.innerText = '0';
  
  if (logBody) {
    logBody.innerHTML = '';
    if (logEmptyRow) {
      logEmptyRow.style.display = 'table-row';
      logBody.appendChild(logEmptyRow);
    }
  }
  activeTicks = [];
}

// ==========================================================================
// ADMIN KEYS REPORTING
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
  if (!adminKeysBody) return;
  if (!keys || keys.length === 0) {
    adminKeysBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No keys logged in active engine.</td></tr>`;
    return;
  }

  adminKeysBody.innerHTML = '';
  keys.forEach(k => {
    let stateString = '';
    if (k.type === 'token-bucket') {
      stateString = `<span class="badge">Remaining: ${k.data.tokens}</span> <span class="badge">Updated: ${new Date(k.data.lastRefillTime).toLocaleTimeString()}</span>`;
    } else {
      stateString = `<span class="badge">Hits: ${k.data.count}</span> <span class="badge">Logs: [${k.data.timestamps.map(t => new Date(t).toLocaleTimeString()).join(', ')}]</span>`;
    }
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong style="color:var(--color-primary)">${k.key}</strong></td>
      <td><span class="badge">${k.type}</span></td>
      <td>${stateString}</td>
      <td><button class="btn btn-danger btn-sm" onclick="clearSpecificClient('${k.key}')">Reset</button></td>
    `;
    adminKeysBody.appendChild(tr);
  });
}

window.clearSpecificClient = async function(key) {
  console.log('Resetting client key:', key);
};

function startAdminPolling() {
  fetchAdminKeys();
  state.adminPollIntervalId = setInterval(fetchAdminKeys, 1500);
}

if (btnAdminClear) {
  btnAdminClear.addEventListener('click', async () => {
    const confirmClear = confirm('Are you sure you want to clear rate limiting history for ALL databases?');
    if (!confirmClear) return;

    try {
      const res = await fetch('/api/admin/clear', { method: 'POST' });
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
}

// ==========================================================================
// TELEMETRY LOGS EXPORT MODULE (CSV / JSON)
// ==========================================================================
window.exportSessionData = function() {
  if (state.logs.length === 0) {
    alert('No telemetry session data to export yet. Send some requests first!');
    return;
  }
  if (btnExportCsv) btnExportCsv.click();
};

if (btnExportJson) {
  btnExportJson.addEventListener('click', () => {
    if (state.logs.length === 0) {
      alert('No telemetry data available for export.');
      return;
    }
    const jsonContent = JSON.stringify(state.logs, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    triggerFileDownload(blob, 'rate_limiter_telemetry.json');
  });
}

if (btnExportCsv) {
  btnExportCsv.addEventListener('click', () => {
    if (state.logs.length === 0) {
      alert('No telemetry data available for export.');
      return;
    }

    const headers = ['Timestamp', 'ClientID', 'ClientName', 'Tier', 'Algorithm', 'StorageMode', 'Allowed', 'Remaining', 'Capacity', 'LatencyMs', 'ResetTimeSecs', 'Method', 'Url'];
    const csvRows = [headers.join(',')];

    state.logs.forEach(log => {
      const row = [
        new Date(log.timestamp).toISOString(),
        log.clientId,
        `"${log.clientName || 'Sandbox User'}"`,
        log.clientTier || 'standard',
        log.algorithm,
        log.storageMode,
        log.allowed ? 'TRUE' : 'FALSE',
        (log.remaining || 0).toFixed(2),
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
}

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

// Start background admin polling
startAdminPolling();
