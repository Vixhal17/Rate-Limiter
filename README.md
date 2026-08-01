# 🚀 Enterprise Rate Limiter Sandbox & Telemetry Platform

A high-performance, developer-focused rate-limiting engine implementing dual core algorithms (**Token Bucket** and **Sliding Window Log**) in pure Node.js (ES Modules). The project features a glassmorphic dashboard utilizing an HTML5 Canvas physics visualizer, live WebSocket push telemetry, Prometheus scraper integration, and a CLI benchmarking harness.

---

## 📸 Dashboard Preview

Once launched, access the dark-cyber dashboard served locally at `http://localhost:3000`. 
*   **Token Bucket Canvas**: Features a physical glass beaker showing floating plasma tokens bobbing, droplets refilling from a top faucet, and bubbles releasing from a bottom spout on consumption.
*   **Sliding Window Track**: Shows request ticks sliding from right (now) to left (10 seconds ago) and dissolving as they expire.
*   **Live Metrics**: Counters for total requests, successes, and blocks, alongside a live remaining capacity count.
*   **Active Key Inspector**: Real-time look at current IP buckets, timestamps, and active logs inside the database.

---

## 🛠️ Technology Stack

*   **Runtime Engine**: Node.js (ES Modules)
*   **Web Framework**: Express.js
*   **WebSocket Engine**: `ws` (Custom streaming payload broadcaster)
*   **Monitoring & Telemetry**: `prom-client` (Prometheus exposition format)
*   **Dashboard Frontend**: HTML5, Vanilla CSS3 (Neon-cyber variables & glassmorphic layout), HTML5 Canvas Physics Engine, WebSocket client
*   **Testing & Tooling**: Native Node.js test assert library, HTTP fetch

---

## 📂 Codebase Architecture

```
├── public/                 # Telemetry Dashboard Assets
│   ├── index.html          # Structure & control panel wrappers
│   ├── styles.css          # Neon-dark design system & keyframe animations
│   └── app.js              # WebSockets client, physics engine & canvas renderer
├── src/                    # Backend Source Files
│   ├── algorithms/         # Rate Limiting Logic
│   │   ├── TokenBucketLimiter.js     # Lazy-refill token algorithm
│   │   └── SlidingWindowLogLimiter.js # Timestamp log sliding algorithm
│   ├── middleware/         # Express Request Filters
│   │   └── limiter.js      # Middleware router, metrics recorder & WS logger
│   ├── storage/            # Memory Storage Engine
│   │   ├── StorageProvider.js  # Abstract storage interface contract
│   │   └── MemoryStorage.js    # Thread-safe JS Map storage provider
│   ├── benchmark.js        # CLI performance concurrency benchmark
│   ├── server.js           # Server bootstrap, route mappings & WS hub
│   └── verify.js           # E2E API integration validation test runner
├── package.json            # Scripts & project dependencies
└── README.md               # Documentation
```

---

## ⚙️ Core Configuration & Defaults

Rate limits are applied per client using their incoming **IP Address** (`req.ip` fallback).

| Property | Token Bucket Algorithm | Sliding Window Log Algorithm |
| :--- | :--- | :--- |
| **Capacity / Limit** | `10` tokens maximum | `10` requests maximum |
| **Refill / Window** | `1` token refilled per second | `10,000 ms` (10 seconds) sliding window |
| **Visual Behavior** | Smooth, continuous float refilling | Discrete tick-log expiration |
| **Throttling Model** | Soft throttling (ignores blocked attempts) | Soft throttling (prunes un-logged blocks) |

---

## 📡 API Specifications

### 1. Execute Rate Limit Check
*   **Endpoint**: `GET /api/request`
*   **Access**: Public (Identified by client IP)
*   **Response Headers**:
    *   `X-RateLimit-Limit`: Maximum capacity (`10`).
    *   `X-RateLimit-Remaining`: Count of remaining requests allowed.
    *   `X-RateLimit-Reset`: Time in seconds until the bucket is completely filled/cleared.
    *   `Retry-After`: (On HTTP 429) Wait time in seconds before retrying.
*   **Response (200 OK)**:
    ```json
    {
      "success": true,
      "message": "API request completed successfully!",
      "timestamp": 1722521000000,
      "client": { "id": "::1" }
    }
    ```
*   **Response (429 Too Many Requests)**:
    ```json
    {
      "error": "Too Many Requests",
      "message": "Rate limit exceeded. Please retry in 1s.",
      "retryAfter": 1,
      "resetTimeSecs": 10
    }
    ```

### 2. Sandbox Configuration
*   **Endpoint**: `GET /api/config` / `POST /api/config`
*   **Payload**: `{ "algorithm": "token-bucket" | "sliding-window" }`
*   **Access**: Public (Triggers realtime WebSocket layout changes on the dashboard).

### 3. Retrieve Active Tracker Keys
*   **Endpoint**: `GET /api/admin/keys`
*   **Access**: Public
*   **Response**: Lists active clients and their database bucket stats.

### 4. Clear Database
*   **Endpoint**: `POST /api/admin/clear`
*   **Access**: Public (Flushes active keys, alerts clients to reset stats).

### 5. Prometheus Scraper Metrics
*   **Endpoint**: `GET /metrics`
*   **Metrics Exposed**:
    *   `rate_limiter_requests_total{status, algorithm}`: Total requests.
    *   `rate_limiter_latency_seconds`: Validation latency summary.
    *   Standard Node.js process and memory telemetry.

---

## ⚡ Setup & Execution

### 1. Install Dependencies
Ensure you have Node.js (version 18+) installed. Clone or navigate to the directory and run:
```bash
npm install
```

### 2. Start the Telemetry Server
Launches the Express server and WebSocket socket hub:
```bash
npm start
```
*   **Console Output**: Logs bootstrap information and opens port `3000`.
*   **Dashboard URL**: Open `http://localhost:3000` in your web browser.

### 3. Run Automated Validation Checks
Executes E2E assertions against the active server (verifies the 10-call threshold, headers, and endpoints):
```bash
node src/verify.js
```

### 4. Run Concurrency Benchmarks
Fires high-speed local rate-limiter validations (10,000 ops in concurrent batches) and displays latency percentiles and throughput:
```bash
npm run benchmark
```
*   **Expected Throughput**: ~`500,000` to `600,000` operations/second on modern standard processors.

---

## 📊 Telemetry Exporter
From the dashboard, every API call's latency, payload status, and HTTP headers are logged in a live-stream table. You can export this telemetry data instantly by clicking:
1.  **Export CSV**: Generates a standard `.csv` file format.
2.  **Export JSON**: Generates a structured `.json` object array of logs.
