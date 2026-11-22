import React, { useCallback, useEffect, useState } from 'react';
import { Plus, CheckCircle2, Truck, Banknote, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatGHS } from '../../lib/posCalculations';
import type { Product, Supplier } from '../../types/database';

interface PurchaseRow {
  id: string;
  purchase_number: string;
  supplier_id: string;
  invoice_reference: string | null;
  purchase_date: string;
  status: 'draft' | 'ordered' | 'received' | 'cancelled';
  total_amount: number;
  amount_paid: number;
  outstanding_balance: number;
  received_at: string | null;
  suppliers?: { name: string };
  purchase_items?: Array<{
    id: string;
    product_id: string;
    purchase_unit_name: string;
    quantity_in_purchase_unit: number;
    conversion_to_base: number;
    base_quantity: number;
    unit_cost_per_purchase_unit: number;
    line_total: number;
    products?: { name: string };
  }>;
}

export const OwnerPurchasesPage: React.FC = () => {
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [supplierId, setSupplierId] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amountPaid, setAmountPaid] = useState('0');
  const [draftItems, setDraftItems] = useState<
    Array<{ productId: string; unitName: string; factor: number; qty: number; unitCost: number }>
  >([]);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [purRes, supRes, prodRes] = await Promise.all([
      supabase
        .from('purchases')
        .select('*, suppliers(name), purchase_items(*, products(name))')
        .order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').eq('is_active', true).order('name'),
      supabase.from('products').select('*, measurement_units(*), product_unit_conversions(*)').eq('is_archived', false).order('name'),
    ]);
    setPurchases((purRes.data as unknown as PurchaseRow[]) || []);
    setSuppliers((supRes.data as Supplier[]) || []);
    setProducts((prodRes.data as unknown as Product[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addDraftLine = () => {
    if (!products.length) return;
    const first = products[0];
    setDraftItems((prev) => [
      ...prev,
      {
        productId: first.id,
        unitName: first.measurement_units?.code || 'unit',
        factor: 1,
        qty: 1,
        unitCost: Number(first.purchase_cost || 0),
      },
    ]);
  };

  const handleCreatePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !supplierId || draftItems.length === 0) {
      setError('Select a supplier and add at least one purchase item.');
      return;
    }
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const ownerId = sess.session?.user?.id;
      const total = draftItems.reduce((s, i) => s + i.qty * i.unitCost, 0);
      const purNo = `PUR-${Date.now().toString().slice(-6)}`;

      const { data: created, error: purErr } = await supabase
        .from('purchases')
        .insert({
          purchase_number: purNo,
          supplier_id: supplierId,
          invoice_reference: invoiceRef.trim() || null,
          purchase_date: purchaseDate,
          status: 'ordered',
          total_amount: Math.round(total * 100) / 100,
          amount_paid: Math.min(total, Number(amountPaid) || 0),
          created_by: ownerId,
        })
        .select('id')
        .single();
      if (purErr) throw purErr;

      const { error: itemErr } = await supabase.from('purchase_items').insert(
        draftItems.map((d) => ({
          purchase_id: created.id,
          product_id: d.productId,
          purchase_unit_name: d.unitName,
          quantity_in_purchase_unit: d.qty,
          conversion_to_base: d.factor,
          unit_cost_per_purchase_unit: d.unitCost,
        }))
      );
      if (itemErr) throw itemErr;

      setShowCreate(false);
      setDraftItems([]);
      setInvoiceRef('');
      setAmountPaid('0');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create purchase');
    }
  };

  const handleReceivePurchase = async (purchaseId: string) => {
    if (!supabase) return;
    setError(null);
    const { data: sess } = await supabase.auth.getSession();
    const ownerId = sess.session?.user?.id;
    if (!ownerId) return;

    const { error: rpcErr } = await supabase.rpc('fn_receive_purchase', {
      p_purchase_id: purchaseId,
      p_owner_id: ownerId,
    });
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    await loadData();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2937]">Purchases & Stock Receiving</h1>
          <p className="text-xs text-[#6B7280]">
            Inventory only increases after you explicitly confirm a purchase as received
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSupplierId(suppliers[0]?.id || '');
            setShowCreate(true);
            if (draftItems.length === 0) addDraftLine();
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-[#E60000] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
        >
          <Plus className="h-4 w-4" /> New Purchase Order
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs text-[#6B7280]">Loading purchases...</p>
        ) : purchases.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-bold text-[#1F2937]">No purchases recorded yet</p>
            <p className="text-xs text-[#6B7280] mt-1">Register a supplier first, then create a purchase order to receive stock.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-[#6B7280]">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Purchase #</th>
                  <th className="text-left px-4 py-3 font-semibold">Supplier</th>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Total</th>
                  <th className="text-right px-4 py-3 font-semibold">Paid</th>
                  <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  <th className="text-right px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {purchases.map((pur) => (
                  <tr key={pur.id} className="hover:bg-[#F9FAFB]">
                    <td className="px-4 py-3 font-mono font-semibold">{pur.purchase_number}</td>
                    <td className="px-4 py-3">{pur.suppliers?.name || '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{pur.purchase_date}</td>
                    <td className="px-4 py-3 capitalize font-semibold">
                      <span className={pur.status === 'received' ? 'text-emerald-700' : 'text-amber-700'}>
                        {pur.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatGHS(Number(pur.total_amount))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatGHS(Number(pur.amount_paid))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[#E60000] tabular-nums">
                      {formatGHS(Number(pur.outstanding_balance))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {pur.status !== 'received' && pur.status !== 'cancelled' ? (
                        <button
                          type="button"
                          onClick={() => handleReceivePurchase(pur.id)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#E60000] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Received
                        </button>
                      ) : (
                        <span className="text-[#6B7280] text-[11px]">
                          {pur.received_at ? `Received ${new Date(pur.received_at).toLocaleDateString()}` : pur.status}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-2">
              <h3 className="font-display text-base font-bold">New Purchase Order</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="p-1 text-[#6B7280]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePurchase} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Supplier</label>
                  <select
                    required
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
                  >
                    <option value="">Select supplier...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Invoice Ref</label>
                  <input
                    type="text"
                    value={invoiceRef}
                    onChange={(e) => setInvoiceRef(e.target.value)}
                    placeholder="Supplier invoice #"
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Purchase Date</label>
                  <input
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Line Items</span>
                  <button type="button" onClick={addDraftLine} className="text-[#E60000] font-semibold">
                    + Add Product Line
                  </button>
                </div>
                {draftItems.map((line, idx) => {
                  const prod = products.find((p) => p.id === line.productId);
                  const purchaseUnits = prod?.product_unit_conversions?.filter((c) => c.is_purchase_unit) || [];
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center border border-[#E5E7EB] rounded-lg p-2">
                      <select
                        value={line.productId}
                        onChange={(e) => {
                          const np = products.find((p) => p.id === e.target.value);
                          setDraftItems((prev) =>
                            prev.map((row, rIdx) =>
                              rIdx === idx
                                ? { ...row, productId: e.target.value, unitName: np?.measurement_units?.code || 'unit', factor: 1 }
                                : row
                            )
                          );
                        }}
                        className="col-span-4 rounded border border-[#E5E7EB] px-2 py-1.5 bg-white"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <select
                        value={`${line.unitName}::${line.factor}`}
                        onChange={(e) => {
                          const [uName, fac] = e.target.value.split('::');
                          setDraftItems((prev) =>
                            prev.map((row, rIdx) => (rIdx === idx ? { ...row, unitName: uName, factor: Number(fac) } : row))
                          );
                        }}
                        className="col-span-3 rounded border border-[#E5E7EB] px-2 py-1.5 bg-white"
                      >
                        <option value={`${prod?.measurement_units?.code || 'unit'}::1`}>
                          {prod?.measurement_units?.code || 'Base'} (x1)
                        </option>
                        {purchaseUnits.map((u) => (
                          <option key={u.id} value={`${u.unit_name}::${u.conversion_to_base}`}>
                            {u.unit_name} (x{u.conversion_to_base})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={line.qty}
                        onChange={(e) =>
                          setDraftItems((prev) => prev.map((r, i) => (i === idx ? { ...r, qty: Number(e.target.value) } : r)))
                        }
                        placeholder="Qty"
                        className="col-span-2 rounded border border-[#E5E7EB] px-2 py-1.5 tabular-nums"
                      />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={line.unitCost}
                        onChange={(e) =>
                          setDraftItems((prev) => prev.map((r, i) => (i === idx ? { ...r, unitCost: Number(e.target.value) } : r)))
                        }
                        placeholder="Cost"
                        className="col-span-2 rounded border border-[#E5E7EB] px-2 py-1.5 tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => setDraftItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="col-span-1 text-[#E60000] font-bold"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between border-t border-[#E5E7EB] pt-3">
                <div>
                  <label className="block font-semibold mb-1">Amount Paid Now (GH₵)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amountPaid}
                    onChange={(e) => setAmountPaid(e.target.value)}
                    className="w-36 rounded-lg border border-[#E5E7EB] px-3 py-1.5 tabular-nums"
                  />
                </div>
                <div className="text-right">
                  <span className="text-[#6B7280]">Order Total</span>
                  <p className="font-display text-lg font-bold text-[#1F2937] tabular-nums">
                    {formatGHS(draftItems.reduce((s, i) => s + i.qty * i.unitCost, 0))}
                  </p>
                </div>
              </div>

              <button type="submit" className="w-full rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white">
                Save Purchase Order
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export const OwnerSuppliersPage: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [paySupplier, setPaySupplier] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'momo' | 'bank_transfer'>('cash');
  const [payNotes, setPayNotes] = useState('');

  const loadSuppliers = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [sRes, pRes] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_payments').select('*, suppliers(name)').order('created_at', { ascending: false }).limit(25),
    ]);
    setSuppliers((sRes.data as Supplier[]) || []);
    setPayments(pRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !name.trim() || !phone.trim()) return;
    const { error: insErr } = await supabase.from('suppliers').insert({
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim() || null,
    });
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setName('');
    setPhone('');
    setAddress('');
    await loadSuppliers();
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !paySupplier) return;
    const { data: sess } = await supabase.auth.getSession();
    const ownerId = sess.session?.user?.id;
    if (!ownerId) return;

    const { error: rpcErr } = await supabase.rpc('fn_record_supplier_payment', {
      p_supplier_id: paySupplier.id,
      p_purchase_id: null,
      p_amount: Number(payAmount),
      p_payment_method: payMethod,
      p_notes: payNotes.trim() || null,
      p_owner_id: ownerId,
    });
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }
    setPaySupplier(null);
    setPayAmount('');
    setPayNotes('');
    await loadSuppliers();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Suppliers & Payable Balances</h1>
        <p className="text-xs text-[#6B7280]">Manage supplier contacts, balances, and payment history separately from stock movements</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

      <form onSubmit={handleAddSupplier} className="rounded-xl bg-white border border-[#E5E7EB] p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Supplier name"
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
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Address (optional)"
          className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs"
        />
        <button type="submit" className="rounded-lg bg-[#E60000] px-4 py-2 text-xs font-semibold text-white hover:bg-[#cc0000] cursor-pointer">
          Register Supplier
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E7EB] font-display text-sm font-bold flex items-center gap-2">
            <Truck className="h-4 w-4 text-[#E60000]" /> Registered Suppliers
          </div>
          {loading ? (
            <p className="p-8 text-center text-xs text-[#6B7280]">Loading suppliers...</p>
          ) : suppliers.length === 0 ? (
            <p className="p-8 text-center text-xs text-[#6B7280]">No suppliers added yet.</p>
          ) : (
            <div className="divide-y divide-[#E5E7EB]">
              {suppliers.map((s) => (
                <div key={s.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-bold text-[#1F2937] text-sm">{s.name}</p>
                    <p className="text-[#6B7280]">{s.phone} {s.address ? `· ${s.address}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-[11px] text-[#6B7280]">Balance Due</p>
                      <p className="font-bold text-sm text-[#E60000] tabular-nums">{formatGHS(Number(s.outstanding_balance))}</p>
                    </div>
                    {Number(s.outstanding_balance) > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPaySupplier(s);
                          setPayAmount(String(s.outstanding_balance));
                        }}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#1F2937] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                      >
                        <Banknote className="h-3.5 w-3.5" /> Pay
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E5E7EB] font-display text-sm font-bold">Supplier Payment History</div>
          {payments.length === 0 ? (
            <p className="p-8 text-center text-xs text-[#6B7280]">No supplier payments recorded yet.</p>
          ) : (
            <div className="divide-y divide-[#E5E7EB] text-xs">
              {payments.map((p) => (
                <div key={p.id} className="p-3.5 flex justify-between">
                  <div>
                    <p className="font-semibold text-[#1F2937]">{p.suppliers?.name}</p>
                    <p className="text-[#6B7280] font-mono">{p.payment_reference} · {p.payment_method}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums">{formatGHS(Number(p.amount))}</p>
                    <p className="text-[11px] text-[#6B7280]">{p.payment_date}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {paySupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-3">
            <div className="flex justify-between items-center border-b border-[#E5E7EB] pb-2">
              <h3 className="font-display text-base font-bold">Pay {paySupplier.name}</h3>
              <button type="button" onClick={() => setPaySupplier(null)}><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Amount (Max {formatGHS(Number(paySupplier.outstanding_balance))})</label>
                <input
                  type="number"
                  step="0.01"
                  max={paySupplier.outstanding_balance}
                  min="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as any)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 bg-white"
                >
                  <option value="cash">Cash</option>
                  <option value="momo">Mobile Money</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Notes</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2"
                />
              </div>
              <button type="submit" className="w-full rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white">
                Record Supplier Payment
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
