const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../dist/api/server');
const { defaultConfig } = require('../dist/configuration/config');

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeDeps(overrides = {}) {
  const cfg = { ...defaultConfig(), simulate: true, paired: true, ...overrides };
  const pairing = {
    validateToken: async (t) => t === 'good-token',
    validateAdminToken: async (t) => t === 'admin-token',
    status: () => ({ paired: true, pairingAvailable: false, expiresAt: null, attemptsRemaining: 0, lockedUntil: null }),
    getPairingCodePlain: async () => null,
    ensurePairingCode: async () => {},
    initiate: async () => ({ ok: false, error: 'Already paired' }),
  };
  return { cfg, deps: { cfg, save: () => {}, pairing, log, version: '1.0.0-test' } };
}

async function withServer(overrides, fn) {
  const { deps } = makeDeps(overrides);
  const server = createServer(deps);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`, deps);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('api: health endpoint works without token', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/health');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.paired, true);
  });
});

test('api: unknown operation returns 404', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/nope');
    assert.equal(res.status, 404);
  });
});

test('api: print rejects missing token', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/print', { method: 'POST', body: '{}' });
    assert.equal(res.status, 401);
  });
});

test('api: print accepts valid token and reports simulated result', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/print', {
      method: 'POST',
      headers: { 'X-Bridge-Token': 'good-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receiptNumber: 'R1', clientTxRef: 'TX1', date: new Date().toISOString(), cashierName: 'A',
        items: [{ product_name: 'x', quantity: 1, unit_price: 1, line_total: 1 }],
        subtotal: 1, total: 1, payments: [{ method: 'cash', amount: 1 }], changeGiven: 0,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.simulated, true);
  });
});

test('api: print idempotency does not reprint', async () => {
  await withServer({}, async (base) => {
    const body = JSON.stringify({
      idempotencyKey: 'op-1',
      receiptNumber: 'R1', clientTxRef: 'TX1', date: new Date().toISOString(), cashierName: 'A',
      items: [], subtotal: 0, total: 0, payments: [], changeGiven: 0,
    });
    const h = { 'X-Bridge-Token': 'good-token', 'Content-Type': 'application/json' };
    const r1 = await fetch(base + '/print', { method: 'POST', headers: h, body });
    const r2 = await fetch(base + '/print', { method: 'POST', headers: h, body });
    const d1 = await r1.json();
    const d2 = await r2.json();
    assert.equal(d1.duplicate, undefined);
    assert.equal(d2.duplicate, true);
  });
});

test('api: drawer kick idempotency prevents duplicate kicks', async () => {
  await withServer({}, async (base) => {
    const h = { 'X-Bridge-Token': 'good-token', 'Content-Type': 'application/json' };
    const body = JSON.stringify({ operationId: 'kick-1' });
    const r1 = await fetch(base + '/drawer/kick', { method: 'POST', headers: h, body });
    const r2 = await fetch(base + '/drawer/kick', { method: 'POST', headers: h, body });
    const d1 = await r1.json();
    const d2 = await r2.json();
    assert.equal(d1.ok, true);
    assert.equal(d2.duplicate, true);
  });
});

test('api: disallowed origin rejected', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });
});

test('api: allowed origin gets CORS header', async () => {
  await withServer({}, async (base, deps) => {
    const origin = deps.cfg.allowedOrigins[0];
    const res = await fetch(base + '/health', { headers: { Origin: origin } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
  });
});

test('api: admin endpoints require admin token', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/admin/status');
    assert.equal(res.status, 401);
    const res2 = await fetch(base + '/admin/status', { headers: { 'X-Admin-Token': 'admin-token' } });
    assert.equal(res2.status, 200);
  });
});

test('api: pairing status requires no token', async () => {
  await withServer({}, async (base) => {
    const res = await fetch(base + '/pairing/status');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.paired, true);
  });
});