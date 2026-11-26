/* eslint-disable */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BRIDGE_DIR = __dirname;
const CONFIG_PATH = path.join(BRIDGE_DIR, 'bridge.config.json');

function loadConfig() {
  let cfg = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to read bridge config:', e.message);
  }

  const envOrigins = (process.env.BRIDGE_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cfgOrigins = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];
  const allowedOrigins = (envOrigins.length ? envOrigins : cfgOrigins).concat([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  const token = process.env.BRIDGE_TOKEN || cfg.token || crypto.randomBytes(24).toString('hex');
  if (!cfg.token && !process.env.BRIDGE_TOKEN) {
    cfg.token = token;
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...cfg, token }, null, 2));
    } catch (e) {
      console.error('Could not persist generated token:', e.message);
    }
  }

  return {
    port: Number(process.env.BRIDGE_PORT || cfg.port || 8787),
    host: process.env.BRIDGE_HOST || cfg.host || '127.0.0.1',
    token,
    printerDevicePath: process.env.PRINTER_DEVICE_PATH || cfg.printerDevicePath || '',
    printerName: process.env.PRINTER_NAME || cfg.printerName || '',
    simulate: process.env.BRIDGE_SIMULATE === '1' || cfg.simulate === true,
    allowedOrigins,
    paperWidth: process.env.PAPER_WIDTH || cfg.paperWidth || '80mm',
  };
}

const cfg = loadConfig();

console.log('====================================================');
console.log('QusarShop Hardware Bridge');
console.log('====================================================');
console.log('Listening on:  http://' + cfg.host + ':' + cfg.port);
console.log('Pairing token:  ' + cfg.token);
console.log('Allowed origins:', cfg.allowedOrigins.join(', '));
console.log('Printer device path:', cfg.printerDevicePath || '(none)');
console.log('Printer name:', cfg.printerName || '(none)');
console.log('Simulation mode:', cfg.simulate ? 'ON (labelled)' : 'OFF');
console.log('Config file:', CONFIG_PATH);
console.log('====================================================');

function isOriginAllowed(origin) {
  if (!origin) return true; // same-origin / non-browser clients
  return cfg.allowedOrigins.some((o) => origin === o || origin.startsWith(o));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function checkAuth(req, res) {
  const token = req.headers['x-bridge-token'];
  if (token !== cfg.token) {
    sendJson(res, 401, { ok: false, error: 'Invalid or missing bridge token.' });
    return false;
  }
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
    return false;
  }
  return true;
}

// ---------- ESC/POS helpers ----------
function escposInit() {
  return Buffer.from([0x1b, 0x40]);
}
function escposAlign(n) {
  return Buffer.from([0x1b, 0x61, n]); // 0 left, 1 center, 2 right
}
function escposBold(on) {
  return Buffer.from([0x1b, 0x45, on ? 1 : 0]);
}
function escposText(s) {
  return Buffer.from(String(s || ''), 'utf8');
}
function escposNewline() {
  return Buffer.from([0x0a]);
}
function escposCut() {
  return Buffer.from([0x1d, 0x56, 0x00]);
}
function escposDrawerKick() {
  // ESC p 0 25 250 (pin 2)
  return Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
}

function buildReceipt(payload) {
  const width = payload.paperWidth === '58mm' ? 32 : 48;
  const line = (ch) => ch.repeat(width);
  const chunks = [];
  const push = (b) => chunks.push(b);

  push(escposInit());
  push(escposAlign(1));
  push(escposBold(true));
  push(escposText('QUSAR VENTURES'));
  push(escposNewline());
  push(escposText(payload.shopName || 'Shop'));
  push(escposNewline());
  push(escposBold(false));
  if (payload.shopAddress) { push(escposText(payload.shopAddress)); push(escposNewline()); }
  if (payload.shopPhone) { push(escposText('Tel: ' + payload.shopPhone)); push(escposNewline()); }
  if (payload.receiptHeader) { push(escposText(payload.receiptHeader)); push(escposNewline()); }
  push(escposText(line('-')));
  push(escposNewline());

  push(escposAlign(0));
  push(escposText('Receipt #: ' + payload.receiptNumber));
  push(escposNewline());
  push(escposText('Ref: ' + payload.clientTxRef));
  push(escposNewline());
  push(escposText('Date: ' + new Date(payload.date).toLocaleString()));
  push(escposNewline());
  push(escposText('Cashier: ' + payload.cashierName));
  push(escposNewline());
  push(escposText(line('-')));
  push(escposNewline());

  for (const item of payload.items || []) {
    push(escposText(item.product_name));
    push(escposNewline());
    const qty = String(item.quantity);
    const price = Number(item.unit_price).toFixed(2);
    const total = Number(item.line_total).toFixed(2);
    const detail = `  ${qty} x ${price} = ${total}`;
    push(escposText(detail));
    push(escposNewline());
  }
  push(escposText(line('-')));
  push(escposNewline());

  push(escposAlign(2));
  push(escposText('Subtotal: ' + Number(payload.subtotal).toFixed(2)));
  push(escposNewline());
  if (Number(payload.discount) > 0) {
    push(escposText('Discount: -' + Number(payload.discount).toFixed(2)));
    push(escposNewline());
  }
  push(escposBold(true));
  push(escposText('TOTAL: ' + Number(payload.total).toFixed(2)));
  push(escposNewline());
  push(escposBold(false));

  push(escposAlign(0));
  for (const p of payload.payments || []) {
    push(escposText(String(p.method).toUpperCase() + (p.network ? ' (' + p.network + ')' : '') + ': ' + Number(p.amount).toFixed(2)));
    push(escposNewline());
  }
  if (Number(payload.changeGiven) > 0) {
    push(escposText('Change Given: ' + Number(payload.changeGiven).toFixed(2)));
    push(escposNewline());
  }
  push(escposText(line('-')));
  push(escposNewline());

  push(escposAlign(1));
  if (payload.receiptFooter) { push(escposText(payload.receiptFooter)); push(escposNewline()); }
  push(escposText('Thank you!'));
  push(escposNewline());
  push(escposNewline());
  push(escposCut());

  return Buffer.concat(chunks);
}

function writeToDevice(buffer) {
  return new Promise((resolve) => {
    if (cfg.simulate) {
      // Labelled simulation: explicitly reported as simulated, not real.
      return resolve({ ok: true, simulated: true, message: 'Simulation mode: no physical write performed.' });
    }
    if (cfg.printerDevicePath) {
      try {
        fs.writeFileSync(cfg.printerDevicePath, buffer);
        return resolve({ ok: true });
      } catch (e) {
        return resolve({ ok: false, error: e.message });
      }
    }
    if (cfg.printerName && process.platform === 'win32') {
      // Write bytes to temp file then use PowerShell to send raw to printer.
      const tmp = path.join(BRIDGE_DIR, 'print-job.bin');
      try {
        fs.writeFileSync(tmp, buffer);
      } catch (e) {
        return resolve({ ok: false, error: e.message });
      }
      const ps = `Get-Content -Path '${tmp}' -Encoding Byte -Raw | Out-Printer -Name '${cfg.printerName}'`;
      execFile('powershell.exe', ['-NoProfile', '-Command', ps], (err) => {
        if (err) return resolve({ ok: false, error: err.message });
        resolve({ ok: true });
      });
      return;
    }
    resolve({ ok: false, error: 'No printer configured. Set printerDevicePath or printerName in bridge.config.json.' });
  });
}

function handleHealth(req, res) {
  const printerConfigured = Boolean(cfg.printerDevicePath || cfg.printerName || cfg.simulate);
  let printerConnected = false;
  if (cfg.simulate) printerConnected = true;
  if (cfg.printerDevicePath) {
    try {
      fs.accessSync(cfg.printerDevicePath, fs.constants.W_OK);
      printerConnected = true;
    } catch {
      printerConnected = false;
    }
  }
  sendJson(res, 200, {
    ok: true,
    version: '1.0.0',
    printerConfigured,
    printerConnected,
    drawerSupported: printerConfigured,
    message: cfg.simulate ? 'Simulation mode enabled (labelled).' : undefined,
  });
}

async function handlePrint(req, res) {
  if (!checkAuth(req, res)) return;
  let body;
  try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: 'Invalid JSON' }); }
  const buf = buildReceipt(body);
  const result = await writeToDevice(buf);
  sendJson(res, result.ok ? 200 : 502, result);
}

async function handleDrawerKick(req, res) {
  if (!checkAuth(req, res)) return;
  try { await readBody(req); } catch (e) {}
  const buf = Buffer.concat([escposInit(), escposDrawerKick()]);
  const result = await writeToDevice(buf);
  sendJson(res, result.ok ? 200 : 502, result);
}

async function handleTestPrint(req, res) {
  if (!checkAuth(req, res)) return;
  try { await readBody(req); } catch (e) {}
  const testPayload = {
    shopName: 'QusarShop Test',
    shopAddress: 'Hardware bridge test print',
    receiptNumber: 'TEST-' + Date.now(),
    clientTxRef: 'BRIDGE-TEST',
    date: new Date().toISOString(),
    cashierName: 'Bridge',
    paperWidth: cfg.paperWidth,
    items: [{ product_name: 'Test Item', unit_name: 'pcs', quantity: 1, unit_price: 1.0, line_total: 1.0 }],
    subtotal: 1.0,
    discount: 0,
    total: 1.0,
    payments: [{ method: 'cash', amount: 1.0 }],
    changeGiven: 0,
    receiptHeader: 'Printer diagnostics',
    receiptFooter: 'End of test',
  };
  const buf = buildReceipt(testPayload);
  const result = await writeToDevice(buf);
  sendJson(res, result.ok ? 200 : 502, result);
}

async function handleTestDrawer(req, res) {
  if (!checkAuth(req, res)) return;
  try { await readBody(req); } catch (e) {}
  const buf = Buffer.concat([escposInit(), escposDrawerKick()]);
  const result = await writeToDevice(buf);
  sendJson(res, result.ok ? 200 : 502, result);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Bridge-Token',
    });
    return res.end();
  }

  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/health') return handleHealth(req, res);
    if (req.method === 'POST' && url === '/print') return await handlePrint(req, res);
    if (req.method === 'POST' && url === '/drawer/kick') return await handleDrawerKick(req, res);
    if (req.method === 'POST' && url === '/diagnostics/test-print') return await handleTestPrint(req, res);
    if (req.method === 'POST' && url === '/diagnostics/test-drawer') return await handleTestDrawer(req, res);
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
});

server.listen(cfg.port, cfg.host, () => {
  // already logged
});
