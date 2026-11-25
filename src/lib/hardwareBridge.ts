/**
 * Client for the local QusarShop hardware bridge.
 *
 * The bridge runs on the cashier's computer (localhost) and is the ONLY component
 * that talks to the physical thermal printer / cash drawer. The PWA never claims
 * a device is connected unless the bridge health check succeeds.
 */

export interface BridgeHealth {
  ok: boolean;
  version: string;
  printerConfigured: boolean;
  printerConnected: boolean;
  drawerSupported: boolean;
  message?: string;
}

export interface BridgeConfig {
  baseUrl: string; // e.g. http://127.0.0.1:8787
  token: string;
}

const STORAGE_KEY = 'qusarshop_hardware_bridge_config_v1';

export function loadBridgeConfig(): BridgeConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.baseUrl || !parsed?.token) return null;
    return { baseUrl: String(parsed.baseUrl).replace(/\/+$/, ''), token: String(parsed.token) };
  } catch {
    return null;
  }
}

export function saveBridgeConfig(cfg: BridgeConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearBridgeConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function bridgeFetch(cfg: BridgeConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
  const headers = new Headers(init.headers || {});
  headers.set('X-Bridge-Token', cfg.token);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  return fetch(url, { ...init, headers });
}

export async function checkBridgeHealth(cfg: BridgeConfig): Promise<BridgeHealth> {
  try {
    const res = await bridgeFetch(cfg, '/health', { method: 'GET' });
    if (!res.ok) {
      return { ok: false, version: '', printerConfigured: false, printerConnected: false, drawerSupported: false, message: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      ok: Boolean(data?.ok),
      version: String(data?.version || ''),
      printerConfigured: Boolean(data?.printerConfigured),
      printerConnected: Boolean(data?.printerConnected),
      drawerSupported: Boolean(data?.drawerSupported),
      message: data?.message,
    };
  } catch (err) {
    return {
      ok: false,
      version: '',
      printerConfigured: false,
      printerConnected: false,
      drawerSupported: false,
      message: err instanceof Error ? err.message : 'Bridge unreachable',
    };
  }
}

export interface PrintReceiptPayload {
  shopName: string;
  shopPhone?: string | null;
  shopAddress?: string | null;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  receiptNumber: string;
  clientTxRef: string;
  date: string;
  cashierName: string;
  paperWidth: '58mm' | '80mm';
  items: Array<{ product_name: string; unit_name: string; quantity: number; unit_price: number; line_total: number }>;
  subtotal: number;
  discount: number;
  total: number;
  payments: Array<{ method: string; network?: string; amount: number }>;
  changeGiven: number;
}

export async function printReceipt(cfg: BridgeConfig, payload: PrintReceiptPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bridgeFetch(cfg, '/print', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Print request failed' };
  }
}

export async function kickDrawer(cfg: BridgeConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bridgeFetch(cfg, '/drawer/kick', { method: 'POST', body: JSON.stringify({}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Drawer kick failed' };
  }
}

export async function testPrint(cfg: BridgeConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bridgeFetch(cfg, '/diagnostics/test-print', { method: 'POST', body: JSON.stringify({}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Test print failed' };
  }
}

export async function testDrawer(cfg: BridgeConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await bridgeFetch(cfg, '/diagnostics/test-drawer', { method: 'POST', body: JSON.stringify({}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Test drawer failed' };
  }
}
