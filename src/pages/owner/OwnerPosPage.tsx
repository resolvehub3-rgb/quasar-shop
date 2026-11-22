import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ScanBarcode, Camera, Plus, Minus, Trash2, Banknote, Smartphone, Split } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import type { Product, ReceiptSnapshot, ShopSettings } from '../../types/database';
import { calculateCartTotals, calculateCashChange, formatGHS } from '../../lib/posCalculations';
import { computeBaseQuantity, computeUnitPrice } from '../../lib/inventoryMath';
import { ReceiptModal } from '../../components/ReceiptModal';
import { CameraBarcodeScannerModal } from '../../components/CameraBarcodeScannerModal';

interface OwnerCartItem {
  key: string;
  product: Product;
  conversionId: string | null;
  unitName: string;
  conversionToBase: number;
  unitPrice: number;
  quantity: number;
  allowDecimal: boolean;
}

export const OwnerPosPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [cart, setCart] = useState<OwnerCartItem[]>([]);
  const [discountInput, setDiscountInput] = useState('0');

  // Cash default
  const [paymentMode, setPaymentMode] = useState<'cash' | 'momo' | 'split'>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [splitCashAmount, setSplitCashAmount] = useState('');
  const [momoPhone, setMomoPhone] = useState('');
  const [momoNetwork, setMomoNetwork] = useState<'MTN' | 'TELECEL' | 'AT'>('MTN');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingMomoRef, setPendingMomoRef] = useState<string | null>(null);
  const [completedReceipt, setCompletedReceipt] = useState<ReceiptSnapshot | null>(null);

  const loadProducts = useCallback(async () => {
    if (!supabase) return;
    const [{ data: prodData }, { data: shopData }] = await Promise.all([
      supabase
        .from('products')
        .select('*, measurement_units(*), categories(name), product_unit_conversions(*), product_barcodes(barcode, unit_conversion_id)')
        .eq('is_archived', false)
        .order('name'),
      supabase.from('shop_settings').select('*').limit(1).maybeSingle(),
    ]);
    setProducts((prodData as unknown as Product[]) || []);
    setShopSettings((shopData as unknown as ShopSettings) || null);
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!pendingMomoRef) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/payments/moolre/status/${encodeURIComponent(pendingMomoRef)}`);
      const data = await res.json();
      if (res.ok && data.payment?.status === 'successful') {
        setPendingMomoRef(null);
        setCart([]);
        setCashTendered('');
        setSplitCashAmount('');
        setPaymentMode('cash');
        if (data.receipt?.snapshot_json) setCompletedReceipt(data.receipt.snapshot_json);
        loadProducts();
      } else if (res.ok && ['failed', 'cancelled', 'expired'].includes(data.payment?.status)) {
        setPendingMomoRef(null);
        setError(`MoMo payment ${data.payment.status}: ${data.payment.failure_reason || ''}`);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [pendingMomoRef, loadProducts]);

  const addProduct = (product: Product, conversionId: string | null = null) => {
    setError(null);
    const conv = conversionId
      ? product.product_unit_conversions?.find((c) => c.id === conversionId)
      : null;
    const unitName = conv ? conv.unit_name : product.measurement_units?.code || 'unit';
    const factor = conv ? Number(conv.conversion_to_base) : 1;
    const price = computeUnitPrice(Number(product.selling_price), factor, conv?.selling_price);
    const key = `${product.id}::${conversionId || 'base'}`;

    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
      return [
        ...prev,
        {
          key,
          product,
          conversionId,
          unitName,
          conversionToBase: factor,
          unitPrice: price,
          quantity: 1,
          allowDecimal: product.measurement_units?.allow_decimal ?? true,
        },
      ];
    });
  };

  const handleBarcodeSubmit = (term: string) => {
    const q = term.trim().toLowerCase();
    if (!q) return;
    for (const p of products) {
      if (p.barcode?.toLowerCase() === q) {
        addProduct(p, null);
        setSearchQuery('');
        return;
      }
      const alt = p.product_barcodes?.find((b) => b.barcode.toLowerCase() === q);
      if (alt) {
        addProduct(p, alt.unit_conversion_id);
        setSearchQuery('');
        return;
      }
    }
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q));
  }, [products, searchQuery]);

  const totals = useMemo(
    () =>
      calculateCartTotals(
        cart.map((c) => ({ quantity: c.quantity, unitPrice: c.unitPrice, conversionToBase: c.conversionToBase })),
        Number(discountInput) || 0
      ),
    [cart, discountInput]
  );

  const cashNeeded =
    paymentMode === 'cash'
      ? totals.totalAmount
      : paymentMode === 'split'
      ? Math.max(0, Number(splitCashAmount) || 0)
      : 0;
  const momoNeeded =
    paymentMode === 'momo'
      ? totals.totalAmount
      : paymentMode === 'split'
      ? Math.max(0, Math.round((totals.totalAmount - cashNeeded) * 100) / 100)
      : 0;
  const cashCalc = calculateCashChange(cashNeeded, Number(cashTendered) || 0);

  const handleCheckout = async () => {
    if (!supabase || cart.length === 0) return;
    if (cashNeeded > 0 && !cashCalc.valid) {
      setError(`Cash received must cover ${formatGHS(cashNeeded)}`);
      return;
    }
    if (momoNeeded > 0 && !momoPhone.trim()) {
      setError('Enter customer Mobile Money phone number.');
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const { data: authData } = await supabase.auth.getSession();
      const userId = authData.session?.user?.id;
      const accessToken = authData.session?.access_token;
      if (!userId || !accessToken) throw new Error('Owner session expired.');

      const clientTxRef = `OWN-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const { data: saleRes, error: rpcErr } = await supabase.rpc('fn_complete_sale', {
        p_client_tx_ref: clientTxRef,
        p_shift_id: null,
        p_cashier_id: null,
        p_owner_id: userId,
        p_items: cart.map((c) => ({
          product_id: c.product.id,
          conversion_id: c.conversionId,
          quantity: c.quantity,
        })),
        p_discount_amount: Number(discountInput) || 0,
        p_cash_amount: cashNeeded,
        p_cash_tendered: cashNeeded > 0 ? Number(cashTendered) || cashNeeded : 0,
        p_momo_amount: momoNeeded,
        p_sync_source: 'online',
      });
      if (rpcErr) throw rpcErr;

      if (momoNeeded > 0) {
        const resp = await fetch('/api/payments/moolre/initiate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            saleId: saleRes.sale_id,
            payerPhone: momoPhone.trim(),
            network: momoNetwork,
            amount: momoNeeded,
            idempotencyKey: `momo-${clientTxRef}`,
          }),
        });
        const momoJson = await resp.json();
        if (!resp.ok) throw new Error(momoJson.error || 'Moolre initiation failed');
        setPendingMomoRef(momoJson.paymentReference);
      } else {
        const { data: rcp } = await supabase
          .from('receipts')
          .select('snapshot_json')
          .eq('sale_id', saleRes.sale_id)
          .maybeSingle();
        if (rcp?.snapshot_json) setCompletedReceipt(rcp.snapshot_json as ReceiptSnapshot);
        setCart([]);
        setDiscountInput('0');
        setCashTendered('');
        setSplitCashAmount('');
        setPaymentMode('cash');
        await loadProducts();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#1F2937]">Owner Point of Sale</h1>
        <p className="text-xs text-[#6B7280]">Direct owner checkout with unit conversions & Moolre MoMo</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 space-y-4">
          <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleBarcodeSubmit(searchQuery);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Scan barcode or search products..."
                  className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                />
                <ScanBarcode className="h-4 w-4 text-[#6B7280] absolute right-3 top-1/2 -translate-y-1/2" />
              </div>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-semibold hover:bg-[#F3F4F6] cursor-pointer"
              >
                <Camera className="h-4 w-4 text-[#E60000]" />
                Scan
              </button>
            </form>

            {filtered.length === 0 ? (
              <p className="py-10 text-center text-xs text-[#6B7280]">
                No products found. Register products under the Products page first.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[280px] overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={Number(p.stock_quantity) <= 0}
                    onClick={() => addProduct(p, null)}
                    className="text-left rounded-xl border border-[#E5E7EB] p-3 hover:border-[#E60000] disabled:opacity-50 cursor-pointer"
                  >
                    <p className="text-xs font-bold line-clamp-2 min-h-[32px]">{p.name}</p>
                    <p className="mt-1 text-sm font-bold text-[#E60000] tabular-nums">{formatGHS(Number(p.selling_price))}</p>
                    <p className="text-[10px] text-[#6B7280] tabular-nums">
                      {Number(p.stock_quantity)} {p.measurement_units?.code || ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white border border-[#E5E7EB] divide-y divide-[#E5E7EB]">
            {cart.length === 0 ? (
              <p className="p-8 text-center text-xs text-[#6B7280]">Cart is empty.</p>
            ) : (
              cart.map((item) => {
                const convs = item.product.product_unit_conversions?.filter((c) => c.is_sale_unit) || [];
                return (
                  <div key={item.key} className="p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{item.product.name}</p>
                      <select
                        value={item.conversionId || ''}
                        onChange={(e) => {
                          const cid = e.target.value || null;
                          const conv = cid ? convs.find((c) => c.id === cid) : null;
                          const factor = conv ? Number(conv.conversion_to_base) : 1;
                          const price = computeUnitPrice(Number(item.product.selling_price), factor, conv?.selling_price);
                          setCart((prev) =>
                            prev.map((r) =>
                              r.key === item.key
                                ? {
                                    ...r,
                                    conversionId: cid,
                                    unitName: conv ? conv.unit_name : item.product.measurement_units?.code || 'unit',
                                    conversionToBase: factor,
                                    unitPrice: price,
                                  }
                                : r
                            )
                          );
                        }}
                        className="mt-1 rounded border border-[#E5E7EB] px-2 py-1 text-xs"
                      >
                        <option value="">{item.product.measurement_units?.code || 'Base'} ({formatGHS(Number(item.product.selling_price))})</option>
                        {convs.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.unit_name} ({formatGHS(computeUnitPrice(Number(item.product.selling_price), Number(c.conversion_to_base), c.selling_price))})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setCart((prev) =>
                            prev.map((r) => (r.key === item.key ? { ...r, quantity: Math.max(0, r.quantity - 1) } : r)).filter((r) => r.quantity > 0)
                          )
                        }
                        className="h-8 w-8 rounded-lg border border-[#E5E7EB] flex items-center justify-center"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        step={item.allowDecimal ? '0.01' : '1'}
                        value={item.quantity}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (v > 0) setCart((prev) => prev.map((r) => (r.key === item.key ? { ...r, quantity: v } : r)));
                        }}
                        className="w-16 rounded-lg border border-[#E5E7EB] py-1 text-center text-sm font-semibold tabular-nums"
                      />
                      <button
                        type="button"
                        onClick={() => setCart((prev) => prev.map((r) => (r.key === item.key ? { ...r, quantity: r.quantity + 1 } : r)))}
                        className="h-8 w-8 rounded-lg border border-[#E5E7EB] flex items-center justify-center"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular-nums">{formatGHS(item.quantity * item.unitPrice)}</p>
                      <p className="text-[10px] text-[#6B7280] tabular-nums">
                        -{computeBaseQuantity(item.quantity, item.conversionToBase)} {item.product.measurement_units?.code}
                      </p>
                      <button
                        type="button"
                        onClick={() => setCart((prev) => prev.filter((r) => r.key !== item.key))}
                        className="text-[11px] text-[#E60000] inline-flex items-center gap-0.5"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="xl:col-span-5 rounded-xl bg-white border border-[#E5E7EB] overflow-hidden h-fit">
          <div className="bg-[#E60000] px-4 py-3 text-white font-display text-sm font-bold">Payment Method</div>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              {[
                { id: 'cash', label: 'Cash (Default)', icon: Banknote },
                { id: 'momo', label: 'MoMo Pay (Optional)', icon: Smartphone },
                { id: 'split', label: 'Split Payment (Cash + MoMo)', icon: Split },
              ].map(({ id, label, icon: Icon }) => (
                <label
                  key={id}
                  className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${
                    paymentMode === id ? 'border-[#E60000] bg-red-50/30' : 'border-[#E5E7EB]'
                  }`}
                >
                  <input
                    type="radio"
                    name="owner-pos-method"
                    checked={paymentMode === id}
                    onChange={() => setPaymentMode(id as 'cash' | 'momo' | 'split')}
                    className="accent-[#E60000]"
                  />
                  <Icon className="h-4 w-4 text-[#1F2937]" />
                  <span className="text-sm font-semibold">{label}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between text-xs">
              <label htmlFor="owner-pos-discount" className="font-semibold text-[#6B7280]">Owner Discount (GH₵)</label>
              <input
                id="owner-pos-discount"
                type="number"
                step="0.01"
                min="0"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                className="w-28 rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-right font-semibold tabular-nums"
              />
            </div>

            {paymentMode === 'split' && (
              <div>
                <label className="block text-xs font-semibold mb-1">Cash Component (GH₵)</label>
                <input
                  type="number"
                  step="0.01"
                  value={splitCashAmount}
                  onChange={(e) => setSplitCashAmount(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                />
              </div>
            )}

            {cashNeeded > 0 && (
              <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold">Cash Tendered</span>
                  <button type="button" onClick={() => setCashTendered(cashNeeded.toFixed(2))} className="text-[#E60000] font-semibold">
                    Exact
                  </button>
                </div>
                <input
                  type="number"
                  step="0.01"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  placeholder={cashNeeded.toFixed(2)}
                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-bold tabular-nums"
                />
                <div className="flex justify-between text-xs">
                  <span>Change</span>
                  <span className="font-bold text-emerald-700 tabular-nums">{formatGHS(cashCalc.change)}</span>
                </div>
              </div>
            )}

            {momoNeeded > 0 && (
              <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {(['MTN', 'TELECEL', 'AT'] as const).map((net) => (
                    <button
                      key={net}
                      type="button"
                      onClick={() => setMomoNetwork(net)}
                      className={`rounded border py-1 text-xs font-bold ${momoNetwork === net ? 'border-[#E60000] bg-red-50 text-[#E60000]' : 'border-[#E5E7EB] bg-white'}`}
                    >
                      {net}
                    </button>
                  ))}
                </div>
                <input
                  type="tel"
                  value={momoPhone}
                  onChange={(e) => setMomoPhone(e.target.value)}
                  placeholder="Customer MoMo number"
                  className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="text-center pt-2 border-t border-[#E5E7EB]">
              <p className="text-xs text-[#6B7280]">Total Amount</p>
              <p className="font-display text-3xl font-extrabold text-[#E60000] tabular-nums">{formatGHS(totals.totalAmount)}</p>
            </div>

            {error && <p className="text-xs text-[#E60000] bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</p>}
            {pendingMomoRef && <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200">Awaiting Moolre approval ({pendingMomoRef})...</p>}

            <button
              type="button"
              disabled={processing || cart.length === 0}
              onClick={handleCheckout}
              className="w-full rounded-xl bg-[#E60000] py-3 text-sm font-bold text-white hover:bg-[#cc0000] disabled:opacity-50 cursor-pointer"
            >
              {processing ? 'Processing...' : 'Complete Sale'}
            </button>
          </div>
        </div>
      </div>

      {showScanner && (
        <CameraBarcodeScannerModal onScanSuccess={handleBarcodeSubmit} onClose={() => setShowScanner(false)} />
      )}
      {completedReceipt && (
        <ReceiptModal
          receipt={completedReceipt}
          shop={shopSettings}
          mode="cashier_post_sale"
          onClose={() => setCompletedReceipt(null)}
        />
      )}
    </div>
  );
};
