# QusarShop Hardware Bridge — Owner's Guide

This guide explains how to install and use the QusarShop Hardware Bridge on the
cashier's Windows computer so that receipts print and the cash drawer opens.

You do **not** need to know any programming, open a terminal, or install Node.js.

---

## 1. What it is

The **Hardware Bridge** is a small program that runs quietly in the background on
the Windows computer that is connected to:

- your USB thermal receipt printer (58mm or 80mm), and
- your cash drawer (plugged into the printer's drawer-kick/RJ11 port).

QusarShop (the website) talks to this program over the local computer only
(`http://127.0.0.1:8765`). It never travels over the internet.

Once installed it:

1. starts automatically when Windows starts,
2. keeps running even if you close Chrome/Edge or log out of QusarShop,
3. restarts itself if it ever crashes,
4. needs to be **paired only once**.

---

## 2. Requirements

- Windows 10 (any recent version) or Windows 11, 64-bit.
- The cashier computer with the printer connected by USB and switched on.
- The printer's Windows driver installed (see section 5).
- Administrator rights **once**, during installation.

---

## 3. Install (Windows 10 / Windows 11)

1. Download **`QusarShop-Hardware-Bridge-Setup.exe`** to the cashier computer.
2. Double-click it.
3. If Windows shows *"Windows protected your PC"* (SmartScreen), click
   **More info → Run anyway**. The installer is not code-signed, so this warning
   is expected — see section 11.
4. If asked *Do you want to allow this app to make changes?* click **Yes**
   (Windows needs administrator rights to register the service).
5. Wait for **"Installation complete."**

That is all. No terminal commands, no Node.js installation.

**What the installer does**

| Step | Detail |
|---|---|
| Files | Copies `bridge.exe` and the service wrapper to `C:\Program Files\QusarShop Hardware Bridge\` |
| Service | Registers the Windows Service `qusarshop-hardware-bridge` |
| Startup | Sets the service to **Automatic** start (runs at every Windows boot) |
| Recovery | On failure, restarts after 10s, 20s, 30s; resets the failure count every hour |
| Data | Creates `C:\ProgramData\QusarShop\HardwareBridge\` for configuration and logs |
| Shortcut | Places **QusarShop Bridge Management** on the Desktop |
| Runtime | Bundles the Node.js runtime inside `bridge.exe` — nothing to install |

---

## 4. Pair (do this once)

1. Open **QusarShop Bridge Management** on the Desktop (it opens a small
   command window and prints the bridge status).
2. It prints a line like:

   ```
   Pairing code: DT4CZMUM
   ```

   If it says `(no active code)`, run **regenerate** instead:

   ```
   "C:\Program Files\QusarShop Hardware Bridge\bridge.exe" admin regenerate
   ```

   The code is also written to
   `C:\ProgramData\QusarShop\HardwareBridge\pairing-code.txt`
   (readable by administrators only).

3. In QusarShop go to **Owner → POS Hardware → Local Hardware Bridge**.
4. Leave **Bridge Base URL** as `http://127.0.0.1:8765` (only change it if the
   bridge itself reports a different port).
5. Paste the code into **Pairing Code**.
6. Click **Pair with Bridge**.

You should see **"Pairing successful. Bridge configured."**

The code:

- expires after 10 minutes,
- can be used **once**,
- is invalidated immediately after pairing,
- locks the bridge for 15 minutes after 5 wrong attempts.

You will not be asked to pair again after normal restarts, closing the browser,
or upgrading the bridge. Only **Clear** (in QusarShop) or **revoke** (in the
management utility) requires pairing again.

---

## 5. Printer setup

1. Connect the thermal printer by USB and turn it on.
2. Install the printer's driver from the manufacturer (or let Windows install a
   generic one). Windows must show the printer in
   **Settings → Bluetooth & devices → Printers & scanners**.
3. In the management utility run:

   ```
   "C:\Program Files\QusarShop Hardware Bridge\bridge.exe" admin printers
   ```

   Copy the exact **Name** of your printer.
4. In QusarShop → **POS Hardware** click **Test Receipt Print** after selecting
   the printer. *(Printer selection is stored in the bridge configuration; if
   the printer name needs to be set from QusarShop, use the owner hardware
   settings.)*
5. Put a test receipt through and check the print is legible.

**Paper width** (58mm / 80mm) is set in Shop Settings and is applied to receipt
layout (32 vs 48 characters per line).

### Is my printer ESC/POS compatible?

Most small USB thermal receipt printers are. Signs:

- the listing says "ESC/POS", or
- the printer prints a self-test page with codes like `ESC @`, `GS V`.

If the test print produces garbled characters, the printer is not receiving raw
ESC/POS bytes — check the driver (a "RAW" / "Generic / Text Only" port usually
works better than a manufacturer driver that rasterises text).

---

## 6. Cash drawer setup

1. Plug the drawer's RJ11/RJ12 cable into the printer's **drawer kick** port
   (marked with a drawer symbol).
2. In QusarShop → **POS Hardware** click **Test Drawer Kick**.

The drawer must pop. Notes:

- The drawer **state cannot be read back** by the printer, so QusarShop always
  reports drawer status as **unverified** — it confirms the command was
  *submitted*, not that the drawer physically opened.
- A drawer only opens for **completed sales containing cash**:
  cash sale → opens; MoMo-only → does not open; cash + MoMo split → opens;
  failed, pending or cancelled → does not open.
- Manual opening is owner-only and requires a reason (it is audit-logged).

---

## 7. Daily operation

Nothing to do. After Windows boots:

1. the service starts by itself,
2. QusarShop finds the bridge at `http://127.0.0.1:8765`,
3. cashiers scan, sell, print, and the drawer opens for cash sales.

The bridge keeps working when the browser is closed, when the cashier logs out,
and when the QusarShop website is temporarily unavailable.

---

## 8. Management commands

Open a command window as administrator and run
`"C:\Program Files\QusarShop Hardware Bridge\bridge.exe" admin <command>`:

| Command | Purpose |
|---|---|
| `status` | Service/bridge status, version, pairing state, printer |
| `pairing-code` | Show the current one-time pairing code |
| `regenerate` | Invalidate pairing (if any) and issue a new code |
| `revoke` | Revoke the current pairing (requires re-pairing afterwards) |
| `printers` | List Windows printers and their online state |
| `test-print` | Send a test receipt |
| `test-drawer` | Send a drawer-kick command |
| `health` | Raw health JSON from the running bridge |

Service control:

```
net start qusarshop-hardware-bridge
net stop qusarshop-hardware-bridge
```

---

## 9. Upgrade

Run the new `QusarShop-Hardware-Bridge-Setup.exe` over the old installation.
It replaces the files and re-registers the service. **Configuration and pairing
are preserved** (`C:\ProgramData\QusarShop\HardwareBridge\`).

---

## 10. Uninstall

Run **`uninstall.ps1`** from the extracted installer folder as administrator,
or run from an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1
```

This stops and removes the service, deletes `C:\Program Files\QusarShop
Hardware Bridge` and the desktop shortcut. **Configuration and pairing data are
kept** in `C:\ProgramData\QusarShop\HardwareBridge` — delete that folder
manually for a completely clean removal.

---

## 11. Security notes & Windows warnings

- The installer and the bridge executable are **not code-signed** (no
  certificate was available). Windows SmartScreen and Defender may warn. Review
  the download source before running; after installation you can whitelist
  `C:\Program Files\QusarShop Hardware Bridge`.
- The bridge listens on **127.0.0.1 only** — it is never reachable from the
  network or the internet.
- Only the exact QusarShop origins you configure may call it (no wildcard
  CORS).
- Long-lived secrets (pairing token, admin token, pairing code) are encrypted
  with **Windows DPAPI (LocalMachine scope)** in the configuration file — they
  are never stored in plain text, never logged, and never shipped to the
  frontend bundle.
- The bridge has no endpoint that executes commands, browses files, or performs
  arbitrary USB operations.
- Do not disable the Windows firewall as a workaround; loopback traffic does not
  need a firewall exception.

---

## 12. Troubleshooting

| Symptom | What to check |
|---|---|
| "Bridge unreachable" in QusarShop | Is the service running? `net start qusarshop-hardware-bridge`. Does `admin status` work? |
| Pairing code rejected | Codes expire in 10 minutes and are single use — run `admin regenerate` and paste the new code quickly |
| "Locked" after pairing attempts | Wait 15 minutes, or run `admin regenerate` as administrator |
| Test print does nothing | Printer name correct? Printer online in Windows? Try `admin printers` |
| Garbled print | Printer may not be ESC/POS; try a different driver/port |
| Drawer does not pop | Cable in the printer's drawer port (not the wall), and use **Test Drawer Kick** |
| Service stops after a while | Check logs in `C:\ProgramData\QusarShop\HardwareBridge\logs\` |
| Firewall prompt | Not needed for loopback; deny if you wish |

Logs contain no secrets. They rotate at 5 MB.