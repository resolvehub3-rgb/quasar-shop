# POS Hardware Integration

Owner-facing instructions live in [`hardware-bridge/docs/INSTALLATION.md`](../hardware-bridge/docs/INSTALLATION.md)
(install, pairing, printer, drawer, troubleshooting) and the design/threat model in
[`hardware-bridge/docs/ARCHITECTURE.md`](../hardware-bridge/docs/ARCHITECTURE.md).

## Supported hardware

- **Barcode scanners**: USB keyboard-wedge scanners. The browser cannot detect the
  physical device; scans appear as rapid keystroke bursts terminated by Enter
  (`src/lib/barcodeScan.ts`, `src/hooks/useBarcodeScanner.ts`). Normal typing in
  input fields is never intercepted.
- **Thermal printers**: 58mm/80mm ESC/POS printers connected to the cashier PC,
  reached through the local hardware bridge (`hardware-bridge/`).
- **Cash drawer**: printer-driven drawer on the printer's drawer-kick port.

## Local hardware bridge

`hardware-bridge/` is a standalone Windows background service (no Electron, no
browser window, no Node.js install required on the cashier PC):

```
cd hardware-bridge
pnpm install
pnpm build        # tsc -> dist/
pnpm test         # node:test suite
node dist/index.js              # run in foreground (dev)
node dist/index.js admin status # management utility
```

The installer (`QusarShop-Hardware-Bridge-Setup.exe`, built from
`installer-staging/`) registers the `qusarshop-hardware-bridge` Windows Service
with Automatic start and 10/20/30-second restart-on-failure actions.

## Configuration

Configuration lives in `C:\ProgramData\QusarShop\HardwareBridge\config.json`.
Secrets (pairing token, admin token, pairing code) are DPAPI-protected, never
stored in plain text and never logged. Non-secret settings:

- `port` / `host` — default `8765` on `127.0.0.1` (loopback only)
- `allowedOrigins` — exact QusarShop origins; no wildcards
- `printerName` — Windows printer name used for raw ESC/POS output
- `paperWidth` — `58mm` | `80mm`
- `simulate` — labelled simulation for bench testing without hardware

## Security

- Loopback-only binding, strict origin allowlist, CORS/PNA headers for the
  HTTPS production origin, JSON-only bodies, 1 MB cap, rate limiting, request
  ids and per-transaction idempotency for print/drawer operations.
- Owner-only pairing (one-time code, 10-minute expiry, single use, 5-attempt
  lockout) and owner-only manual drawer opening (reason required,
  audit-logged to `audit_logs`).
- No command execution, filesystem browsing or arbitrary USB endpoints.

## Known limitations

- Physical printer/drawer behaviour must be verified on the cashier's computer;
  the bridge reports *job submitted*, never *physically printed*, and drawer
  state is always **unverified**.
- The installer/bridge executables are unsigned (no code-signing certificate),
  so Windows SmartScreen warnings are expected.