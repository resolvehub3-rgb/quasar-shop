import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export interface WindowsPrinter {
  name: string;
  driverName?: string;
  portName?: string;
  printerStatus?: number;
  workOffline?: boolean;
}

export async function enumeratePrinters(): Promise<WindowsPrinter[]> {
  if (process.platform !== 'win32') return [];
  const ps = `Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,WorkOffline | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((p: any) => ({
      name: String(p.Name),
      driverName: p.DriverName ? String(p.DriverName) : undefined,
      portName: p.PortName ? String(p.PortName) : undefined,
      printerStatus: typeof p.PrinterStatus === 'number' ? p.PrinterStatus : undefined,
      workOffline: Boolean(p.WorkOffline),
    }));
  } catch {
    return [];
  }
}

export function isPrinterOnline(p: WindowsPrinter): boolean {
  // PrinterStatus 0 = Normal. WorkOffline false.
  if (p.workOffline) return false;
  if (p.printerStatus !== undefined && p.printerStatus !== 0) return false;
  return true;
}

const RAW_PS_SCRIPT = `
param([string]$PrinterName, [string]$FilePath)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOC_INFO_1 pDocInfo);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public struct DOC_INFO_1 { public string pDocName; public string pOutputFile; public string pDatatype; }
}
"@
$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$h = [IntPtr]::Zero
if (-not [RawPrinter]::OpenPrinter($PrinterName, [ref]$h, [IntPtr]::Zero)) {
  throw "Cannot open printer: $PrinterName"
}
$di = New-Object RawPrinter+DOC_INFO_1
$di.pDocName = "QusarShop Job"
$di.pDatatype = "RAW"
if (-not [RawPrinter]::StartDocPrinter($h, 1, $di)) { [RawPrinter]::ClosePrinter($h); throw "StartDocPrinter failed" }
if (-not [RawPrinter]::StartPagePrinter($h)) { [RawPrinter]::EndDocPrinter($h); [RawPrinter]::ClosePrinter($h); throw "StartPagePrinter failed" }
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$written = 0
$ok = [RawPrinter]::WritePrinter($h, $ptr, $bytes.Length, [ref]$written)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
[RawPrinter]::EndPagePrinter($h) | Out-Null
[RawPrinter]::EndDocPrinter($h) | Out-Null
[RawPrinter]::ClosePrinter($h) | Out-Null
if (-not $ok) { throw "WritePrinter failed" }
Write-Output "OK:$written"
`;

export async function rawPrintToWindowsPrinter(printerName: string, data: Buffer): Promise<{ ok: boolean; error?: string; bytesWritten?: number }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Not Windows' };
  }
  const tmp = path.join(os.tmpdir(), `qusarshop-print-${Date.now()}.bin`);
  try {
    fs.writeFileSync(tmp, data);
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
  const scriptPath = path.join(os.tmpdir(), `qusarshop-rawprint-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, RAW_PS_SCRIPT, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-PrinterName', printerName, '-FilePath', tmp], { windowsHide: true });
    const m = stdout.match(/OK:(\d+)/);
    if (m) return { ok: true, bytesWritten: Number(m[1]) };
    return { ok: false, error: (stderr || stdout || 'Unknown print error').trim() };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

export async function writeToPrinter(cfg: { printerName: string; printerDevicePath: string; simulate: boolean }, data: Buffer): Promise<{ ok: boolean; simulated?: boolean; error?: string; bytesWritten?: number }> {
  if (cfg.simulate) {
    return { ok: true, simulated: true, message: 'Simulation mode: no physical write performed.' } as any;
  }
  if (cfg.printerDevicePath) {
    try {
      fs.writeFileSync(cfg.printerDevicePath, data);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }
  if (cfg.printerName) {
    return rawPrintToWindowsPrinter(cfg.printerName, data);
  }
  return { ok: false, error: 'No printer configured.' };
}