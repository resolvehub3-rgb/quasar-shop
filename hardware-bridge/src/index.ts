#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, configDir, logDir, ensureConfigDir, writePairingCodeFile } from './configuration/config';
import { createLogger } from './logging/logger';
import { PairingManager } from './pairing/pairing';
import { createServer } from './api/server';
import { protectString, unprotectString } from './security/dpapi';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VERSION = '1.0.0';

async function runService() {
  ensureConfigDir();
  const cfg = loadConfig();
  const log = createLogger(logDir());
  log.info('Service starting', { version: VERSION });

  const pairing = new PairingManager(cfg, log);
  await pairing.ensurePairingCode();
  const adminToken = await pairing.ensureAdminToken();

  // persist admin token to a protected file for management utility
  try {
    const adminFile = path.join(configDir(), 'admin-token.protected');
    fs.writeFileSync(adminFile, await protectString(adminToken), 'utf8');
    if (process.platform === 'win32') {
      await execFileAsync('icacls', [adminFile, '/inheritance:r', '/grant:r', 'Administrators:F', '/grant:r', 'SYSTEM:F'], { windowsHide: true }).catch(() => {});
    }
  } catch (e: any) {
    log.warn('Could not write admin token file', { error: e.message });
  }

  // write pairing code file
  const code = await pairing.getPairingCodePlain();
  await writePairingCodeFile(code);

  // wrap save
  const save = (c: typeof cfg) => saveConfig(c);

  const server = createServer({ cfg, save, pairing, log, version: VERSION });
  server.listen(cfg.port, cfg.host, () => {
    log.info('Listening', { host: cfg.host, port: cfg.port });
  });

  const shutdown = () => {
    log.info('Shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (e) => {
    log.error('Uncaught exception', { error: e.message });
  });
}

async function runAdmin() {
  // Read admin token from protected file or config
  const cfg = loadConfig();
  const log = createLogger(logDir());
  let adminToken = '';
  const adminFile = path.join(configDir(), 'admin-token.protected');
  try {
    if (fs.existsSync(adminFile)) {
      adminToken = await unprotectString(fs.readFileSync(adminFile, 'utf8').trim());
    }
  } catch { /* ignore */ }
  if (!adminToken) {
    const pairing = new PairingManager(cfg, log);
    adminToken = await pairing.ensureAdminToken();
  }

  const baseUrl = `http://${cfg.host}:${cfg.port}`;
  async function api(p: string, init: any = {}) {
    const headers = { ...(init.headers || {}), 'X-Admin-Token': adminToken };
    const res = await fetch(baseUrl + p, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const args = process.argv.slice(2);
  const cmd = args[1] || 'status';

  if (cmd === 'status') {
    const { data } = await api('/admin/status');
    console.log(JSON.stringify(data, null, 2));
    const { data: pc } = await api('/admin/pairing-code');
    console.log('Pairing code:', pc.code);
    return;
  }
  if (cmd === 'pairing-code') {
    const { data } = await api('/admin/pairing-code');
    console.log(pcCode(data));
    return;
  }
  if (cmd === 'regenerate') {
    const { data } = await api('/admin/pairing/regenerate', { method: 'POST' });
    console.log('New pairing code:', data.code);
    return;
  }
  if (cmd === 'revoke') {
    await api('/admin/pairing/revoke', { method: 'POST' });
    console.log('Pairing revoked.');
    return;
  }
  if (cmd === 'printers') {
    const { data } = await api('/printers');
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (cmd === 'test-print') {
    const { data } = await api('/diagnostics/test-print', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (cmd === 'test-drawer') {
    const { data } = await api('/diagnostics/test-drawer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (cmd === 'health') {
    const res = await fetch(baseUrl + '/health');
    console.log(JSON.stringify(await res.json(), null, 2));
    return;
  }
  console.log('Usage: bridge admin [status|pairing-code|regenerate|revoke|printers|test-print|test-drawer|health]');
}

function pcCode(data: any): string {
  return data?.code ? String(data.code) : '(no active code)';
}

async function runInstallService() {
  // Not primary; installer script handles. Provide basic using sc.
  console.log('Use installer to register service.');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'admin') {
    await runAdmin();
    return;
  }
  if (args[0] === 'install-service') {
    await runInstallService();
    return;
  }
  if (args[0] === '--version') {
    console.log(VERSION);
    return;
  }
  // default: run service
  await runService();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});