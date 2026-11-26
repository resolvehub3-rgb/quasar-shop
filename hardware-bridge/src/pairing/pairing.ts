import { BridgePersistedConfig, saveConfig, writePairingCodeFile } from '../configuration/config';
import { randomPairingCode, randomToken, timingSafeEqual, protectString, unprotectString } from '../security/dpapi';
import { createLogger } from '../logging/logger';

export interface PairingStatus {
  paired: boolean;
  pairingAvailable: boolean;
  expiresAt: number | null;
  attemptsRemaining: number;
  lockedUntil: number | null;
}

export class PairingManager {
  constructor(private cfg: BridgePersistedConfig, private log: ReturnType<typeof createLogger>) {}

  getConfig(): BridgePersistedConfig { return this.cfg; }

  async ensurePairingCode(): Promise<void> {
    if (this.cfg.paired) return;
    if (this.cfg.pairingCodeProtected && this.cfg.pairingCodeExpiresAt && this.cfg.pairingCodeExpiresAt > Date.now()) {
      return;
    }
    const code = randomPairingCode();
    this.cfg.pairingCodeProtected = await protectString(code);
    this.cfg.pairingCodeExpiresAt = Date.now() + 10 * 60 * 1000;
    this.cfg.pairingAttempts = 0;
    this.cfg.pairingLockedUntil = undefined;
    saveConfig(this.cfg);
    writePairingCodeFile(code);
    this.log.info('New pairing code generated', { expiresAt: this.cfg.pairingCodeExpiresAt });
  }

  async getPairingCodePlain(): Promise<string | null> {
    if (this.cfg.paired) return null;
    if (!this.cfg.pairingCodeProtected) return null;
    if (this.cfg.pairingCodeExpiresAt && this.cfg.pairingCodeExpiresAt < Date.now()) return null;
    try {
      return await unprotectString(this.cfg.pairingCodeProtected);
    } catch {
      return null;
    }
  }

  status(): PairingStatus {
    const locked = this.cfg.pairingLockedUntil && this.cfg.pairingLockedUntil > Date.now() ? this.cfg.pairingLockedUntil : null;
    const attempts = this.cfg.pairingAttempts || 0;
    const available = !this.cfg.paired && !!this.cfg.pairingCodeProtected &&
      (!this.cfg.pairingCodeExpiresAt || this.cfg.pairingCodeExpiresAt > Date.now()) &&
      !locked;
    return {
      paired: this.cfg.paired,
      pairingAvailable: available,
      expiresAt: this.cfg.pairingCodeExpiresAt || null,
      attemptsRemaining: Math.max(0, 5 - attempts),
      lockedUntil: locked,
    };
  }

  async initiate(code: string): Promise<{ ok: boolean; token?: string; error?: string }> {
    if (this.cfg.paired) {
      return { ok: false, error: 'Already paired. Revoke first.' };
    }
    const now = Date.now();
    if (this.cfg.pairingLockedUntil && this.cfg.pairingLockedUntil > now) {
      return { ok: false, error: 'Too many failed attempts. Locked.' };
    }
    if (!this.cfg.pairingCodeProtected || !this.cfg.pairingCodeExpiresAt || this.cfg.pairingCodeExpiresAt < now) {
      return { ok: false, error: 'Pairing code expired or unavailable.' };
    }
    let plain: string;
    try {
      plain = await unprotectString(this.cfg.pairingCodeProtected);
    } catch {
      return { ok: false, error: 'Pairing code unavailable.' };
    }
    const attempts = this.cfg.pairingAttempts || 0;
    if (attempts >= 5) {
      this.cfg.pairingLockedUntil = now + 15 * 60 * 1000;
      saveConfig(this.cfg);
      return { ok: false, error: 'Too many failed attempts. Locked.' };
    }
    if (!timingSafeEqual(plain, code.trim().toUpperCase())) {
      const nextAttempts = attempts + 1;
      this.cfg.pairingAttempts = nextAttempts;
      if (nextAttempts >= 5) {
        this.cfg.pairingLockedUntil = now + 15 * 60 * 1000;
      }
      saveConfig(this.cfg);
      this.log.warn('Failed pairing attempt');
      return { ok: false, error: nextAttempts >= 5 ? 'Too many failed attempts. Locked.' : 'Invalid pairing code.' };
    }
    // success
    const token = randomToken(32);
    this.cfg.pairedTokenProtected = await protectString(token);
    this.cfg.paired = true;
    this.cfg.pairingCodeProtected = undefined;
    this.cfg.pairingCodeExpiresAt = undefined;
    this.cfg.pairingAttempts = 0;
    this.cfg.pairingLockedUntil = undefined;
    saveConfig(this.cfg);
    writePairingCodeFile(null);
    this.log.info('Pairing completed successfully');
    return { ok: true, token };
  }

  async revoke(): Promise<void> {
    this.cfg.paired = false;
    this.cfg.pairedTokenProtected = undefined;
    await this.ensurePairingCode();
    saveConfig(this.cfg);
    this.log.info('Pairing revoked');
  }

  async getPairedToken(): Promise<string | null> {
    if (!this.cfg.paired || !this.cfg.pairedTokenProtected) return null;
    try {
      return await unprotectString(this.cfg.pairedTokenProtected);
    } catch {
      return null;
    }
  }

  async validateToken(token: string): Promise<boolean> {
    const real = await this.getPairedToken();
    if (!real) return false;
    return timingSafeEqual(real, token);
  }

  async ensureAdminToken(): Promise<string> {
    if (this.cfg.adminTokenProtected) {
      try { return await unprotectString(this.cfg.adminTokenProtected); } catch { /* regenerate */ }
    }
    const t = randomToken(32);
    this.cfg.adminTokenProtected = await protectString(t);
    saveConfig(this.cfg);
    return t;
  }

  async validateAdminToken(token: string): Promise<boolean> {
    if (!this.cfg.adminTokenProtected) return false;
    try {
      const real = await unprotectString(this.cfg.adminTokenProtected);
      return timingSafeEqual(real, token);
    } catch {
      return false;
    }
  }
}