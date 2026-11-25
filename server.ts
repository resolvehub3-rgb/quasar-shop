import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const PORT = 3000;
const SESSION_SECRET = process.env.CASHIER_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

function getAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function computeCodeFingerprint(pin: string): string {
  return crypto.createHmac('sha256', SESSION_SECRET).update(pin).digest('hex');
}

function hashPin(pin: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPin(pin: string, salt: string, storedHash: string): boolean {
  const derived = crypto.scryptSync(pin, salt, 64);
  const stored = Buffer.from(storedHash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

// Simple in-memory IP rate limiter for sensitive auth endpoints
const loginAttemptsByIp = new Map<string, { count: number; resetAt: number }>();
function checkIpRateLimit(ip: string, limit = 20, windowMs = 15 * 60 * 1000): boolean {
  const now = Date.now();
  const rec = loginAttemptsByIp.get(ip);
  if (!rec || rec.resetAt < now) {
    loginAttemptsByIp.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count += 1;
  return true;
}

async function dispatchSasuSyncSms(
  admin: SupabaseClient,
  params: {
    eventType: 'shift_open' | 'shift_close' | 'expense_submitted' | 'scheduled_report' | 'manual_test';
    recipientPhone: string;
    messageBody: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }
): Promise<{ delivered: boolean; status: string; error?: string }> {
  const rawEndpoint = process.env.SASUSYNC_API_ENDPOINT || '';
  const endpoint = rawEndpoint.replace(/\/+$/, '').endsWith('/api/v1/send')
    ? rawEndpoint.replace(/\/+$/, '')
    : `${rawEndpoint.replace(/\/+$/, '')}/api/v1/send`;
  const apiKey = process.env.SASUSYNC_API_KEY;
  const senderId = process.env.SASUSYNC_SENDER_ID || 'ShopPOS';

  // Normalize local Ghana numbers (0XXXXXXXXX) to international format (233XXXXXXXXX).
  const rawPhone = String(params.recipientPhone || '').trim().replace(/^\+/, '');
  const recipientPhone = rawPhone.startsWith('0') ? `233${rawPhone.slice(1)}` : rawPhone;

  if (!params.recipientPhone) {
    return { delivered: false, status: 'skipped_no_recipient' };
  }

  if (!endpoint || !apiKey) {
    await admin.from('sms_logs').insert({
      event_type: params.eventType,
      recipient_phone: recipientPhone,
      message_body: params.messageBody,
      provider: 'sasusync',
      status: 'blocked_missing_config',
      error_message: 'SASUSYNC_API_ENDPOINT and SASUSYNC_API_KEY are not configured.',
      related_entity_type: params.relatedEntityType || null,
      related_entity_id: params.relatedEntityId || null,
    });
    return {
      delivered: false,
      status: 'blocked_missing_config',
      error: 'SasuSync API endpoint or key not configured on server.',
    };
  }

  try {
    let resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-API-Key': apiKey,
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({
        sender: senderId,
        recipients: [recipientPhone],
        message: params.messageBody,
      }),
    });

    if (resp.status === 405) {
      const getUrl = new URL(endpoint);
      getUrl.searchParams.set('to', params.recipientPhone);
      getUrl.searchParams.set('sender', senderId);
      getUrl.searchParams.set('message', params.messageBody);
      getUrl.searchParams.set('apikey', apiKey);
      resp = await fetch(getUrl.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    }

    const data = await resp.json().catch(() => ({}));
    const ok = resp.ok && data?.success === true;

    await admin.from('sms_logs').insert({
      event_type: params.eventType,
      recipient_phone: params.recipientPhone,
      message_body: params.messageBody,
      provider: 'sasusync',
      provider_reference: data?.reference || data?.id || null,
      status: ok ? 'sent' : 'failed',
      error_message: ok
        ? `provider_response: ${JSON.stringify(data).slice(0, 500)}`
        : data?.message || data?.error || `HTTP ${resp.status}`,
      related_entity_type: params.relatedEntityType || null,
      related_entity_id: params.relatedEntityId || null,
    });

    return { delivered: ok, status: ok ? 'sent' : 'failed', error: ok ? undefined : data?.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'SMS request failed';
    await admin.from('sms_logs').insert({
      event_type: params.eventType,
      recipient_phone: params.recipientPhone,
      message_body: params.messageBody,
      provider: 'sasusync',
      status: 'failed',
      error_message: msg,
      related_entity_type: params.relatedEntityType || null,
      related_entity_id: params.relatedEntityId || null,
    });
    return { delivered: false, status: 'failed', error: msg };
  }
}

interface AuthedOwnerRequest extends Request {
  ownerUser?: { id: string; email: string; full_name: string };
}

interface AuthedCashierRequest extends Request {
  cashier?: { id: string; full_name: string; phone: string; status: string };
  cashierSessionId?: string;
}

async function requireOwner(req: AuthedOwnerRequest, res: Response, next: NextFunction) {
  const admin = getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: 'Supabase server credentials are not configured.' });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Owner authentication token required.' });
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired owner session.' });
  }

  const { data: ownerProfile } = await admin
    .from('owner_profiles')
    .select('id, email, full_name')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!ownerProfile) {
    return res.status(403).json({ error: 'Access denied: user is not registered as the shop owner.' });
  }

  req.ownerUser = ownerProfile;
  next();
}

async function requireCashier(req: AuthedCashierRequest, res: Response, next: NextFunction) {
  const admin = getAdminClient();
  if (!admin) {
    return res.status(503).json({ error: 'Supabase server credentials are not configured.' });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Cashier session token required.' });
  }

  const tokenHash = hashToken(token);
  const { data: session } = await admin
    .from('cashier_sessions')
    .select('id, cashier_id, expires_at, revoked_at, cashiers(id, full_name, phone, status)')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!session || session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    return res.status(401).json({ error: 'Cashier session expired or revoked.' });
  }

  const cashierRecord = Array.isArray(session.cashiers) ? session.cashiers[0] : session.cashiers;
  if (!cashierRecord || cashierRecord.status !== 'active') {
    return res.status(403).json({ error: 'Cashier account is suspended or revoked.' });
  }

  req.cashier = cashierRecord;
  req.cashierSessionId = session.id;
  next();
}

function createApp() {
  const app = express();
  app.set('trust proxy', true);

  // Raw body for Moolre webhook signature verification BEFORE express.json()
  app.post(
    '/api/payments/moolre/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const admin = getAdminClient();
      if (!admin) return res.status(503).json({ error: 'Supabase unconfigured' });

      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
      const webhookSecret = process.env.MOOLRE_WEBHOOK_SECRET || '';
      const signature = req.header('X-Moolre-Signature') || '';

      let signatureValid = false;
      if (webhookSecret && signature) {
        const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
        const sigBuf = Buffer.from(signature.trim().toLowerCase());
        const expBuf = Buffer.from(expected.toLowerCase());
        if (sigBuf.length === expBuf.length) {
          signatureValid = crypto.timingSafeEqual(sigBuf, expBuf);
        }
      }

      let payload: Record<string, any>;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      const eventId = payload.event_id || `${payload.event || 'moolre'}-${payload?.data?.externalref || Date.now()}`;
      const externalRef = payload?.data?.externalref || null;

      const { error: eventErr } = await admin.from('payment_webhook_events').insert({
        event_id: eventId,
        provider: 'moolre',
        event_type: payload.event || String(payload.code || 'unknown'),
        payment_reference: externalRef,
        raw_payload: payload,
        signature_valid: signatureValid,
        processed: false,
      });

      if (eventErr && eventErr.code === '23505') {
        return res.status(200).json({ ok: true, duplicate: true });
      }

      if (!signatureValid) {
        return res.status(401).json({ error: 'Invalid X-Moolre-Signature' });
      }

      const txStatus = payload?.data?.txstatus ?? payload?.status;
      const newStatus = txStatus === 1 || payload?.event === 'payment.succeeded' ? 'successful' : 'failed';

      const { error: rpcErr } = await admin.rpc('fn_confirm_moolre_payment', {
        p_payment_reference: externalRef,
        p_provider_tx_id: payload?.data?.transactionid ? String(payload.data.transactionid) : null,
        p_new_status: newStatus,
        p_failure_reason: newStatus === 'failed' ? payload?.data?.reason || payload?.message || 'Payment failed' : null,
      });

      await admin
        .from('payment_webhook_events')
        .update({ processed: !rpcErr, processing_error: rpcErr ? rpcErr.message : null })
        .eq('event_id', eventId);

      return res.status(rpcErr ? 500 : 200).json({ ok: !rpcErr });
    }
  );

  app.use(express.json({ limit: '10mb' }));

  // Health & integration readiness (exposes NO secrets)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      supabaseClientConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY),
      supabaseServerConfigured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
      moolreConfigured: Boolean(
        process.env.MOOLRE_API_USER && process.env.MOOLRE_API_PUBKEY && process.env.MOOLRE_ACCOUNT_NUMBER
      ),
      sasusyncConfigured: Boolean(process.env.SASUSYNC_API_ENDPOINT && process.env.SASUSYNC_API_KEY),
    });
  });

  // First-run single-shop Owner Bootstrap (locks permanently once owner_profiles has a row)
  app.post('/api/owner/bootstrap', async (req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase server credentials are not configured.' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return res.status(401).json({ error: 'Invalid token' });

    const { data: existingOwners } = await admin.from('owner_profiles').select('id').limit(1);
    if (existingOwners && existingOwners.length > 0) {
      const isSame = existingOwners[0].id === userData.user.id;
      return res.status(isSame ? 200 : 403).json({
        alreadyClaimed: true,
        isOwner: isSame,
        error: isSame ? undefined : 'Shop ownership has already been claimed by the authorized owner.',
      });
    }

    const { fullName, shopName, phone } = req.body || {};
    const ownerName = String(fullName || userData.user.user_metadata?.full_name || userData.user.email || 'Shop Owner').trim();

    const { error: ownerErr } = await admin.from('owner_profiles').insert({
      id: userData.user.id,
      full_name: ownerName,
      email: userData.user.email,
      phone: phone ? String(phone).trim() : null,
    });
    if (ownerErr) return res.status(400).json({ error: ownerErr.message });

    await admin.from('shop_settings').insert({
      owner_user_id: userData.user.id,
      shop_name: String(shopName || 'Provision Shop').trim(),
      phone: phone ? String(phone).trim() : null,
    });

    await admin.from('sms_configurations').insert({
      owner_phone: phone ? String(phone).trim() : '',
      scheduled_destination_phone: phone ? String(phone).trim() : '',
    });

    return res.status(201).json({ ok: true, isOwner: true });
  });

  // Public status used by the auth screen to hide first-run setup once claimed
  app.get('/api/owner/bootstrap/status', async (_req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase server credentials are not configured.' });
    const { data } = await admin.from('owner_profiles').select('id').limit(1);
    return res.json({ claimed: (data || []).length > 0 });
  });

  // ==========================================================================
  // OWNER-ONLY ENDPOINTS
  // ==========================================================================

  app.post('/api/owner/cashiers', requireOwner, async (req: AuthedOwnerRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { fullName, phone } = req.body || {};
    if (!fullName || !phone) {
      return res.status(400).json({ error: 'Full name and telephone number are required.' });
    }

    // Generate unique 6-digit access code
    let pin = '';
    let fingerprint = '';
    for (let attempt = 0; attempt < 15; attempt++) {
      const candidate = String(crypto.randomInt(100000, 1000000));
      const fp = computeCodeFingerprint(candidate);
      const { data: dup } = await admin.from('cashiers').select('id').eq('code_fingerprint', fp).maybeSingle();
      if (!dup) {
        pin = candidate;
        fingerprint = fp;
        break;
      }
    }
    if (!pin) return res.status(500).json({ error: 'Unable to generate unique 6-digit access code.' });

    const { salt, hash } = hashPin(pin);
    const { data: created, error } = await admin
      .from('cashiers')
      .insert({
        full_name: String(fullName).trim(),
        phone: String(phone).trim(),
        access_code_hash: hash,
        code_salt: salt,
        code_fingerprint: fingerprint,
        status: 'active',
        created_by: req.ownerUser!.id,
      })
      .select('id, full_name, phone, status, created_at')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    await admin.from('audit_logs').insert({
      actor_type: 'owner',
      actor_id: req.ownerUser!.id,
      actor_name: req.ownerUser!.full_name,
      action: 'CASHIER_CREATED',
      entity_type: 'cashiers',
      entity_id: created.id,
      details: { full_name: created.full_name, phone: created.phone },
    });

    // Return generated 6-digit code ONCE so owner can share it with the cashier
    return res.status(201).json({ cashier: created, generatedAccessCode: pin });
  });

  app.patch('/api/owner/cashiers/:id', requireOwner, async (req: AuthedOwnerRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { id } = req.params;
    const { action, fullName, phone } = req.body || {};

    if (action === 'reset_code') {
      let pin = '';
      let fingerprint = '';
      for (let attempt = 0; attempt < 15; attempt++) {
        const candidate = String(crypto.randomInt(100000, 1000000));
        const fp = computeCodeFingerprint(candidate);
        const { data: dup } = await admin.from('cashiers').select('id').eq('code_fingerprint', fp).maybeSingle();
        if (!dup) {
          pin = candidate;
          fingerprint = fp;
          break;
        }
      }
      if (!pin) return res.status(500).json({ error: 'Unable to allocate unique 6-digit code.' });

      const { salt, hash } = hashPin(pin);
      const { error } = await admin
        .from('cashiers')
        .update({
          access_code_hash: hash,
          code_salt: salt,
          code_fingerprint: fingerprint,
          failed_attempts: 0,
          locked_until: null,
          status: 'active',
        })
        .eq('id', id);

      if (error) return res.status(400).json({ error: error.message });

      // Revoke active sessions on code reset
      await admin.from('cashier_sessions').update({ revoked_at: new Date().toISOString() }).eq('cashier_id', id).is('revoked_at', null);

      await admin.from('audit_logs').insert({
        actor_type: 'owner',
        actor_id: req.ownerUser!.id,
        actor_name: req.ownerUser!.full_name,
        action: 'CASHIER_CODE_RESET',
        entity_type: 'cashiers',
        entity_id: id,
      });

      return res.json({ ok: true, generatedAccessCode: pin });
    }

    if (action === 'suspend' || action === 'revoke' || action === 'activate') {
      const nextStatus = action === 'suspend' ? 'suspended' : action === 'revoke' ? 'revoked' : 'active';
      const { error } = await admin.from('cashiers').update({ status: nextStatus }).eq('id', id);
      if (error) return res.status(400).json({ error: error.message });

      if (nextStatus !== 'active') {
        await admin.from('cashier_sessions').update({ revoked_at: new Date().toISOString() }).eq('cashier_id', id).is('revoked_at', null);
      }

      await admin.from('audit_logs').insert({
        actor_type: 'owner',
        actor_id: req.ownerUser!.id,
        actor_name: req.ownerUser!.full_name,
        action: `CASHIER_${nextStatus.toUpperCase()}`,
        entity_type: 'cashiers',
        entity_id: id,
      });

      return res.json({ ok: true, status: nextStatus });
    }

    const updates: Record<string, string> = {};
    if (fullName) updates.full_name = String(fullName).trim();
    if (phone) updates.phone = String(phone).trim();
    const { error } = await admin.from('cashiers').update(updates).eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ok: true });
  });

  app.get('/api/owner/signed-url', requireOwner, async (req: AuthedOwnerRequest, res: Response) => {
    const admin = getAdminClient()!;
    const bucket = String(req.query.bucket || 'expense-evidence');
    const objectPath = String(req.query.path || '');
    if (!['expense-evidence', 'product-images'].includes(bucket) || !objectPath) {
      return res.status(400).json({ error: 'Invalid bucket or object path' });
    }
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(objectPath, 300);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ signedUrl: data.signedUrl });
  });

  app.post('/api/sms/send', requireOwner, async (req: AuthedOwnerRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { recipientPhone, messageBody } = req.body || {};
    if (!recipientPhone || !messageBody) {
      return res.status(400).json({ error: 'Recipient phone and message body are required.' });
    }
    const result = await dispatchSasuSyncSms(admin, {
      eventType: 'manual_test',
      recipientPhone: String(recipientPhone).trim(),
      messageBody: String(messageBody).trim(),
    });
    return res.status(result.delivered ? 200 : 503).json(result);
  });

  // ==========================================================================
  // CASHIER AUTHENTICATION & POS ENDPOINTS
  // ==========================================================================

  app.post('/api/cashier/login', async (req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase server credentials are not configured.' });

    const ip = req.ip || 'unknown';
    if (!checkIpRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes and try again.' });
    }

    const pin = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({ error: 'Please enter a valid 6-digit cashier access code.' });
    }

    const fp = computeCodeFingerprint(pin);
    const { data: cashier } = await admin
      .from('cashiers')
      .select('id, full_name, phone, access_code_hash, code_salt, status, failed_attempts, locked_until')
      .eq('code_fingerprint', fp)
      .maybeSingle();

    if (!cashier) {
      return res.status(401).json({ error: 'Invalid 6-digit access code.' });
    }

    if (cashier.status !== 'active') {
      return res.status(403).json({ error: `This cashier account is ${cashier.status}. Contact the shop owner.` });
    }

    if (cashier.locked_until && new Date(cashier.locked_until).getTime() > Date.now()) {
      return res.status(429).json({ error: 'Account temporarily locked due to failed attempts. Try again later.' });
    }

    const ok = verifyPin(pin, cashier.code_salt, cashier.access_code_hash);
    if (!ok) {
      const attempts = (cashier.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await admin.from('cashiers').update({ failed_attempts: attempts, locked_until: lockedUntil }).eq('id', cashier.id);
      return res.status(401).json({ error: 'Invalid 6-digit access code.' });
    }

    await admin
      .from('cashiers')
      .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
      .eq('id', cashier.id);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString();
    await admin.from('cashier_sessions').insert({
      cashier_id: cashier.id,
      token_hash: hashToken(rawToken),
      expires_at: expiresAt,
      ip_address: ip,
      user_agent: req.headers['user-agent'] || null,
    });

    const { data: openShift } = await admin
      .from('cashier_shifts')
      .select('*')
      .eq('cashier_id', cashier.id)
      .eq('status', 'open')
      .maybeSingle();

    return res.json({
      token: rawToken,
      expiresAt,
      cashier: { id: cashier.id, full_name: cashier.full_name, phone: cashier.phone },
      activeShift: openShift || null,
    });
  });

  app.post('/api/cashier/logout', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    await admin.from('cashier_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', req.cashierSessionId!);
    return res.json({ ok: true });
  });

  app.get('/api/cashier/me', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { data: openShift } = await admin
      .from('cashier_shifts')
      .select('*')
      .eq('cashier_id', req.cashier!.id)
      .eq('status', 'open')
      .maybeSingle();

    const { data: shop } = await admin
      .from('shop_settings')
      .select('shop_name, tagline, phone, address, currency, receipt_header, receipt_footer, thermal_paper_width, max_cashier_discount_pct, moolre_enabled, moolre_supported_networks')
      .limit(1)
      .maybeSingle();

    return res.json({ cashier: req.cashier, activeShift: openShift || null, shopSettings: shop || null });
  });

  app.post('/api/cashier/shift/open', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const openingCash = Number(req.body?.openingCash);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      return res.status(400).json({ error: 'Valid non-negative opening cash amount is required.' });
    }

    const { data: shift, error } = await admin.rpc('fn_open_cashier_shift', {
      p_cashier_id: req.cashier!.id,
      p_opening_cash: openingCash,
    });

    if (error) return res.status(400).json({ error: error.message });

    // Trigger SasuSync SMS to owner if enabled
    const { data: smsCfg } = await admin.from('sms_configurations').select('*').limit(1).maybeSingle();
    const { data: shop } = await admin.from('shop_settings').select('shop_name').limit(1).maybeSingle();
    let smsResult: { delivered: boolean; status: string; error?: string } | null = null;
    if (smsCfg?.notify_shift_open && smsCfg.owner_phone) {
      smsResult = await dispatchSasuSyncSms(admin, {
        eventType: 'shift_open',
        recipientPhone: smsCfg.owner_phone,
        messageBody: `${shop?.shop_name || 'Shop'}: Cashier ${req.cashier!.full_name} opened shift ${shift.shift_ref} at ${new Date(shift.opened_at).toLocaleString()} with opening cash GHS ${Number(shift.opening_cash).toFixed(2)}.`,
        relatedEntityType: 'cashier_shifts',
        relatedEntityId: shift.id,
      });
    }

    return res.status(201).json({ shift, smsResult });
  });

  app.get('/api/cashier/shift/summary', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { data: shift } = await admin
      .from('cashier_shifts')
      .select('*')
      .eq('cashier_id', req.cashier!.id)
      .eq('status', 'open')
      .maybeSingle();

    if (!shift) return res.status(404).json({ error: 'No open shift found.' });

    const { data: sales } = await admin
      .from('sales')
      .select('id, total_amount, payment_status, payments(method, amount, status)')
      .eq('shift_id', shift.id);

    const { data: expenses } = await admin
      .from('expenses')
      .select('amount, payment_source')
      .eq('shift_id', shift.id)
      .eq('status', 'recorded');

    const { data: movements } = await admin
      .from('cash_movements')
      .select('movement_type, amount')
      .eq('shift_id', shift.id);

    let cashSales = 0;
    let momoSales = 0;
    let txCount = 0;
    for (const s of sales || []) {
      if (['paid', 'partial', 'refunded', 'partially_refunded'].includes(s.payment_status)) {
        txCount += 1;
      }
      for (const p of (s.payments as any[]) || []) {
        if (p.status === 'successful') {
          if (p.method === 'cash') cashSales += Number(p.amount);
          if (p.method === 'momo') momoSales += Number(p.amount);
        }
      }
    }

    const cashExpenses = (expenses || []).filter((e) => e.payment_source === 'cash_drawer').reduce((a, b) => a + Number(b.amount), 0);
    const momoExpenses = (expenses || []).filter((e) => e.payment_source === 'momo').reduce((a, b) => a + Number(b.amount), 0);
    const otherExpenses = (expenses || []).filter((e) => e.payment_source === 'other').reduce((a, b) => a + Number(b.amount), 0);
    const cashRefunds = (movements || []).filter((m) => m.movement_type === 'cash_refund').reduce((a, b) => a + Number(b.amount), 0);
    const cashIn = (movements || []).filter((m) => m.movement_type === 'cash_in').reduce((a, b) => a + Number(b.amount), 0);
    const cashOut = (movements || []).filter((m) => m.movement_type === 'cash_out').reduce((a, b) => a + Number(b.amount), 0);
    const expectedCash = Number(shift.opening_cash) + cashSales - cashExpenses - cashRefunds + cashIn - cashOut;

    return res.json({
      shift,
      summary: {
        opening_cash: Number(shift.opening_cash),
        cash_sales: cashSales,
        momo_sales: momoSales,
        cash_expenses: cashExpenses,
        momo_expenses: momoExpenses,
        other_expenses: otherExpenses,
        cash_refunds: cashRefunds,
        expected_cash: Math.round(expectedCash * 100) / 100,
        transaction_count: txCount,
        expense_count: (expenses || []).length,
      },
    });
  });

  app.post('/api/cashier/shift/close', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { shiftId, declaredCash, closingNotes } = req.body || {};
    const declared = Number(declaredCash);
    if (!shiftId || !Number.isFinite(declared) || declared < 0) {
      return res.status(400).json({ error: 'Shift ID and valid declared cash amount are required.' });
    }

    const { data: report, error } = await admin.rpc('fn_close_cashier_shift', {
      p_shift_id: shiftId,
      p_cashier_id: req.cashier!.id,
      p_declared_cash: declared,
      p_closing_notes: closingNotes || null,
    });

    if (error) return res.status(400).json({ error: error.message });

    const { data: smsCfg } = await admin.from('sms_configurations').select('*').limit(1).maybeSingle();
    let smsResult: { delivered: boolean; status: string; error?: string } | null = null;
    if (smsCfg?.notify_shift_close && smsCfg.owner_phone) {
      smsResult = await dispatchSasuSyncSms(admin, {
        eventType: 'shift_close',
        recipientPhone: smsCfg.owner_phone,
        messageBody: `Shift Closed (${report.shift_ref}) by ${report.cashier_name}. Cash Sales: GHS ${Number(report.cash_sales).toFixed(2)}, MoMo: GHS ${Number(report.momo_sales).toFixed(2)}, Drawer Exp: GHS ${Number(report.cash_expenses).toFixed(2)}, Expected: GHS ${Number(report.expected_cash).toFixed(2)}, Declared: GHS ${Number(report.declared_cash).toFixed(2)}, Diff: GHS ${Number(report.cash_discrepancy).toFixed(2)}.`,
        relatedEntityType: 'cashier_shifts',
        relatedEntityId: shiftId,
      });
    }

    return res.json({ report, smsResult });
  });

  app.get('/api/cashier/pos-data', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { data: products, error: prodErr } = await admin
      .from('products')
      .select('id, name, sku, barcode, category_id, selling_price, stock_quantity, min_stock_level, expiry_date, is_archived, base_unit_id, image_path, measurement_units(code, name, allow_decimal), categories(name), product_unit_conversions(*), product_barcodes(barcode, unit_conversion_id)')
      .eq('is_archived', false)
      .order('name');

    if (prodErr) return res.status(500).json({ error: prodErr.message });

    const { data: openShift } = await admin
      .from('cashier_shifts')
      .select('id')
      .eq('cashier_id', req.cashier!.id)
      .eq('status', 'open')
      .maybeSingle();

    let shiftSales: any[] = [];
    let shiftExpenses: any[] = [];
    if (openShift) {
      const { data: sData } = await admin
        .from('sales')
        .select('id, receipt_number, total_amount, paid_amount, change_given, payment_status, created_at, payments(method, network, amount, status), sale_items(id, product_id, product_name, sale_unit_name, quantity_in_sale_unit, conversion_to_base, unit_price, line_total)')
        .eq('shift_id', openShift.id)
        .order('created_at', { ascending: false })
        .limit(30);
      shiftSales = sData || [];

      const { data: eData } = await admin
        .from('expenses')
        .select('id, expense_ref, expense_name, category_name, amount, payment_source, status, created_at')
        .eq('shift_id', openShift.id)
        .order('created_at', { ascending: false });
      shiftExpenses = eData || [];
    }

    const productList = products || [];
    const imagePaths = productList.map((p: any) => p.image_path).filter(Boolean);
    let signedUrlMap = new Map<string, string>();
    if (imagePaths.length > 0) {
      const { data: signedUrls } = await admin.storage.from('product-images').createSignedUrls(imagePaths, 3600);
      if (signedUrls) {
        signedUrls.forEach((item: any) => {
          if (item.path && item.signedUrl) signedUrlMap.set(item.path, item.signedUrl);
        });
      }
    }
    const productsWithImages = productList.map((p: any) => ({
      ...p,
      image_url: p.image_path ? signedUrlMap.get(p.image_path) || null : null,
    }));

    return res.json({ products: productsWithImages, shiftSales, shiftExpenses });
  });

  app.post('/api/cashier/sales', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { clientTxRef, shiftId, items, discountAmount, cashAmount, cashTendered, momoAmount, syncSource, customerName, customerPhone } = req.body || {};

    const { data, error } = await admin.rpc('fn_complete_sale', {
      p_client_tx_ref: clientTxRef,
      p_shift_id: shiftId,
      p_cashier_id: req.cashier!.id,
      p_owner_id: null,
      p_items: items,
      p_discount_amount: Number(discountAmount || 0),
      p_cash_amount: Number(cashAmount || 0),
      p_cash_tendered: Number(cashTendered || 0),
      p_momo_amount: Number(momoAmount || 0),
      p_sync_source: syncSource === 'offline_sync' ? 'offline_sync' : 'online',
      p_customer_name: customerName || null,
      p_customer_phone: customerPhone || null,
    });

    if (error) return res.status(400).json({ error: error.message });

    let receipt = null;
    if (data?.payment_status === 'paid') {
      const { data: rcp } = await admin.from('receipts').select('*').eq('sale_id', data.sale_id).maybeSingle();
      receipt = rcp;
    }

    return res.json({ saleResult: data, receipt });
  });

  // Initiate Moolre MoMo payment (usable by authenticated cashier or owner)
  app.post('/api/payments/moolre/initiate', async (req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase unconfigured' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    // Verify either valid cashier session or valid owner token
    const tokenHash = hashToken(token);
    const { data: cSession } = await admin
      .from('cashier_sessions')
      .select('id, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!cSession || cSession.revoked_at || new Date(cSession.expires_at).getTime() < Date.now()) {
      const { data: ownerAuth } = await admin.auth.getUser(token);
      if (!ownerAuth.user) return res.status(401).json({ error: 'Unauthorized payment request' });
    }

    const moolreBaseUrl = process.env.MOOLRE_API_BASE_URL || 'https://api.moolre.com';
    const moolreUser = process.env.MOOLRE_API_USER;
    const moolrePubKey = process.env.MOOLRE_API_PUBKEY;
    const moolreAccount = process.env.MOOLRE_ACCOUNT_NUMBER;

    if (!moolreUser || !moolrePubKey || !moolreAccount) {
      return res.status(503).json({
        error: 'Moolre API credentials (MOOLRE_API_USER, MOOLRE_API_PUBKEY, MOOLRE_ACCOUNT_NUMBER) are not configured on the server.',
      });
    }

    const { saleId, payerPhone, network, amount, idempotencyKey } = req.body || {};
    if (!saleId || !payerPhone || !network || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Sale ID, payer phone, network, and positive amount are required.' });
    }

    const paymentRef = `MOMO-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const { error: insertErr } = await admin.from('payments').insert({
      sale_id: saleId,
      payment_reference: paymentRef,
      method: 'momo',
      provider: 'moolre',
      network,
      payer_phone: String(payerPhone).trim(),
      amount: Number(amount),
      status: 'initiated',
      idempotency_key: idempotencyKey || paymentRef,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    if (insertErr) return res.status(400).json({ error: insertErr.message });

    try {
      const moolreResp = await fetch(`${moolreBaseUrl}/open/transact/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-USER': moolreUser,
          'X-API-PUBKEY': moolrePubKey,
          'Idempotency-Key': idempotencyKey || paymentRef,
        },
        body: JSON.stringify({
          type: 1,
          channel: network,
          currency: 'GHS',
          payer: String(payerPhone).trim(),
          amount: Number(amount).toFixed(2),
          externalref: paymentRef,
          accountnumber: moolreAccount,
          reference: `Shop Sale ${paymentRef}`,
        }),
      });
      const moolreData = await moolreResp.json().catch(() => ({}));

      if (!moolreResp.ok || moolreData?.status === 0) {
        await admin
          .from('payments')
          .update({ status: 'failed', failure_reason: moolreData?.message || 'Moolre initiation failed' })
          .eq('payment_reference', paymentRef);
        return res.status(502).json({
          error: moolreData?.message || 'Moolre payment initiation failed',
          paymentReference: paymentRef,
        });
      }

      await admin
        .from('payments')
        .update({
          status: 'awaiting_authorization',
          provider_tx_id: moolreData?.data?.transactionid ? String(moolreData.data.transactionid) : null,
        })
        .eq('payment_reference', paymentRef);

      return res.json({ paymentReference: paymentRef, status: 'awaiting_authorization', providerResponse: moolreData });
    } catch (err) {
      await admin
        .from('payments')
        .update({ status: 'failed', failure_reason: err instanceof Error ? err.message : 'Network error' })
        .eq('payment_reference', paymentRef);
      return res.status(502).json({ error: 'Unable to reach Moolre API.' });
    }
  });

  app.get('/api/payments/moolre/status/:paymentRef', async (req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase unconfigured' });

    const { paymentRef } = req.params;
    const { data: payment } = await admin.from('payments').select('*').eq('payment_reference', paymentRef).maybeSingle();
    if (!payment) return res.status(404).json({ error: 'Payment reference not found' });

    if (payment.status === 'awaiting_authorization' && payment.expires_at && new Date(payment.expires_at).getTime() < Date.now()) {
      await admin.from('payments').update({ status: 'expired', failure_reason: 'Customer authorization timed out' }).eq('id', payment.id);
      payment.status = 'expired';
    }

    let receipt = null;
    if (payment.status === 'successful') {
      const { data: rcp } = await admin.from('receipts').select('*').eq('sale_id', payment.sale_id).maybeSingle();
      receipt = rcp;
    }

    return res.json({ payment, receipt });
  });

  // Cashier submits return request (owner alone can approve/reject)
  app.post('/api/cashier/returns', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { saleId, saleItemId, productId, quantityReturned, conversionToBase, reason, productCondition, requestedRefundAmount } = req.body || {};

    if (!saleId || !saleItemId || !productId || !quantityReturned || !reason || !productCondition) {
      return res.status(400).json({ error: 'All return request fields are required.' });
    }

    const baseQty = Number(quantityReturned) * Number(conversionToBase || 1);
    const refundRef = `RET-${Date.now().toString().slice(-6)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

    const { data, error } = await admin
      .from('return_requests')
      .insert({
        refund_ref: refundRef,
        sale_id: saleId,
        sale_item_id: saleItemId,
        product_id: productId,
        requested_by_cashier_id: req.cashier!.id,
        quantity_returned: Number(quantityReturned),
        base_quantity_returned: Math.round(baseQty * 10000) / 10000,
        reason: String(reason).trim(),
        product_condition: productCondition,
        requested_refund_amount: Number(requestedRefundAmount || 0),
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ returnRequest: data });
  });

  // ==========================================================================
  // EXPENSE QR SESSION GENERATION & SMARTPHONE EVIDENCE SUBMISSION
  // ==========================================================================

  app.post('/api/cashier/expense-qr', requireCashier, async (req: AuthedCashierRequest, res: Response) => {
    const admin = getAdminClient()!;
    const { shiftId } = req.body || {};
    if (!shiftId) return res.status(400).json({ error: 'Active shift ID is required.' });

    const { data: shift } = await admin
      .from('cashier_shifts')
      .select('id')
      .eq('id', shiftId)
      .eq('cashier_id', req.cashier!.id)
      .eq('status', 'open')
      .maybeSingle();

    if (!shift) return res.status(400).json({ error: 'Shift is not open.' });

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data: qrRow, error } = await admin
      .from('expense_qr_sessions')
      .insert({
        token_hash: tokenHash,
        cashier_id: req.cashier!.id,
        shift_id: shiftId,
        status: 'active',
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single();

    if (error) return res.status(400).json({ error: error.message });

    const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const submitUrl = `${origin.replace(/\/$/, '')}/expense-submit/${rawToken}`;
    const qrDataUrl = await QRCode.toDataURL(submitUrl, { width: 260, margin: 2 });

    return res.status(201).json({
      sessionId: qrRow.id,
      expiresAt: qrRow.expires_at,
      submitUrl,
      qrDataUrl,
    });
  });

  app.get('/api/expense-qr/:token', async (req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase unconfigured' });

    const tokenHash = hashToken(req.params.token);
    const { data: qr } = await admin
      .from('expense_qr_sessions')
      .select('id, status, expires_at, cashiers(full_name), cashier_shifts(shift_ref)')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (!qr) return res.status(404).json({ error: 'Invalid or unknown QR expense link.' });
    if (qr.status !== 'active') return res.status(410).json({ error: 'This single-use QR link has already been used or cancelled.' });
    if (new Date(qr.expires_at).getTime() < Date.now()) {
      await admin.from('expense_qr_sessions').update({ status: 'expired' }).eq('id', qr.id);
      return res.status(410).json({ error: 'This QR expense link has expired.' });
    }

    const { data: categories } = await admin.from('expense_categories').select('id, name').eq('is_active', true).order('name');
    return res.json({
      valid: true,
      expiresAt: qr.expires_at,
      cashier: Array.isArray(qr.cashiers) ? qr.cashiers[0] : qr.cashiers,
      shift: Array.isArray(qr.cashier_shifts) ? qr.cashier_shifts[0] : qr.cashier_shifts,
      categories: categories || [],
    });
  });

  app.post('/api/expense-qr/:token/submit', async (req: Request, res: Response) => {
    const admin = getAdminClient();
    if (!admin) return res.status(503).json({ error: 'Supabase unconfigured' });

    const tokenHash = hashToken(req.params.token);
    const { expenseName, categoryName, amount, paymentSource, description, imageBase64, imageMimeType } = req.body || {};

    if (!expenseName || !categoryName || !amount || Number(amount) <= 0 || !paymentSource || !imageBase64) {
      return res.status(400).json({ error: 'Expense name, category, positive amount, payment source, and receipt photo are required.' });
    }

    const { data: qr } = await admin.from('expense_qr_sessions').select('id, status, expires_at').eq('token_hash', tokenHash).maybeSingle();
    if (!qr || qr.status !== 'active' || new Date(qr.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: 'QR session is invalid, expired, or already used.' });
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    const mime = allowedMimes.includes(imageMimeType) ? imageMimeType : 'image/jpeg';
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const base64Body = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Body, 'base64');

    if (buffer.byteLength === 0 || buffer.byteLength > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Evidence photo must be between 1 byte and 5 MB.' });
    }

    const storagePath = `qr-${qr.id}-${Date.now()}.${ext}`;
    const { error: uploadErr } = await admin.storage.from('expense-evidence').upload(storagePath, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (uploadErr) {
      return res.status(500).json({ error: `Evidence upload failed: ${uploadErr.message}` });
    }

    const { data: result, error: rpcErr } = await admin.rpc('fn_submit_qr_expense', {
      p_token_hash: tokenHash,
      p_expense_name: String(expenseName).trim(),
      p_category_name: String(categoryName).trim(),
      p_amount: Number(amount),
      p_payment_source: paymentSource,
      p_description: description ? String(description).trim() : null,
      p_evidence_path: storagePath,
    });

    if (rpcErr) {
      await admin.storage.from('expense-evidence').remove([storagePath]);
      return res.status(400).json({ error: rpcErr.message });
    }

    // Trigger SasuSync SMS to owner if configured
    const { data: smsCfg } = await admin.from('sms_configurations').select('*').limit(1).maybeSingle();
    let smsResult = null;
    if (smsCfg?.notify_expense && smsCfg.owner_phone) {
      smsResult = await dispatchSasuSyncSms(admin, {
        eventType: 'expense_submitted',
        recipientPhone: smsCfg.owner_phone,
        messageBody: `Expense Recorded (${result.shift_ref}): ${result.cashier_name} submitted ${result.expense_name} (${result.category_name}) for GHS ${Number(result.amount).toFixed(2)} via ${result.payment_source}.`,
        relatedEntityType: 'expenses',
        relatedEntityId: result.expense_id,
      });
    }

    return res.status(201).json({ ok: true, expense: result, smsResult });
  });

  return app;
}

const app = createApp();
export default app;
export { app };

async function startServer() {
  const httpServer = http.createServer(app);

  // ==========================================================================
  // VITE DEV MIDDLEWARE OR PRODUCTION STATIC ASSETS
  // ==========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        host: true,
        middlewareMode: true,
        hmr: false,
        watch: null,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    const networkIps = Object.values(os.networkInterfaces())
      .flat()
      .filter((iface): iface is os.NetworkInterfaceInfo => Boolean(iface && iface.family === 'IPv4' && !iface.internal))
      .map((iface) => iface.address);
    console.log(`Provision Shop server listening on http://localhost:${PORT}`);
    networkIps.forEach((ip) => console.log(`  Mobile/Network access: http://${ip}:${PORT}`));
  });
}

if (!process.env.VERCEL) {
  startServer();
}
