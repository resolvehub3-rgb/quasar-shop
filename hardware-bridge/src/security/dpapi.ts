import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function protectString(plain: string): Promise<string> {
  if (process.platform !== 'win32') {
    return Buffer.from(plain, 'utf8').toString('base64');
  }
  const ps = `
Add-Type -AssemblyName System.Security
$bytes = [System.Text.Encoding]::UTF8.GetBytes('${escape(plain)}')
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
[Convert]::ToBase64String($protected)
`.trim();
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
  return stdout.trim();
}

export async function unprotectString(protectedB64: string): Promise<string> {
  if (process.platform !== 'win32') {
    return Buffer.from(protectedB64, 'base64').toString('utf8');
  }
  const ps = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${protectedB64}')
$unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'LocalMachine')
[System.Text.Encoding]::UTF8.GetString($unprotected)
`.trim();
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
  return stdout.trim();
}

function escape(s: string): string {
  return s.replace(/'/g, "''");
}

export function randomToken(bytes = 32): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto');
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomPairingCode(): string {
  const crypto = require('node:crypto');
  // 8 chars, unambiguous
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const buf = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const crypto = require('node:crypto');
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}