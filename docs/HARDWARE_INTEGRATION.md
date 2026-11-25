# POS Hardware Integration

## Supported hardware
- Barcode scanners: USB keyboard-wedge scanners (most common). Browser cannot detect physical connection; scans appear as rapid keystrokes terminated by Enter.
- Thermal printers: 58mm/80mm ESC/POS compatible printers reachable through the local hardware bridge.
- Cash drawer: printer-driven drawer (RJ11/RJ12 drawer-kick port on a compatible printer).

## Local hardware bridge
The bridge lives in `hardware-bridge/` and runs on the cashier's computer.

Install:
```
cd hardware-bridge
npm install   # none required; uses Node built-ins only
node bridge.js
```

On first run it generates `bridge.config.json` containing a pairing token. Copy the token into the Owner -> POS Hardware settings (Bridge Base URL + Pairing Token).

Auto-start on Windows: create a shortcut in the Startup folder running `node bridge.js`, or use Task Scheduler.

## Configuration
- `printerDevicePath`: raw device path (Linux/macOS), e.g. `/dev/usb/lp0`.
- `printerName`: Windows printer name for raw ESC/POS via PowerShell.
- `simulate`: set true only for labelled simulation/testing without hardware.
- `BRIDGE_SIMULATE=1` env also enables simulation.

## Security
- Bridge binds to 127.0.0.1 by default.
- Requires `X-Bridge-Token` header.
- Validates Origin against allowed list.
- No arbitrary command execution or filesystem exposure beyond the configured printer path.

## Limitations
- Physical printer/drawer connection must be verified on the cashier's computer.
- Drawer status is unverified unless the bridge/printer supports real status.
- Standard drawers cannot be closed by software.
