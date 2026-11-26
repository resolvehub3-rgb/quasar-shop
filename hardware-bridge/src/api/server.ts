import http from 'node:http';
import { URL } from 'node:url';
import { BridgePersistedConfig, saveConfig } from '../configuration/config';
import { PairingManager } from '../pairing/pairing';
import { createLogger } from '../logging/logger';
import { isOriginAllowed, corsHeaders } from '../security/origin';
import { rateLimit, clientKey } from '../security/rateLimit';
import { enumeratePrinters, isPrinterOnline, writeToPrinter } from '../printers/windowsPrinter';
import { buildReceipt, buildDrawerKick, buildTestReceipt } from '../printers/escpos';
import { timingSafeEqual } from '../security/dpapi';

export interface ApiDeps {
  cfg: BridgePersistedConfig;
  save: (c: BridgePersistedConfig) => void;
  pairing: PairingManager;
  log: ReturnType<typeof createLogger>;
  version: string;
}

const MAX_BODY = 1024 * 1024; // 1MB

function sendJson(res: http.ServerResponse, status: number, obj: unknown, extraHeaders: Record<string, string> = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function getHeader(req: http.IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function requireBridgeToken(req: http.IncomingMessage, pairing: PairingManager): Promise<boolean> {
  const token = getHeader(req, 'x-bridge-token');
  if (!token) return Promise.resolve(false);
  return pairing.validateToken(token);
}

function requireAdminToken(req: http.IncomingMessage, pairing: PairingManager): Promise<boolean> {
  const token = getHeader(req, 'x-admin-token');
  if (!token) return Promise.resolve(false);
  return pairing.validateAdminToken(token);
}

function requestOrigin(req: http.IncomingMessage): string | undefined {
  return getHeader(req, 'origin');
}

export function createServer(deps: ApiDeps): http.Server {
  const { cfg, pairing, log, version } = deps;

  const server = http.createServer(async (req, res) => {
    const origin = requestOrigin(req);
    const allowed = cfg.allowedOrigins;
    const cors = corsHeaders(origin, allowed);

    // Preflight
    if (req.method === 'OPTIONS') {
      if (origin && !isOriginAllowed(origin, allowed)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed' });
        return;
      }
      res.writeHead(204, cors);
      res.end();
      return;
    }

    // Origin check for browser requests
    if (origin && !isOriginAllowed(origin, allowed)) {
      sendJson(res, 403, { ok: false, error: 'Origin not allowed' }, cors);
      return;
    }

    // Rate limit
    const key = clientKey(req as any);
    if (!rateLimit(key, 120, 60 * 1000)) {
      sendJson(res, 429, { ok: false, error: 'Rate limit exceeded' }, cors);
      return;
    }

    const urlObj = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

    const rid = getHeader(req, 'x-request-id') || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      // Health (no auth)
      if (req.method === 'GET' && pathname === '/health') {
        const printers = await enumeratePrinters();
        const selected = cfg.printerName ? printers.find((p) => p.name === cfg.printerName) : undefined;
        const printerConfigured = Boolean(cfg.printerName || cfg.printerDevicePath || cfg.simulate);
        const printerConnected = cfg.simulate ? true : (selected ? isPrinterOnline(selected) : false);
        sendJson(res, 200, {
          ok: true,
          version,
          paired: cfg.paired,
          printerConfigured,
          printerConnected,
          printerName: cfg.printerName || null,
          drawerSupported: printerConfigured,
          simulated: cfg.simulate,
          message: cfg.simulate ? 'Simulation mode enabled (labelled).' : undefined,
        }, cors);
        log.debug('health', { rid });
        return;
      }

      // Pairing status (no auth)
      if (req.method === 'GET' && pathname === '/pairing/status') {
        sendJson(res, 200, { ok: true, ...pairing.status() }, cors);
        return;
      }

      // Pairing initiate (no auth, code required)
      if (req.method === 'POST' && pathname === '/pairing/initiate') {
        const body = await readBody(req);
        const code = String(body?.code || '');
        if (!code) {
          sendJson(res, 400, { ok: false, error: 'Pairing code required' }, cors);
          return;
        }
        const result = await pairing.initiate(code);
        if (result.ok) {
          log.info('Pairing initiated via API');
        } else {
          log.warn('Pairing initiate failed', { error: result.error });
        }
        sendJson(res, result.ok ? 200 : 400, result, cors);
        return;
      }

      // Printers list
      if (req.method === 'GET' && pathname === '/printers') {
        // allow bridge token OR admin token
        const bridgeOk = await requireBridgeToken(req, pairing);
        const adminOk = !bridgeOk && await requireAdminToken(req, pairing);
        if (!bridgeOk && !adminOk) {
          sendJson(res, 401, { ok: false, error: 'Invalid or missing token' }, cors);
          return;
        }
        const printers = await enumeratePrinters();
        sendJson(res, 200, {
          ok: true,
          printers: printers.map((p) => ({ name: p.name, driverName: p.driverName, portName: p.portName, online: isPrinterOnline(p), status: p.printerStatus })),
        }, cors);
        return;
      }

      // Select printer (admin)
      if (req.method === 'POST' && pathname === '/admin/printer/select') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        const body = await readBody(req);
        const name = String(body?.printerName || '');
        cfg.printerName = name;
        cfg.printerDevicePath = body?.printerDevicePath ? String(body.printerDevicePath) : cfg.printerDevicePath;
        if (body?.paperWidth) cfg.paperWidth = body.paperWidth === '58mm' ? '58mm' : '80mm';
        if (typeof body?.simulate === 'boolean') cfg.simulate = body.simulate;
        deps.save(cfg);
        log.info('Printer selected', { printerName: name });
        sendJson(res, 200, { ok: true }, cors);
        return;
      }

      // Admin status
      if (req.method === 'GET' && pathname === '/admin/status') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        sendJson(res, 200, {
          ok: true,
          version,
          paired: cfg.paired,
          printerName: cfg.printerName || null,
          paperWidth: cfg.paperWidth,
          simulate: cfg.simulate,
          port: cfg.port,
          host: cfg.host,
          allowedOrigins: cfg.allowedOrigins,
        }, cors);
        return;
      }

      // Admin pairing code
      if (req.method === 'GET' && pathname === '/admin/pairing-code') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        const code = await pairing.getPairingCodePlain();
        await pairing.ensurePairingCode();
        const code2 = code || await pairing.getPairingCodePlain();
        sendJson(res, 200, { ok: true, code: code2, status: pairing.status() }, cors);
        return;
      }

      // Admin regenerate pairing
      if (req.method === 'POST' && pathname === '/admin/pairing/regenerate') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        if (cfg.paired) {
          await pairing.revoke();
        }
        await pairing.ensurePairingCode();
        const code = await pairing.getPairingCodePlain();
        log.info('Pairing code regenerated');
        sendJson(res, 200, { ok: true, code, status: pairing.status() }, cors);
        return;
      }

      // Admin revoke pairing
      if (req.method === 'POST' && pathname === '/admin/pairing/revoke') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        await pairing.revoke();
        await pairing.ensurePairingCode();
        sendJson(res, 200, { ok: true }, cors);
        return;
      }

      // Print receipt
      if (req.method === 'POST' && pathname === '/print') {
        if (!await requireBridgeToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Invalid or missing bridge token' }, cors);
          return;
        }
        const body = await readBody(req);
        // idempotency
        const key = body?.idempotencyKey ? String(body.idempotencyKey) : null;
        if (key) {
          const found = (cfg.recentOps || []).find((o) => o.id === key);
          if (found) {
            sendJson(res, 200, { ok: true, duplicate: true, result: found.result }, cors);
            return;
          }
        }
        const buf = buildReceipt(body);
        const result = await writeToPrinter(cfg, buf);
        if (key) {
          cfg.recentOps = [{ id: key, ts: Date.now(), result }, ...(cfg.recentOps || [])].slice(0, 50);
          deps.save(cfg);
        }
        log.info('Print job', { ok: result.ok, simulated: (result as any).simulated });
        sendJson(res, result.ok ? 200 : 502, result, cors);
        return;
      }

      // Drawer kick
      if (req.method === 'POST' && pathname === '/drawer/kick') {
        if (!await requireBridgeToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Invalid or missing bridge token' }, cors);
          return;
        }
        const body = await readBody(req).catch(() => ({}));
        const key = body?.operationId ? String(body.operationId) : (body?.idempotencyKey ? String(body.idempotencyKey) : null);
        if (key) {
          const found = (cfg.recentOps || []).find((o) => o.id === key);
          if (found) {
            sendJson(res, 200, { ok: true, duplicate: true }, cors);
            return;
          }
        }
        const buf = buildDrawerKick();
        const result = await writeToPrinter(cfg, buf);
        if (key) {
          cfg.recentOps = [{ id: key, ts: Date.now(), result: { drawer: true } }, ...(cfg.recentOps || [])].slice(0, 50);
          deps.save(cfg);
        }
        log.info('Drawer kick', { ok: result.ok });
        sendJson(res, result.ok ? 200 : 502, result, cors);
        return;
      }

      // Diagnostics test print
      if (req.method === 'POST' && pathname === '/diagnostics/test-print') {
        // allow bridge or admin token
        const bridgeOk = await requireBridgeToken(req, pairing);
        const adminOk = !bridgeOk && await requireAdminToken(req, pairing);
        if (!bridgeOk && !adminOk) {
          sendJson(res, 401, { ok: false, error: 'Invalid or missing token' }, cors);
          return;
        }
        const buf = buildTestReceipt(cfg.paperWidth);
        const result = await writeToPrinter(cfg, buf);
        log.info('Test print', { ok: result.ok });
        sendJson(res, result.ok ? 200 : 502, result, cors);
        return;
      }

      // Diagnostics test drawer
      if (req.method === 'POST' && pathname === '/diagnostics/test-drawer') {
        const bridgeOk = await requireBridgeToken(req, pairing);
        const adminOk = !bridgeOk && await requireAdminToken(req, pairing);
        if (!bridgeOk && !adminOk) {
          sendJson(res, 401, { ok: false, error: 'Invalid or missing token' }, cors);
          return;
        }
        const buf = buildDrawerKick();
        const result = await writeToPrinter(cfg, buf);
        log.info('Test drawer', { ok: result.ok });
        sendJson(res, result.ok ? 200 : 502, result, cors);
        return;
      }

      // Config get (admin)
      if (req.method === 'GET' && pathname === '/admin/config') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        sendJson(res, 200, { ok: true, config: { ...cfg, pairedTokenProtected: undefined, pairingCodeProtected: undefined, adminTokenProtected: undefined, recentOps: undefined } }, cors);
        return;
      }

      // Update config (admin) - allowed origins etc
      if (req.method === 'POST' && pathname === '/admin/config') {
        if (!await requireAdminToken(req, pairing)) {
          sendJson(res, 401, { ok: false, error: 'Admin token required' }, cors);
          return;
        }
        const body = await readBody(req);
        if (Array.isArray(body?.allowedOrigins)) cfg.allowedOrigins = body.allowedOrigins.map(String);
        if (body?.paperWidth) cfg.paperWidth = body.paperWidth === '58mm' ? '58mm' : '80mm';
        if (typeof body?.simulate === 'boolean') cfg.simulate = body.simulate;
        if (typeof body?.port === 'number') cfg.port = body.port;
        deps.save(cfg);
        sendJson(res, 200, { ok: true }, cors);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' }, cors);
    } catch (e: any) {
      log.error('Request error', { rid, error: e?.message || String(e), path: pathname });
      sendJson(res, 500, { ok: false, error: e?.message || 'Internal error', requestId: rid }, cors);
    }
  });

  return server;
}