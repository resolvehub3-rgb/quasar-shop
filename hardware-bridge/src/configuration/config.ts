import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface BridgePersistedConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  printerName: string;
  printerDevicePath: string;
  paperWidth: '58mm' | '80mm';
  simulate: boolean;
  // pairing state
  paired: boolean;
  pairedTokenProtected?: string; // DPAPI-protected base64
  pairingCodeProtected?: string; // DPAPI-protected base64
  pairingCodeExpiresAt?: number;
  pairingAttempts?: number;
  pairingLockedUntil?: number;
  adminTokenProtected?: string;
  // idempotency store (recent)
  recentOps?: Array<{ id: string; ts: number; result: unknown }>;
  version: string;
}

export const DEFAULT_PORT = 8765;
export const DEFAULT_HOST = '127.0.0.1';

export function configDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'QusarShop', 'HardwareBridge');
  }
  return path.join(os.homedir(), '.qusarshop-hardware-bridge');
}

export function configPath(): string { return path.join(configDir(), 'config.json'); }
export function secretsPath(): string { return path.join(configDir(), 'secrets.json'); }
export function logDir(): string { return path.join(configDir(), 'logs'); }
export function pairingCodePath(): string { return path.join(configDir(), 'pairing-code.txt'); }

export function defaultConfig(): BridgePersistedConfig {
  const origins = [
    'https://qusarshop.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  return {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    allowedOrigins: origins,
    printerName: '',
    printerDevicePath: '',
    paperWidth: '80mm',
    simulate: false,
    paired: false,
    recentOps: [],
    version: '1.0.0',
  };
}

export function loadConfig(): BridgePersistedConfig {
  const dir = configDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const p = configPath();
  if (!fs.existsSync(p)) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(cfg: BridgePersistedConfig): void {
  const dir = configDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    // Never let a configuration write failure take the service down; the
    // in-memory configuration stays valid for this session.
  }
}

export function ensureConfigDir(): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(logDir(), { recursive: true });
}

/**
 * Persist the current one-time pairing code for the management utility.
 * The file is ACL'd to Administrators + SYSTEM and deleted once a pairing
 * exists (or when no code is active).
 */
export function writePairingCodeFile(code: string | null): void {
  if (process.platform !== 'win32') return;
  const p = pairingCodePath();
  try {
    if (code) {
      fs.mkdirSync(configDir(), { recursive: true });
      fs.writeFileSync(
        p,
        `QusarShop Hardware Bridge pairing code: ${code}\n` +
          `Valid for 10 minutes, single use. Enter it in QusarShop > Owner > POS Hardware.\n`,
        'utf8'
      );
      const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
      try {
        execFileSync('icacls', [p, '/inheritance:r', '/grant:r', 'Administrators:F', '/grant:r', 'SYSTEM:F'], { windowsHide: true, stdio: 'ignore' });
      } catch { /* best effort */ }
    } else {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}