import React, { useCallback, useEffect, useState } from 'react';
import { Printer, Eye, FileSpreadsheet, FileText, X, Ban } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatGHS } from '../../lib/posCalculations';
import { exportStorebookToExcel, exportStorebookToPdf } from '../../lib/exportUtils';
import type { ExpenseRecord, Product, ReceiptSnapshot, SaleRecord, ShopSettings, StockMovementRecord } from '../../types/database';
import { ReceiptModal } from '../../components/ReceiptModal';

export const OwnerSalesHistoryPage: React.FC = () => {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [shop, setShop] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reprintData, setReprintData] = useState<{ receiptId: string; snapshot: ReceiptSnapshot } | null>(null);

  const loadSales = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [sRes, shopRes] = await Promise.all([
      supabase
        .from('sales')
        .select('*, cashiers(full_name), payments(method, network, amount, status), receipts(id, snapshot_json, reprint_count)')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('shop_settings').select('*').limit(1).maybeSingle(),
    ]);
    setSales((sRes.data as unknown as SaleRecord[]) || []);
    setShop((shopRes.data as unknown as ShopSettings) || null);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const handleOpenReprint = (sale: any) => {
    const rcp = Array.isArray(sale.receipts) ? sale.receipts[0] : sale.receipts;
    if (rcp?.snapshot_json) {
      setReprintData({ receiptId: rcp.id, snapshot: rcp.snapshot_json });
    }
  };

  const logReprint = async () => {
    if (!supabase || !reprintData) return;
    const { data: sess } = await supabase.auth.getSession();
    await supabase
      .from('receipts')
      .update({
        last_reprinted_at: new Date().toISOString(),
        last_reprinted_by: sess.session?.user?.id || null,
      })
      .eq('id', reprintData.receiptId);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Sales History & Owner Reprints</h1>
        <p className="text-xs text-[#6B7280]">Reprinting historical receipts is restricted exclusively to the shop owner</p>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading sales history...</p>
        ) : sales.length === 0 ? (
          <p className="p-12 text-center text-xs text-[#6B7280]">No sales recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Receipt #</th>
                  <th className="text-left px-4 py-3 font-semibold">Date & Time</th>
                  <th className="text-left px-4 py-3 font-semibold">Cashier</th>
                  <th className="text-left px-4 py-3 font-semibold">Payment</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Total</th>
                  <th className="text-right px-4 py-3 font-semibold">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {sales.map((s: any) => (
                  <tr key={s.id} className="hover:bg-[#F9FAFB]">
                    <td className="px-4 py-3 font-mono font-semibold">{s.receipt_number}</td>
                    <td className="px-4 py-3 tabular-nums text-[#6B7280]">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">{s.cashiers?.full_name || 'Shop Owner'}</td>
                    <td className="px-4 py-3 uppercase">
                      {(s.payments || [])
                        .filter((p: any) => p.status === 'successful')
                        .map((p: any) => p.method)
                        .join(' + ') || 'Pending'}
                    </td>
                    <td className="px-4 py-3 capitalize font-semibold">{s.payment_status}</td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{formatGHS(Number(s.total_amount))}</td>
                    <td className="px-4 py-3 text-right">
                      {s.receipts && (
                        <button
                          type="button"
                          onClick={() => handleOpenReprint(s)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-2.5 py-1 text-[11px] font-semibold hover:bg-[#F3F4F6] cursor-pointer"
                        >
                          <Printer className="h-3 w-3 text-[#E60000]" /> Reprint
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reprintData && (
        <ReceiptModal
          receipt={reprintData.snapshot}
          shop={shop}
          mode="owner_reprint"
          onClose={() => setReprintData(null)}
          onReprintLogged={logReprint}
        />
      )}
    </div>
  );
};

export const OwnerExpensesPage: React.FC = () => {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadExpenses = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from('expenses')
      .select('*, cashiers(full_name), cashier_shifts(shift_ref)')
      .order('created_at', { ascending: false });
    if (qErr) setError(qErr.message);
    setExpenses((data as unknown as ExpenseRecord[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const handleViewEvidence = async (path: string) => {
    if (!supabase) return;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) return;
    const res = await fetch(`/api/owner/signed-url?bucket=expense-evidence&path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (res.ok && json.signedUrl) {
      setPreviewUrl(json.signedUrl);
    } else {
      setError(json.error || 'Could not load private expense evidence');
    }
  };

  const handleVoidExpense = async (expenseId: string) => {
    if (!supabase) return;
    const { data: sess } = await supabase.auth.getSession();
    await supabase
      .from('expenses')
      .update({
        status: 'voided',
        void_reason: 'Voided by shop owner',
        voided_by: sess.session?.user?.id || null,
        voided_at: new Date().toISOString(),
      })
      .eq('id', expenseId);
    await loadExpenses();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Expenses & QR Evidence</h1>
        <p className="text-xs text-[#6B7280]">Cashier expenses submitted via single-use QR codes with private Supabase Storage receipts</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading expenses...</p>
        ) : expenses.length === 0 ? (
          <p className="p-12 text-center text-xs text-[#6B7280]">No expenses recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Ref</th>
                  <th className="text-left px-4 py-3 font-semibold">Expense</th>
                  <th className="text-left px-4 py-3 font-semibold">Source</th>
                  <th className="text-left px-4 py-3 font-semibold">Cashier / Shift</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount</th>
                  <th className="text-right px-4 py-3 font-semibold">Evidence / Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {expenses.map((exp) => (
                  <tr key={exp.id} className={exp.status === 'voided' ? 'opacity-50 bg-[#F9FAFB]' : 'hover:bg-[#F9FAFB]'}>
                    <td className="px-4 py-3 font-mono font-semibold">{exp.expense_ref}</td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-[#1F2937]">{exp.expense_name}</p>
                      <p className="text-[11px] text-[#6B7280]">{exp.category_name}</p>
                    </td>
                    <td className="px-4 py-3 capitalize">{exp.payment_source.replace('_', ' ')}</td>
                    <td className="px-4 py-3">
                      {exp.cashiers?.full_name || 'Owner'} · <span className="font-mono">{exp.cashier_shifts?.shift_ref || '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-[#E60000]">
                      {formatGHS(Number(exp.amount))}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {exp.evidence_path && (
                        <button
                          type="button"
                          onClick={() => handleViewEvidence(exp.evidence_path!)}
                          className="inline-flex items-center gap-1 rounded border border-[#E5E7EB] px-2.5 py-1 font-semibold hover:bg-[#F3F4F6] cursor-pointer"
                        >
                          <Eye className="h-3 w-3" /> Receipt
                        </button>
                      )}
                      {exp.status === 'recorded' && (
                        <button
                          type="button"
                          onClick={() => handleVoidExpense(exp.id)}
                          className="inline-flex items-center gap-1 text-[#6B7280] hover:text-[#E60000] cursor-pointer"
                        >
                          <Ban className="h-3 w-3" /> Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="font-display text-sm font-bold">Expense Evidence Receipt</h3>
              <button type="button" onClick={() => setPreviewUrl(null)}><X className="h-4 w-4" /></button>
            </div>
            <img src={previewUrl} alt="Uploaded expense receipt evidence" className="max-h-[70vh] w-full object-contain rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
};

export const OwnerStorebookPage: React.FC = () => {
  const [movements, setMovements] = useState<StockMovementRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const loadLedger = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let q = supabase
      .from('stock_movements')
      .select('*, products(name, measurement_units(code))')
      .order('created_at', { ascending: false })
      .limit(200);
    if (productId) q = q.eq('product_id', productId);
    if (movementType) q = q.eq('movement_type', movementType);

    const [movRes, prodRes] = await Promise.all([
      q,
      supabase.from('products').select('id, name').order('name'),
    ]);
    setMovements((movRes.data as unknown as StockMovementRecord[]) || []);
    setProducts((prodRes.data as unknown as Product[]) || []);
    setLoading(false);
  }, [productId, movementType]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const filtered = movements.filter((m) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      m.transaction_ref.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      (m.products?.name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2937]">Storebook — Stock Movement Ledger</h1>
          <p className="text-xs text-[#6B7280]">Immutable chronological audit ledger generated automatically by inventory operations</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => exportStorebookToExcel(filtered)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-xs font-semibold hover:bg-[#F3F4F6] disabled:opacity-50 cursor-pointer"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" /> Export Excel
          </button>
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => exportStorebookToPdf(filtered)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#E60000] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#cc0000] disabled:opacity-50 cursor-pointer"
          >
            <FileText className="h-4 w-4" /> Export PDF
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] p-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ref, product, or description..."
          className="rounded-lg border border-[#E5E7EB] px-3 py-2"
        />
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
        >
          <option value="">All Products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={movementType}
          onChange={(e) => setMovementType(e.target.value)}
          className="rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
        >
          <option value="">All Movement Types</option>
          <option value="opening_stock">Opening Stock</option>
          <option value="purchase_received">Purchase Received</option>
          <option value="sale">Sale</option>
          <option value="approved_return">Approved Return</option>
          <option value="damaged_stock">Damaged Stock</option>
          <option value="expired_stock">Expired Stock</option>
          <option value="stock_adjustment">Stock Adjustment</option>
        </select>
      </div>

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading Storebook ledger...</p>
        ) : filtered.length === 0 ? (
          <p className="p-12 text-center text-xs text-[#6B7280]">No stock movements recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Date & Time</th>
                  <th className="text-left px-4 py-3 font-semibold">Product</th>
                  <th className="text-left px-4 py-3 font-semibold">Ref</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-left px-4 py-3 font-semibold">Description</th>
                  <th className="text-right px-4 py-3 font-semibold">In</th>
                  <th className="text-right px-4 py-3 font-semibold">Out</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  <th className="text-left px-4 py-3 font-semibold">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F9FAFB]">
                    <td className="px-4 py-2.5 tabular-nums text-[#6B7280] whitespace-nowrap">
                      {new Date(m.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-semibold">{m.products?.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px]">{m.transaction_ref}</td>
                    <td className="px-4 py-2.5 capitalize">{m.movement_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2.5 text-[#4B5563]">{m.description}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-700 tabular-nums">
                      {Number(m.stock_in) > 0 ? `+${Number(m.stock_in)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#E60000] tabular-nums">
                      {Number(m.stock_out) > 0 ? `-${Number(m.stock_out)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {Number(m.running_balance)} {m.products?.measurement_units?.code || ''}
                    </td>
                    <td className="px-4 py-2.5">{m.actor_name}</td>
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
