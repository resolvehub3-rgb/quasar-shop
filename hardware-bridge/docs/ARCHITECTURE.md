# QusarShop Hardware Bridge — Architecture & Threat Model

## 1. Architecture

```
┌──────────────────────────────┐        loopback only         ┌─────────────────────────────────────┐
│  Browser (Chrome / Edge)     │  http://127.0.0.1:8765       │  Windows 10/11 cashier computer     │
│  QusarShop POS (HTTPS)       │ ───────────────────────────► │                                     │
│                              │  X-Bridge-Token + Origin     │  QusarShop Hardware Bridge service  │
│  - CashierPosPage            │ ◄─────────────────────────── │  (winsw wrapper + bridge.exe)       │
│  - OwnerHardwarePage         │      JSON responses          │                                     │
└──────────────────────────────┘                              │   src/api        HTTP API (loopback)│
        │                                                     │   src/pairing    one-time pairing   │
        │ Supabase (sales, receipts, audit logs)              │   src/security   DPAPI, CORS, rate  │
        └──────────────────────────────────────────────────► │   src/printers   ESC/POS + winspool │
                                                              │   src/configuration, logging       │
                                                              └─────────────────────────────────────┘
                                                                     │ raw bytes
                                                                     ▼
                                                          USB thermal printer ──► cash drawer (kick port)
```

Key decisions:

- **Separate companion app** in `hardware-bridge/`, own `package.json`, own
  `node_modules`, own tests. The web frontend only gained a small client
  (`src/lib/hardwareBridge.ts`) and a drawer policy module
  (`src/lib/drawerPolicy.ts`).
- **No Electron**, no browser window, no manual launch: the bridge is a
  Windows Service (`qusarshop-hardware-bridge`) registered by WinSW
  (`node-windows`'s bundled `winsw.exe`), start mode *Automatic*, with
  restart-on-failure actions 10s/20s/30s.
- **No Node.js on the cashier machine**: `bridge.exe` is produced with
  `@yao-pkg/pkg` (Node 24 runtime embedded).
- **Print transport**: raw ESC/POS bytes written through `winspool.drv`
  (`OpenPrinter` / `StartDocPrinter` / `WritePrinter`) via a generated PowerShell
  script — the only Windows-supported raw path that does not need a native
  module. Printer enumeration and status come from `Get-Printer`.
- **Secrets**: DPAPI `LocalMachine` scope, invoked through PowerShell's
  `System.Security.Cryptography.ProtectedData`. Nothing long-lived is stored in
  plain text.
- **Installer**: Windows built-in IExpress packages `bridge.exe`, the WinSW
  wrapper, `install.ps1` and `uninstall.ps1` into
  `QusarShop-Hardware-Bridge-Setup.exe`. `install.ps1` self-elevates (UAC).

### Why not bind to 0.0.0.0 / why not a native printer module?

Loopback binding removes the whole remote-attack surface and needs no firewall
exception. A native `node-printer`/`winrawprinter` module would require MSVC
build tools on the build machine and a per-Node-version ABI; the winspool route
is pure Windows API and version-independent.

---

## 2. HTTP API

Base URL: `http://127.0.0.1:8765` (from configuration, never `0.0.0.0`).

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | version, pairing, printer configured/connected, simulated flag |
| GET | `/pairing/status` | none | paired / code available / attempts remaining / lock |
| POST | `/pairing/initiate` | one-time code | complete pairing, returns persistent token |
| GET | `/printers` | bridge **or** admin token | enumerate Windows printers |
| POST | `/print` | bridge token | submit receipt (idempotent via `idempotencyKey`) |
| POST | `/drawer/kick` | bridge token | drawer kick (idempotent via `operationId`) |
| POST | `/diagnostics/test-print` | bridge **or** admin | test receipt |
| POST | `/diagnostics/test-drawer` | bridge **or** admin | test drawer kick |
| GET | `/admin/status` | admin token | service status |
| GET | `/admin/pairing-code` | admin token | current one-time code |
| POST | `/admin/pairing/regenerate` | admin token | revoke + new code |
| POST | `/admin/pairing/revoke` | admin token | revoke pairing |
| POST | `/admin/printer/select` | admin token | select printer / paper width / simulate |
| GET/POST | `/admin/config` | admin token | read/update non-secret config |

Anything else → `404 { ok:false, error:"Not found" }`. No shell, no filesystem
browse, no arbitrary USB control.

Request controls:

- **Loopback bind only.**
- **Origin allowlist** — exact match against configured origins, never `*`.
  Requests carrying a disallowed `Origin` are rejected with `403`.
- **CORS** echoes only an allowed origin; `Vary: Origin` is always set.
- **Private Network Access** — responds
  `Access-Control-Allow-Private-Network: true` so Chrome/Edge from an HTTPS page
  may call loopback.
- **Content type / size** — JSON only, 1 MB cap, oversized bodies destroy the
  socket.
- **Rate limit** — 120 requests/minute per client, `429` beyond.
- **Request id** — echoed on errors (`requestId`) and used in logs.
- **Idempotency** — last 50 operation ids retained per configuration; replays
  return `duplicate:true` without touching hardware.
- Errors are structured: `{ ok:false, error, requestId? }`.

---

## 3. Pairing lifecycle

```
install → service starts → generate 8-char CSPRNG code (10 min TTL)
   │                          └─ written to pairing-code.txt (ACL: Administrators/SYSTEM)
   ▼
owner reads code via management utility (`admin status` / `admin pairing-code`)
   ▼
QusarShop → POST /pairing/initiate {code}
   │  • constant-time compare
   │  • 5 attempts → 15-minute lockout
   │  • expiry check
   ▼
success → new 32-byte hex token generated, DPAPI-protected in config.json
          code deleted + invalidated (single use)
          token returned to the owner's browser, saved in localStorage
   ▼
persistent pairing — survives service restart, Windows restart, browser close
   ▼
revoke (owner action, `admin revoke` or Clear in QusarShop) → new code required
```

Notes:

- The temporary code is never logged; only "pairing code generated" is logged.
- Failed attempts are logged **without** the attempted value.
- The permanent token is returned exactly once, over loopback, to an origin that
  has already passed the allowlist check.

---

## 4. Threat model

**Assets**

1. Cash drawer (physical) — must only open for authorised cash sales/manual opens.
2. Printer (physical) — must only print QusarShop receipts.
3. Pairing/admin tokens — control of the bridge API.
4. Sales data in transit to the bridge.

**Adversaries**

| Adversary | Capability | Mitigation |
|---|---|---|
| Remote network attacker | Internet access | Loopback bind; nothing is exposed off-machine |
| Malicious website in the browser | Can issue fetches to localhost | Exact origin allowlist + token requirement; no wildcard CORS; PNA only granted to allowed origins |
| Local non-admin user on the PC | Read files, call localhost | Pairing code single-use/expiring/locked; admin token DPAPI-protected and ACL'd; bridge token required for hardware ops |
| Another local process | Replay/duplicate commands | Idempotency keys per transaction (drawer/print) |
| Attacker reading config file | Offline | DPAPI LocalMachine for every secret |
| Log reader | Read logs | Redaction of token/secret/code/password/key fields |
| Supply-chain / installer tampering | Replace installer | Installer not signed — documented as a known limitation; user must trust the source |

**Explicit non-goals / accepted limitations**

- A malicious *local administrator* can always control the machine.
- The browser holds a long-lived bridge token in `localStorage`; this is inherent
  to a browser talking directly to a loopback service. The token is scoped to
  the bridge only (no database access), is never logged, and can be invalidated
  instantly with `admin revoke`.
- Drawer state is not observable — always reported as *unverified*.
- Printer "connected" means Windows reports the printer online; it is never
  described as physically verified unless a test print succeeded.

---

## 5. Honest status semantics

| Label | Meaning |
|---|---|
| Not configured | No bridge config saved in QusarShop |
| Not paired | Bridge reachable, but no pairing completed |
| Bridge unavailable | Fetch to the loopback endpoint failed |
| Bridge running | `/health` returned `ok:true` |
| Printer detected | Windows enumerates the selected printer |
| Printer unavailable | Windows reports offline/not present |
| Printer not verified | Enumerated but no successful print job |
| Drawer kick supported | A printer is configured (drawer is printer-driven) |
| Drawer kick not verified | No confirmed kick / no state feedback |
| Test successful / failed | Result of the actual submitted job |

A responding bridge never marks the whole hardware system "ready".