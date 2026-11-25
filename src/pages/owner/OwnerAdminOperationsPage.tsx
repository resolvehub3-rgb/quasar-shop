import React, { useCallback, useEffect, useState } from 'react';
import { Check, XCircle, KeyRound, UserPlus, Send, Save, ShieldAlert, Loader2, Cpu, Printer, Banknote, ScanBarcode } from 'lucide-react';
import {
  loadBridgeConfig,
  saveBridgeConfig,
  clearBridgeConfig,
  checkBridgeHealth,
  testPrint,
  testDrawer,
  type BridgeHealth,
} from '../../lib/hardwareBridge';
import { supabase } from '../../lib/supabaseClient';
import { formatGHS } from '../../lib/posCalculations';
import { PWAInstallButton } from '../../components/PWAInstallButton';
import type {
  Cashier,
  CashierShift,
  Product,
  ReturnRequestRecord,
  SaleRecord,
  ShopSettings,
  SmsConfig,
  Supplier,
} from '../../types/database';

export const OwnerReturnsPage: React.FC = () => {
  const [returns, setReturns] = useState<ReturnRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundMethodChoice, setRefundMethodChoice] = useState<Record<string, 'cash' | 'momo_manual'>>({});

  const loadReturns = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: rErr } = await supabase
      .from('return_requests')
      .select('*, sales(receipt_number), products(name), cashiers(full_name)')
      .order('created_at', { ascending: false });
    if (rErr) setError(rErr.message);
    setReturns((data as unknown as ReturnRequestRecord[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  const handleReview = async (reqRow: ReturnRequestRecord, decision: 'approved' | 'rejected') => {
    if (!supabase) return;
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const ownerId = sess.session?.user?.id;
    if (!ownerId) return;

    const method = decision === 'approved' ? refundMethodChoice[reqRow.id] || 'cash' : null;
    const { error: rpcErr } = await supabase.rpc('fn_review_return_request', {
      p_return_id: reqRow.id,
      p_owner_id: ownerId,
      p_decision: decision,
      p_refund_payment_method: method,
      p_review_notes: `Reviewed by owner (${decision})`,
    });
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    await loadReturns();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Returns & Refund Approvals</h1>
        <p className="text-xs text-[#6B7280]">
          Only the shop owner can approve refunds. Damaged or expired goods are tracked separately and never returned to saleable stock.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading return requests...</p>
        ) : returns.length === 0 ? (
          <p className="p-12 text-center text-xs text-[#6B7280]">No return or refund requests submitted yet.</p>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {returns.map((r) => (
              <div key={r.id} className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div>
                  <p className="font-bold text-sm text-[#1F2937]">
                    {r.refund_ref} · {r.products?.name} ({r.quantity_returned} units)
                  </p>
                  <p className="text-[#6B7280] mt-0.5">
                    Receipt {r.sales?.receipt_number} · Condition: <strong className="capitalize">{r.product_condition}</strong> · Cashier:{' '}
                    {r.cashiers?.full_name || 'Owner'}
                  </p>
                  <p className="text-[#4B5563] mt-1">Reason: {r.reason}</p>
                </div>

                <div className="flex items-center gap-3">
                  <span className="font-bold text-sm tabular-nums">{formatGHS(Number(r.requested_refund_amount))}</span>
                  {r.status === 'pending' ? (
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Refund payout method for ${r.refund_ref}`}
                        value={refundMethodChoice[r.id] || 'cash'}
                        onChange={(e) =>
                          setRefundMethodChoice((prev) => ({
                            ...prev,
                            [r.id]: e.target.value as 'cash' | 'momo_manual',
                          }))
                        }
                        className="rounded border border-[#E5E7EB] px-2 py-1.5 bg-white"
                      >
                        <option value="cash">Cash Refund</option>
                        <option value="momo_manual">Manual MoMo Payout</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleReview(r, 'approved')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReview(r, 'rejected')}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 font-semibold text-[#E60000] hover:bg-red-50 cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </button>
                    </div>
                  ) : (
                    <span className={`font-bold capitalize ${r.status === 'approved' ? 'text-emerald-700' : 'text-[#6B7280]'}`}>
                      {r.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const OwnerReportsPage: React.FC = () => {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReports = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const fromIso = `${dateFrom}T00:00:00.000Z`;
    const toIso = `${dateTo}T23:59:59.999Z`;

    const [sRes, eRes, pRes, supRes, shRes] = await Promise.all([
      supabase
        .from('sales')
        .select('*, payments(method, amount, status), sale_items(*), cashiers(full_name)')
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      supabase
        .from('expenses')
        .select('*')
        .eq('status', 'recorded')
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
      supabase.from('products').select('*').eq('is_archived', false),
      supabase.from('suppliers').select('*').eq('is_active', true),
      supabase
        .from('cashier_shifts')
        .select('*, cashiers(full_name)')
        .gte('opened_at', fromIso)
        .lte('opened_at', toIso),
    ]);

    setSales((sRes.data as unknown as SaleRecord[]) || []);
    setExpenses(eRes.data || []);
    setProducts((pRes.data as unknown as Product[]) || []);
    setSuppliers((supRes.data as Supplier[]) || []);
    setShifts((shRes.data as unknown as CashierShift[]) || []);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const paidSales = sales.filter((s) => ['paid', 'partial', 'partially_refunded'].includes(s.payment_status));
  const grossSales = paidSales.reduce((a, b) => a + Number(b.subtotal), 0);
  const totalDiscounts = paidSales.reduce((a, b) => a + Number(b.discount_amount), 0);
  const netSales = paidSales.reduce((a, b) => a + Number(b.total_amount), 0);
  const totalExpenses = expenses.reduce((a, b) => a + Number(b.amount), 0);

  let cashSales = 0;
  let momoSales = 0;
  let allItemsHaveCost = paidSales.length > 0;
  let cogs = 0;
  const productPerf = new Map<string, { name: string; qty: number; revenue: number }>();

  for (const s of paidSales) {
    for (const p of s.payments || []) {
      if (p.status === 'successful') {
        if (p.method === 'cash') cashSales += Number(p.amount);
        if (p.method === 'momo') momoSales += Number(p.amount);
      }
    }
    for (const item of s.sale_items || []) {
      if (item.cost_basis_per_base_unit === null || item.cost_basis_per_base_unit === undefined) {
        allItemsHaveCost = false;
      } else {
        cogs += Number(item.quantity_in_sale_unit) * Number(item.conversion_to_base) * Number(item.cost_basis_per_base_unit);
      }
      const prev = productPerf.get(item.product_id) || { name: item.product_name, qty: 0, revenue: 0 };
      prev.qty += Number(item.base_quantity_deducted);
      prev.revenue += Number(item.line_total);
      productPerf.set(item.product_id, prev);
    }
  }

  const grossProfit = allItemsHaveCost ? netSales - cogs : null;
  const netProfit = grossProfit !== null ? grossProfit - totalExpenses : null;

  const stockValuation = products.reduce(
    (sum, p) => sum + (p.purchase_cost !== null ? Number(p.stock_quantity) * Number(p.purchase_cost) : 0),
    0
  );
  const topProducts = Array.from(productPerf.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const discrepancies = shifts.filter((sh) => sh.status === 'closed' && Number(sh.cash_discrepancy || 0) !== 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2937]">Reports & Financial Analytics</h1>
          <p className="text-xs text-[#6B7280]">Calculated strictly from recorded sales, historical cost basis, and verified expenses</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5" />
          <span>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5" />
        </div>
      </div>

      {loading ? (
        <p className="p-10 text-center text-xs text-[#6B7280]">Calculating real-time reports...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6B7280]">Gross Sales</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums">{formatGHS(grossSales)}</p>
              <p className="text-[11px] text-[#6B7280] mt-1 tabular-nums">Discounts: {formatGHS(totalDiscounts)}</p>
            </div>
            <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6B7280]">Net Sales</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums">{formatGHS(netSales)}</p>
              <p className="text-[11px] text-[#6B7280] mt-1 tabular-nums">
                Cash: {formatGHS(cashSales)} · MoMo: {formatGHS(momoSales)}
              </p>
            </div>
            <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6B7280]">Estimated Gross Profit</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums">
                {grossProfit !== null ? formatGHS(grossProfit) : 'Cost basis incomplete'}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-1 tabular-nums">COGS: {allItemsHaveCost ? formatGHS(cogs) : '—'}</p>
            </div>
            <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
              <p className="text-xs text-[#6B7280]">Estimated Net Profit</p>
              <p className="mt-1 font-display text-xl font-bold tabular-nums">
                {netProfit !== null ? formatGHS(netProfit) : 'Cost basis incomplete'}
              </p>
              <p className="text-[11px] text-[#6B7280] mt-1 tabular-nums">Expenses: {formatGHS(totalExpenses)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl bg-white border border-[#E5E7EB] p-5">
              <h2 className="font-display text-sm font-bold mb-3">Best-Selling Products</h2>
              {topProducts.length === 0 ? (
                <p className="text-xs text-[#6B7280] py-6 text-center">No product sales in selected date range.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[#6B7280] border-b border-[#E5E7EB]">
                    <tr>
                      <th className="text-left py-2">Product</th>
                      <th className="text-right py-2">Base Qty</th>
                      <th className="text-right py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {topProducts.map((p) => (
                      <tr key={p.name}>
                        <td className="py-2 font-medium">{p.name}</td>
                        <td className="py-2 text-right tabular-nums">{p.qty.toFixed(2)}</td>
                        <td className="py-2 text-right font-bold tabular-nums">{formatGHS(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4">
              <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-3">
                <span className="text-xs text-[#6B7280]">Current Inventory Cost Valuation</span>
                <span className="font-display text-base font-bold tabular-nums">{formatGHS(stockValuation)}</span>
              </div>
              <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-3">
                <span className="text-xs text-[#6B7280]">Total Supplier Payables</span>
                <span className="font-display text-base font-bold text-[#E60000] tabular-nums">
                  {formatGHS(suppliers.reduce((s, r) => s + Number(r.outstanding_balance), 0))}
                </span>
              </div>
              <div>
                <h3 className="text-xs font-bold mb-2">Shift Cash Discrepancies</h3>
                {discrepancies.length === 0 ? (
                  <p className="text-xs text-[#6B7280]">No shift cash shortages or surpluses in this period.</p>
                ) : (
                  <div className="space-y-1.5 text-xs">
                    {discrepancies.map((d) => (
                      <div key={d.id} className="flex justify-between">
                        <span>{d.cashiers?.full_name} ({d.shift_ref})</span>
                        <span className={`font-bold tabular-nums ${Number(d.cash_discrepancy) < 0 ? 'text-[#E60000]' : 'text-amber-700'}`}>
                          {formatGHS(Number(d.cash_discrepancy))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const OwnerCashiersPage: React.FC = () => {
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [revealedPin, setRevealedPin] = useState<{ name: string; pin: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadCashiers = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('cashiers')
      .select('id, full_name, phone, status, failed_attempts, last_login_at, created_at')
      .order('created_at', { ascending: false });
    setCashiers((data as Cashier[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCashiers();
  }, [loadCashiers]);

  const handleCreateCashier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setError(null);
    setCreating(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setError('You must be signed in as the shop owner to register a cashier.');
        return;
      }

      const resp = await fetch('/api/owner/cashiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName, phone }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(json.error || 'Could not register cashier');
        return;
      }
      if (!json?.cashier?.full_name || !json?.generatedAccessCode) {
        setError('Cashier was created but the server response was incomplete. Please refresh and try again.');
        return;
      }
      setRevealedPin({ name: json.cashier.full_name, pin: json.generatedAccessCode });
      setFullName('');
      setPhone('');
      await loadCashiers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register cashier');
    } finally {
      setCreating(false);
    }
  };

  const handleCashierAction = async (id: string, name: string, action: 'reset_code' | 'suspend' | 'revoke' | 'activate') => {
    if (!supabase) return;
    setError(null);
    setActionLoading(`${id}:${action}`);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setError('You must be signed in as the shop owner.');
        return;
      }

      const resp = await fetch(`/api/owner/cashiers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(json.error || 'Action failed');
        return;
      }
      if (json.generatedAccessCode) {
        setRevealedPin({ name, pin: json.generatedAccessCode });
      }
      await loadCashiers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Cashier Management</h1>
        <p className="text-xs text-[#6B7280]">
          Register cashiers with unique cryptographically hashed 6-digit access codes (never stored in plaintext)
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      {revealedPin && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-emerald-900">
              6-Digit Access Code for {revealedPin.name}
            </p>
            <p className="text-xs text-emerald-800 mt-0.5">
              This code stays the cashier's login code until you reset it. Copy and share it securely now; for
              security it cannot be viewed again once dismissed.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-extrabold tracking-widest text-emerald-900 bg-white px-4 py-1.5 rounded-lg border border-emerald-200">
              {revealedPin.pin}
            </span>
            <button
              type="button"
              onClick={() => setRevealedPin(null)}
              className="text-xs font-semibold text-emerald-900 underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleCreateCashier} className="rounded-xl bg-white border border-[#E5E7EB] p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          type="text"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Cashier full name"
          className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs"
        />
        <input
          type="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telephone number"
          className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs"
        />
        <button
          type="submit"
          disabled={creating}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#E60000] px-4 py-2 text-xs font-semibold text-white hover:bg-[#cc0000] disabled:opacity-60 cursor-pointer"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}{' '}
          {creating ? 'Registering...' : 'Register Cashier & Generate Code'}
        </button>
      </form>

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading cashiers...</p>
        ) : cashiers.length === 0 ? (
          <p className="p-12 text-center text-xs text-[#6B7280]">No cashiers registered yet.</p>
        ) : (
          <div className="divide-y divide-[#E5E7EB]">
            {cashiers.map((c) => (
              <div key={c.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-bold text-sm text-[#1F2937]">{c.full_name}</p>
                  <p className="text-[#6B7280]">
                    {c.phone} · Status: <strong className="capitalize">{c.status}</strong>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={actionLoading === `${c.id}:reset_code`}
                    onClick={() => handleCashierAction(c.id, c.full_name, 'reset_code')}
                    className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-1.5 font-semibold hover:bg-[#F3F4F6] disabled:opacity-60 cursor-pointer"
                  >
                    {actionLoading === `${c.id}:reset_code` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E60000]" />
                    ) : (
                      <KeyRound className="h-3.5 w-3.5 text-[#E60000]" />
                    )}{' '}
                    Reset Code
                  </button>
                  {c.status === 'active' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCashierAction(c.id, c.full_name, 'suspend')}
                        className="rounded-lg border border-amber-300 px-3 py-1.5 font-semibold text-amber-800 hover:bg-amber-50 cursor-pointer"
                      >
                        Suspend
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCashierAction(c.id, c.full_name, 'revoke')}
                        className="rounded-lg border border-red-200 px-3 py-1.5 font-semibold text-[#E60000] hover:bg-red-50 cursor-pointer"
                      >
                        Revoke
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleCashierAction(c.id, c.full_name, 'activate')}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white cursor-pointer"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const OwnerShiftsPage: React.FC = () => {
  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase
      .from('cashier_shifts')
      .select('*, cashiers(full_name, phone)')
      .order('opened_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setShifts((data as unknown as CashierShift[]) || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Cashier Shifts & Drawer Reconciliation</h1>
        <p className="text-xs text-[#6B7280]">Complete shift opening/closing log with expected vs declared cash discrepancies</p>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading shifts...</p>
        ) : shifts.length === 0 ? (
          <p className="p-12 text-center text-xs text-[#6B7280]">No shifts recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Shift Ref</th>
                  <th className="text-left px-4 py-3 font-semibold">Cashier</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Opening</th>
                  <th className="text-right px-4 py-3 font-semibold">Expected</th>
                  <th className="text-right px-4 py-3 font-semibold">Declared</th>
                  <th className="text-right px-4 py-3 font-semibold">Diff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {shifts.map((sh) => (
                  <tr key={sh.id} className="hover:bg-[#F9FAFB]">
                    <td className="px-4 py-3 font-mono font-semibold">{sh.shift_ref}</td>
                    <td className="px-4 py-3">{sh.cashiers?.full_name}</td>
                    <td className="px-4 py-3 capitalize font-semibold">{sh.status}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatGHS(Number(sh.opening_cash))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {sh.expected_cash !== null ? formatGHS(Number(sh.expected_cash)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {sh.declared_cash !== null ? formatGHS(Number(sh.declared_cash)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">
                      {sh.cash_discrepancy !== null ? formatGHS(Number(sh.cash_discrepancy)) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const OwnerSmsPage: React.FC = () => {
  const [config, setConfig] = useState<SmsConfig | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSms = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [cfgRes, logRes] = await Promise.all([
      supabase.from('sms_configurations').select('*').limit(1).maybeSingle(),
      supabase.from('sms_logs').select('*').order('created_at', { ascending: false }).limit(50),
    ]);
    setConfig((cfgRes.data as unknown as SmsConfig) || null);
    setLogs(logRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSms();
  }, [loadSms]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !config) return;
    const { error } = await supabase
      .from('sms_configurations')
      .update({
        owner_phone: config.owner_phone,
        sender_id: config.sender_id,
        notify_shift_open: config.notify_shift_open,
        notify_shift_close: config.notify_shift_close,
        notify_expense: config.notify_expense,
        scheduled_enabled: config.scheduled_enabled,
        scheduled_frequency_days: config.scheduled_frequency_days,
        scheduled_destination_phone: config.scheduled_destination_phone,
        scheduled_sections: config.scheduled_sections,
      })
      .eq('id', config.id);
    setStatusMsg(error ? error.message : 'SMS configuration saved to Supabase.');
  };

  const handleTestSms = async () => {
    if (!supabase || !config?.owner_phone) return;
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch('/api/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token || ''}`,
      },
      body: JSON.stringify({
        recipientPhone: config.owner_phone,
        messageBody: 'Provision Shop SasuSync SMS integration test.',
      }),
    });
    const json = await res.json();
    setStatusMsg(json.delivered ? 'SMS dispatched via SasuSync.' : `SMS blocked/failed: ${json.error || json.status}`);
    await loadSms();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">SasuSync SMS & Scheduled Reports</h1>
        <p className="text-xs text-[#6B7280]">
          Configure real-time shift/expense alerts and cloud-scheduled 5-day or 7-day SMS business reports
        </p>
      </div>

      {statusMsg && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">{statusMsg}</div>}

      {config && (
        <form onSubmit={handleSaveConfig} className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold mb-1">Scheduled Report Frequency</label>
              <select
                value={config.scheduled_frequency_days}
                onChange={(e) => setConfig({ ...config, scheduled_frequency_days: Number(e.target.value) as 5 | 7 })}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
              >
                <option value={5}>Every 5 Days</option>
                <option value={7}>Every 7 Days</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#E5E7EB]">
            <div className="space-y-2">
              <p className="font-bold">Event Notifications</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={config.notify_shift_open} onChange={(e) => setConfig({ ...config, notify_shift_open: e.target.checked })} className="accent-[#E60000]" />
                Shift Opening SMS
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={config.notify_shift_close} onChange={(e) => setConfig({ ...config, notify_shift_close: e.target.checked })} className="accent-[#E60000]" />
                Shift Closing Reconciliation SMS
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={config.notify_expense} onChange={(e) => setConfig({ ...config, notify_expense: e.target.checked })} className="accent-[#E60000]" />
                Expense Submission SMS
              </label>
            </div>

            <div className="space-y-2">
              <p className="font-bold">Cloud Scheduled Report</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={config.scheduled_enabled} onChange={(e) => setConfig({ ...config, scheduled_enabled: e.target.checked })} className="accent-[#E60000]" />
                Enable Cloud Scheduled SMS Reports
              </label>
              <input
                type="tel"
                value={config.scheduled_destination_phone}
                onChange={(e) => setConfig({ ...config, scheduled_destination_phone: e.target.value })}
                placeholder="Scheduled destination phone"
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-[#E60000] px-4 py-2 font-semibold text-white cursor-pointer">
              <Save className="h-4 w-4" /> Save SMS Settings
            </button>

          </div>
        </form>
      )}

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E5E7EB] font-display text-sm font-bold">SMS Delivery Log</div>
        {loading ? (
          <p className="p-8 text-center text-xs text-[#6B7280]">Loading SMS logs...</p>
        ) : logs.length === 0 ? (
          <p className="p-8 text-center text-xs text-[#6B7280]">No SMS attempts recorded yet.</p>
        ) : (
          <div className="divide-y divide-[#E5E7EB] text-xs">
            {logs.map((l) => (
              <div key={l.id} className="p-3.5 flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-semibold">{l.event_type.replace('_', ' ')} → {l.recipient_phone}</p>
                  <p className="text-[#4B5563] mt-0.5">{l.message_body}</p>
                  {l.error_message && (
                    <p className={l.status === 'sent' ? 'text-[#4B5563] mt-0.5' : 'text-[#E60000] mt-0.5'}>
                      {l.error_message}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span className="font-bold uppercase">{l.status}</span>
                  <p className="text-[#6B7280] tabular-nums">{new Date(l.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const OwnerSettingsPage: React.FC<{ onSettingsUpdated?: () => void }> = ({ onSettingsUpdated }) => {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('shop_settings')
      .select('*')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setSettings((data as unknown as ShopSettings) || null));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !settings) return;
    const { error } = await supabase
      .from('shop_settings')
      .update({
        shop_name: settings.shop_name,
        tagline: settings.tagline,
        phone: settings.phone,
        address: settings.address,
        receipt_header: settings.receipt_header,
        receipt_footer: settings.receipt_footer,
        thermal_paper_width: settings.thermal_paper_width,
        max_cashier_discount_pct: Number(settings.max_cashier_discount_pct),
        refund_payment_policy: settings.refund_payment_policy,
        moolre_enabled: settings.moolre_enabled,
      })
      .eq('id', settings.id);

    setSavedMsg(error ? error.message : 'Shop settings saved.');
    if (!error && onSettingsUpdated) onSettingsUpdated();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2937]">Shop Settings</h1>
          <p className="text-xs text-[#6B7280]">Configure shop profile, thermal receipts, cashier discount limits, and PWA installation</p>
        </div>
        <PWAInstallButton />
      </div>

      {savedMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{savedMsg}</div>}

      {settings ? (
        <form onSubmit={handleSave} className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold mb-1">Shop Name</label>
              <input
                type="text"
                required
                value={settings.shop_name}
                onChange={(e) => setSettings({ ...settings, shop_name: e.target.value })}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Shop Phone</label>
              <input
                type="tel"
                value={settings.phone || ''}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block font-semibold mb-1">Shop Address</label>
            <input
              type="text"
              value={settings.address || ''}
              onChange={(e) => setSettings({ ...settings, address: e.target.value })}
              className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold mb-1">Thermal Paper Width</label>
              <select
                value={settings.thermal_paper_width}
                onChange={(e) => setSettings({ ...settings, thermal_paper_width: e.target.value as '58mm' | '80mm' })}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
              >
                <option value="80mm">80mm</option>
                <option value="58mm">58mm</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Max Cashier Discount (%)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={settings.max_cashier_discount_pct}
                onChange={(e) => setSettings({ ...settings, max_cashier_discount_pct: Number(e.target.value) })}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Refund Payout Policy</label>
              <select
                value={settings.refund_payment_policy}
                onChange={(e) => setSettings({ ...settings, refund_payment_policy: e.target.value as any })}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
              >
                <option value="unconfigured">Owner Confirms Per Refund</option>
                <option value="cash_only">Cash Drawer Only</option>
                <option value="match_original_or_cash">Match Original or Cash</option>
                <option value="owner_selected">Owner Selected Payout</option>
              </select>
            </div>
          </div>
          <button type="submit" className="rounded-lg bg-[#E60000] px-5 py-2.5 text-sm font-semibold text-white cursor-pointer">
            Save Shop Settings
          </button>
        </form>
      ) : (
        <p className="text-xs text-[#6B7280]">Sign in as the shop owner with a configured Supabase database to manage settings.</p>
      )}
    </div>
  );
};

export const OwnerHardwarePage: React.FC = () => {
  const [cfg, setCfg] = useState(() => loadBridgeConfig());
  const [baseUrl, setBaseUrl] = useState(cfg?.baseUrl || 'http://127.0.0.1:8787');
  const [token, setToken] = useState(cfg?.token || '');
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [manualReason, setManualReason] = useState('');

  const refreshHealth = async () => {
    if (!cfg) {
      setHealth(null);
      return;
    }
    const h = await checkBridgeHealth(cfg);
    setHealth(h);
  };

  useEffect(() => {
    refreshHealth();
  }, [cfg]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrl.trim() || !token.trim()) {
      setMsg('Bridge URL and pairing token are required.');
      return;
    }
    const next = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), token: token.trim() };
    saveBridgeConfig(next);
    setCfg(next);
    setMsg('Hardware bridge configuration saved.');
  };

  const handleClear = () => {
    clearBridgeConfig();
    setCfg(null);
    setHealth(null);
    setMsg('Hardware bridge configuration cleared.');
  };

  const handleTestPrint = async () => {
    if (!cfg) return;
    setTesting(true);
    const r = await testPrint(cfg);
    setMsg(r.ok ? 'Test receipt sent to printer.' : `Test print failed: ${r.error}`);
    setTesting(false);
  };

  const handleTestDrawer = async () => {
    if (!cfg) return;
    setTesting(true);
    const r = await testDrawer(cfg);
    setMsg(r.ok ? 'Drawer kick command sent.' : `Drawer test failed: ${r.error}`);
    setTesting(false);
  };

  const handleManualDrawerOpen = async () => {
    if (!cfg) return;
    if (!supabase) {
      setMsg('Supabase not configured.');
      return;
    }
    const { data: sess } = await supabase.auth.getSession();
    const ownerId = sess.session?.user?.id;
    if (!ownerId) {
      setMsg('Owner authentication required.');
      return;
    }
    const reason = manualReason.trim();
    if (!reason) {
      setMsg('A reason is required for manual drawer opening.');
      return;
    }
    setTesting(true);
    const r = await testDrawer(cfg);
    // Audit log the manual opening attempt (server-side via supabase RLS as owner)
    await supabase.from('audit_logs').insert({
      actor_type: 'owner',
      actor_id: ownerId,
      actor_name: (sess.session?.user?.email as string) || 'Owner',
      action: 'MANUAL_DRAWER_OPEN',
      entity_type: 'hardware',
      entity_id: null,
      details: { reason, result: r.ok ? 'success' : 'failed', error: r.error || null },
    });
    setMsg(r.ok ? 'Manual drawer open triggered and audit-logged.' : `Manual drawer open failed: ${r.error}`);
    setManualReason('');
    setTesting(false);
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">POS Hardware</h1>
        <p className="text-xs text-[#6B7280]">
          Configure the local hardware bridge, thermal printer, cash drawer, and barcode scanner.
        </p>
      </div>

      {msg && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">{msg}</div>}

      <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-[#E60000]" />
          <h2 className="font-display text-sm font-bold">Local Hardware Bridge</h2>
        </div>
        <p className="text-xs text-[#6B7280]">
          The bridge runs on the cashier's computer and is the only component that accesses the printer and drawer.
          Status:{' '}
          <strong>{cfg ? (health?.ok ? 'Connected' : 'Unreachable') : 'Not configured'}</strong>
          {health?.message ? ` — ${health.message}` : ''}
        </p>

        <form onSubmit={handleSave} className="space-y-3 text-xs">
          <div>
            <label className="block font-semibold mb-1">Bridge Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:8787"
              className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Pairing Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token printed by the bridge on first run"
              className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-lg bg-[#E60000] px-4 py-2 text-xs font-semibold text-white">
              Save Bridge Config
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-semibold"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={refreshHealth}
              className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-semibold"
            >
              Re-check
            </button>
          </div>
        </form>

        {health && (
          <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 text-xs space-y-1">
            <p>Bridge version: {health.version || '—'}</p>
            <p>Printer configured: {health.printerConfigured ? 'Yes' : 'No'}</p>
            <p>Printer connected: {health.printerConnected ? 'Yes' : 'No'}</p>
            <p>Drawer supported: {health.drawerSupported ? 'Yes' : 'No'}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Printer className="h-5 w-5 text-[#E60000]" />
          <h2 className="font-display text-sm font-bold">Thermal Printer</h2>
        </div>
        <p className="text-xs text-[#6B7280]">
          Paper width is configured in Shop Settings. Use the bridge diagnostics to verify printing.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!cfg || testing}
            onClick={handleTestPrint}
            className="rounded-lg bg-[#E60000] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Test Receipt Print
          </button>
          <button
            type="button"
            disabled={!cfg || testing}
            onClick={handleTestDrawer}
            className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Test Drawer Kick
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 text-[#E60000]" />
          <h2 className="font-display text-sm font-bold">Cash Drawer</h2>
        </div>
        <p className="text-xs text-[#6B7280]">
          The drawer is kicked through the printer's drawer-kick port after a completed sale that contains a cash
          payment. Manual opening requires owner authorization and is audit-logged. Drawer status is reported as
          unverified unless the bridge reports real status support.
        </p>
        <div className="space-y-2 pt-2 border-t border-[#E5E7EB]">
          <label className="block text-xs font-semibold">Manual Open Reason (required)</label>
          <input
            type="text"
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value)}
            placeholder="e.g. Cash count / reconciliation"
            className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={!cfg || testing}
            onClick={handleManualDrawerOpen}
            className="rounded-lg border border-[#E5E7EB] px-4 py-2 text-xs font-semibold disabled:opacity-50"
          >
            Manually Open Drawer (Owner Only)
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ScanBarcode className="h-5 w-5 text-[#E60000]" />
          <h2 className="font-display text-sm font-bold">Barcode Scanner</h2>
        </div>
        <p className="text-xs text-[#6B7280]">
          Keyboard-wedge USB scanners are supported. The POS detects rapid keystroke bursts terminated by Enter and
          looks up the barcode in the product database. Normal typing in input fields is never intercepted. The
          browser cannot verify physical scanner connection; if scans do not appear, check the scanner's USB
          connection and configured suffix.
        </p>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-2">
        <h2 className="font-display text-sm font-bold">Hardware Diagnostics</h2>
        <p className="text-xs text-[#6B7280]">
          1. Local hardware bridge availability — {cfg ? (health?.ok ? 'OK' : 'FAIL') : 'NOT CONFIGURED'}.
        </p>
        <p className="text-xs text-[#6B7280]">
          2. Printer availability — {health?.printerConnected ? 'OK' : 'NOT VERIFIED'}.
        </p>
        <p className="text-xs text-[#6B7280]">
          3. Test receipt printing — use "Test Receipt Print".
        </p>
        <p className="text-xs text-[#6B7280]">
          4. Drawer kick capability — {health?.drawerSupported ? 'SUPPORTED' : 'NOT VERIFIED'}.
        </p>
        <p className="text-xs text-[#6B7280]">
          5. Barcode scanner — keyboard-wedge mode; see instructions above.
        </p>
      </div>
    </div>
  );
};
