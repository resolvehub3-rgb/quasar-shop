const test = require('node:test');
const assert = require('node:assert');
const { PairingManager } = require('../dist/pairing/pairing');
const { defaultConfig } = require('../dist/configuration/config');

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

test('pairing: first-time pairing succeeds with correct code', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  const code = await pm.getPairingCodePlain();
  assert.ok(code && code.length === 8);
  const r = await pm.initiate(code);
  assert.equal(r.ok, true);
  assert.ok(r.token && r.token.length >= 64);
  assert.equal(cfg.paired, true);
  assert.equal(await pm.getPairingCodePlain(), null);
});

test('pairing: invalid code rejected', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  const r = await pm.initiate('ZZZZZZZZ');
  assert.equal(r.ok, false);
  assert.match(r.error, /Invalid/i);
});

test('pairing: code is single-use', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  const code = await pm.getPairingCodePlain();
  const r1 = await pm.initiate(code);
  assert.equal(r1.ok, true);
  const r2 = await pm.initiate(code);
  assert.equal(r2.ok, false);
});

test('pairing: expired code rejected', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  cfg.pairingCodeExpiresAt = Date.now() - 1000;
  const code = await pm.getPairingCodePlain();
  const r = await pm.initiate(code || 'AAAAAAAA');
  assert.equal(r.ok, false);
});

test('pairing: excessive failed attempts lock out', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  for (let i = 0; i < 5; i++) await pm.initiate('ZZZZZZZZ');
  const st = pm.status();
  assert.equal(st.attemptsRemaining, 0);
  assert.ok(st.lockedUntil);
  const r = await pm.initiate('ZZZZZZZZ');
  assert.equal(r.ok, false);
  assert.match(r.error, /Locked/i);
});

test('pairing: revocation allows re-pairing', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  const code = await pm.getPairingCodePlain();
  await pm.initiate(code);
  assert.equal(cfg.paired, true);
  await pm.revoke();
  assert.equal(cfg.paired, false);
  await pm.ensurePairingCode();
  const code2 = await pm.getPairingCodePlain();
  assert.ok(code2 && code2 !== code);
  const r = await pm.initiate(code2);
  assert.equal(r.ok, true);
});

test('pairing: token validation', async () => {
  const cfg = defaultConfig();
  const pm = new PairingManager(cfg, log);
  await pm.ensurePairingCode();
  const code = await pm.getPairingCodePlain();
  const r = await pm.initiate(code);
  assert.equal(await pm.validateToken(r.token), true);
  assert.equal(await pm.validateToken('bad-token'), false);
  assert.equal(await pm.validateAdminToken(await pm.ensureAdminToken()), true);
});