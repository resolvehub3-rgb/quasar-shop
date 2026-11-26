import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// localStorage is a browser global; provide a minimal in-memory stand-in so the
// config store can be exercised under Node's test runner.
const __store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => void __store.set(k, v),
  removeItem: (k: string) => void __store.delete(k),
  clear: () => __store.clear(),
};
import {
  checkBridgeHealth,
  printReceipt,
  kickDrawer,
  getPairingStatus,
  pairWithBridge,
  clearBridgeConfig,
  loadBridgeConfig,
  saveBridgeConfig,
} from './hardwareBridge';

function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test('bridge config round-trips through localStorage-safe store', () => {
  clearBridgeConfig();
  assert.equal(loadBridgeConfig(), null);
  saveBridgeConfig({ baseUrl: 'http://127.0.0.1:8765/', token: 'abc' });
  const cfg = loadBridgeConfig();
  assert.equal(cfg?.baseUrl, 'http://127.0.0.1:8765'); // trailing slash stripped
  assert.equal(cfg?.token, 'abc');
  clearBridgeConfig();
  assert.equal(loadBridgeConfig(), null);
});

test('checkBridgeHealth reports unreachable bridge without throwing', async () => {
  const h = await checkBridgeHealth({ baseUrl: 'http://127.0.0.1:1', token: 'x' });
  assert.equal(h.ok, false);
  assert.ok(h.message);
});

test('printReceipt failure returns ok:false instead of throwing (sale is never reversed)', async () => {
  const r = await printReceipt(
    { baseUrl: 'http://127.0.0.1:1', token: 'x' },
    {
      shopName: 'S', receiptNumber: 'R', clientTxRef: 'T', date: new Date().toISOString(),
      cashierName: 'C', paperWidth: '80mm', items: [], subtotal: 0, discount: 0, total: 0,
      payments: [], changeGiven: 0,
    },
    'print:T'
  );
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('kickDrawer failure returns ok:false instead of throwing', async () => {
  const r = await kickDrawer({ baseUrl: 'http://127.0.0.1:1', token: 'x' }, 'drawer:T');
  assert.equal(r.ok, false);
});

test('checkBridgeHealth parses a healthy bridge response', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: '1.0.0', printerConfigured: true, printerConnected: false, drawerSupported: true }));
  });
  try {
    const h = await checkBridgeHealth({ baseUrl: srv.url, token: 'x' });
    assert.equal(h.ok, true);
    assert.equal(h.version, '1.0.0');
    assert.equal(h.printerConfigured, true);
    assert.equal(h.printerConnected, false); // honestly reports not verified
    assert.equal(h.drawerSupported, true);
  } finally {
    await srv.close();
  }
});

test('printReceipt surfaces duplicate flag from idempotent bridge', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, duplicate: true }));
  });
  try {
    const r = await printReceipt(
      { baseUrl: srv.url, token: 'x' },
      {
        shopName: 'S', receiptNumber: 'R', clientTxRef: 'T', date: new Date().toISOString(),
        cashierName: 'C', paperWidth: '80mm', items: [], subtotal: 0, discount: 0, total: 0,
        payments: [], changeGiven: 0,
      },
      'print:T'
    );
    assert.equal(r.ok, true);
    assert.equal(r.duplicate, true);
  } finally {
    await srv.close();
  }
});

test('pairing status is readable without a token', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ paired: false, pairingAvailable: true, expiresAt: 1, attemptsRemaining: 5, lockedUntil: null }));
  });
  try {
    const st = await getPairingStatus(srv.url);
    assert.equal(st?.paired, false);
    assert.equal(st?.pairingAvailable, true);
    assert.equal(st?.attemptsRemaining, 5);
  } finally {
    await srv.close();
  }
});

test('pairWithBridge returns the token on success and error on failure', async () => {
  let mode: 'ok' | 'bad' = 'ok';
  const srv = await startServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      if (mode === 'bad') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid pairing code.' }));
        return;
      }
      if (parsed.code === 'GOODCODE1') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token: 'a'.repeat(64) }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid pairing code.' }));
      }
    });
  });
  try {
    const good = await pairWithBridge(srv.url, 'GOODCODE1');
    assert.equal(good.ok, true);
    assert.equal(good.token?.length, 64);
    const bad = await pairWithBridge(srv.url, 'WRONG');
    assert.equal(bad.ok, false);
    mode = 'bad';
    const err = await pairWithBridge(srv.url, 'GOODCODE1');
    assert.equal(err.ok, false);
    assert.equal(err.error, 'Invalid pairing code.');
  } finally {
    await srv.close();
  }
});