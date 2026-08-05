import { MemoryStorage } from './storage/MemoryStorage.js';
import { RedisStorage } from './storage/RedisStorage.js';
import { TokenBucketLimiter } from './algorithms/TokenBucketLimiter.js';

// Configuration for the benchmark runs
const TOTAL_OPERATIONS = 5000;
const CONCURRENT_BATCH_SIZE = 50; // Simulate multiple clients firing requests in batches
const TEST_KEY = 'benchmark-client-key';
const TIER_CONFIG = { capacity: 100000, refillRate: 5000 }; // High limits so we don't hit 429 locks

async function runBenchmark(name, storage, limiter) {
  console.log(`\n========================================`);
  console.log(`Starting Benchmark: ${name}`);
  console.log(`Executing ${TOTAL_OPERATIONS} rate limiting checks...`);
  console.log(`========================================`);

  const latencies = [];
  const startTime = process.hrtime();

  // Execute operations in batches
  for (let i = 0; i < TOTAL_OPERATIONS; i += CONCURRENT_BATCH_SIZE) {
    const batchPromises = [];
    
    for (let j = 0; j < CONCURRENT_BATCH_SIZE && (i + j) < TOTAL_OPERATIONS; j++) {
      const opStart = process.hrtime();
      
      const p = limiter.consume(TEST_KEY, TIER_CONFIG).then(() => {
        const diff = process.hrtime(opStart);
        const latencyMs = (diff[0] * 1e3) + (diff[1] / 1e6);
        latencies.push(latencyMs);
      });
      
      batchPromises.push(p);
    }
    
    await Promise.all(batchPromises);
  }

  const totalDiff = process.hrtime(startTime);
  const totalTimeMs = (totalDiff[0] * 1e3) + (totalDiff[1] / 1e6);
  const totalTimeSecs = totalTimeMs / 1000;
  
  // Sort latencies to compute percentiles
  latencies.sort((a, b) => a - b);
  
  const sum = latencies.reduce((acc, val) => acc + val, 0);
  const avg = sum / latencies.length;
  
  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p90 = latencies[Math.floor(latencies.length * 0.90)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  
  const throughput = TOTAL_OPERATIONS / totalTimeSecs;

  console.log(`Completed in:        ${totalTimeSecs.toFixed(3)} seconds`);
  console.log(`Throughput:          ${throughput.toFixed(2)} ops/sec`);
  console.log(`Average Latency:     ${avg.toFixed(4)} ms`);
  console.log(`Percentiles:`);
  console.log(`  - p50 (median):    ${p50.toFixed(4)} ms`);
  console.log(`  - p90:             ${p90.toFixed(4)} ms`);
  console.log(`  - p95:             ${p95.toFixed(4)} ms`);
  console.log(`  - p99:             ${p99.toFixed(4)} ms`);
}

async function startSuite() {
  // 1. Setup Memory Storage Benchmark
  const memStorage = new MemoryStorage();
  const memLimiter = new TokenBucketLimiter(memStorage);
  await runBenchmark('Local In-Memory Engine', memStorage, memLimiter);

  // 2. Setup Redis Storage Benchmark (if Redis is accessible)
  try {
    const redisStorage = new RedisStorage();
    // Wait briefly for connection
    await new Promise((resolve) => setTimeout(resolve, 500));
    const status = redisStorage.getStatus();

    if (status.isConnected) {
      const redisLimiter = new TokenBucketLimiter(redisStorage);
      await runBenchmark('Distributed Redis Engine', redisStorage, redisLimiter);
      await redisStorage.clearAll();
      await redisStorage.disconnect();
    } else {
      console.log(`\n[NOTE] Redis server not connected at ${status.redisUrl}. Skipping Redis benchmark.`);
      console.log('To run Redis benchmark, start Redis: docker run -d -p 6379:6379 redis:alpine');
      await redisStorage.disconnect();
    }
  } catch (err) {
    console.log(`\n[NOTE] Redis benchmark skipped: ${err.message}`);
  }
  
  console.log(`\n========================================`);
  console.log('Benchmark Suite Finished.');
  console.log(`========================================`);
}

startSuite().catch(console.error);

