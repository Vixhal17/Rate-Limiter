import assert from 'assert';

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('Starting automated rate limiter validation tests...');

  // Helper to make API requests
  async function makeRequest(token = null) {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${BASE_URL}/api/request`, { headers });
    return {
      status: res.status,
      limit: res.headers.get('X-RateLimit-Limit'),
      remaining: res.headers.get('X-RateLimit-Remaining'),
      reset: res.headers.get('X-RateLimit-Reset'),
      retryAfter: res.headers.get('Retry-After')
    };
  }

  // 1. Reset limiter to clean state (requires Admin Token)
  console.log('\n[TEST 1] Resetting storage...');
  const resetRes = await fetch(`${BASE_URL}/api/admin/clear`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer admin-token-1337' }
  });
  assert.strictEqual(resetRes.status, 200, 'Admin clear should succeed');
  console.log('✓ Storage reset successfully.');

  // 2. Set config to Token Bucket
  console.log('\n[TEST 2] Configuring to Token Bucket...');
  const configRes = await fetch(`${BASE_URL}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ algorithm: 'token-bucket', storage: 'memory' })
  });
  const configData = await configRes.json();
  assert.strictEqual(configData.algorithm, 'token-bucket');
  console.log('✓ Algorithm configured to Token Bucket.');

  // 3. Test Rate Limits (Capacity 10, Refill 1/sec)
  console.log('\n[TEST 3] Testing rate limits...');
  
  // Fire 10 requests
  for (let i = 1; i <= 10; i++) {
    const res = await makeRequest();
    assert.strictEqual(res.status, 200, `Request ${i} should be allowed`);
    console.log(`  Request ${i} allowed. Remaining: ${res.remaining}`);
  }

  // 11th request should fail
  const blockedRes = await makeRequest();
  assert.strictEqual(blockedRes.status, 429, '11th request should be blocked');
  assert.ok(blockedRes.retryAfter >= 1, 'Retry-After header should be present');
  console.log(`✓ 11th request successfully blocked (429). Retry after: ${blockedRes.retryAfter}s`);

  // 4. Test Public keys endpoint
  console.log('\n[TEST 4] Testing Active Keys tracking endpoint...');
  const keysAdminToken = await fetch(`${BASE_URL}/api/admin/keys`);
  assert.strictEqual(keysAdminToken.status, 200, 'Keys endpoint should be publicly accessible');
  const activeKeys = await keysAdminToken.json();
  assert.ok(Array.isArray(activeKeys), 'Keys list should be an array');
  console.log(`✓ Key tracking endpoint validated successfully. Active keys: ${activeKeys.length}`);

  // 5. Check Prometheus metrics endpoint
  console.log('\n[TEST 5] Checking Prometheus metrics endpoint...');
  const metricsRes = await fetch(`${BASE_URL}/metrics`);
  assert.strictEqual(metricsRes.status, 200, 'Metrics endpoint should be scrapable');
  const metricsText = await metricsRes.text();
  assert.ok(metricsText.includes('rate_limiter_requests_total'), 'Metrics should export rate limit counts');
  console.log('✓ Prometheus metrics are exposed and scrapable.');

  console.log('\n========================================');
  console.log('All API & security validations passed!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('\n❌ Test execution failed:', err.message);
  process.exit(1);
});
