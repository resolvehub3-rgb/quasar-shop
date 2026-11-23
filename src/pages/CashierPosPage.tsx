import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Search,
  ScanBarcode,
  Camera,
  Plus,
  Minus,
  Trash2,
  Banknote,
  Smartphone,
  LogOut,
  ReceiptText,
  RotateCcw,
  QrCode,
  Clock,
  Wifi,
  WifiOff,
  CloudUpload,
  CheckCircle2,
  AlertCircle,
  X,
} from 'lucide-react';
import type { CashierAuthSession } from './CashierLoginPage';
import type { Product, SaleRecord, ExpenseRecord, ReceiptSnapshot, ShopSettings } from '../types/database';
import { calculateCartTotals, calculateCashChange, formatGHS } from '../lib/posCalculations';
import { computeBaseQuantity, computeUnitPrice } from '../lib/inventoryMath';
import {
  enqueueOfflineSale,
  loadOfflineSalesQueue,
  syncPendingOfflineSales,
  type QueuedOfflineSale,
} from '../lib/offlineQueue';
import { useOnlineStatus } from '../components/PWAInstallButton';
import { ReceiptModal } from '../components/ReceiptModal';
import { CameraBarcodeScannerModal } from '../components/CameraBarcodeScannerModal';

interface CartItem {
  key: string;
  product: Product;
  conversionId: string | null;
  unitName: string;
  conversionToBase: number;
  unitPrice: number;
  quantity: number;
  allowDecimal: boolean;
}

interface CashierPosPageProps {
  session: CashierAuthSession | null;
  onSessionUpdate: (next: CashierAuthSession | null) => void;
}

type PosTab = 'pos' | 'history' | 'refund' | 'offline';

export const CashierPosPage: React.FC<CashierPosPageProps> = ({ session, onSessionUpdate }) => {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const [activeTab, setActiveTab] = useState<PosTab>('pos');
  const [products, setProducts] = useState<Product[]>([]);
  const [shiftSales, setShiftSales] = useState<SaleRecord[]>([]);
  const [shiftExpenses, setShiftExpenses] = useState<ExpenseRecord[]>([]);
  const [shopSettings, setShopSettings] = useState<ShopSettings | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Shift Opening state
  const [openingCashInput, setOpeningCashInput] = useState('0');
  const [openingShiftLoading, setOpeningShiftLoading] = useState(false);

  // Search & Barcode
  const [searchQuery, setSearchQuery] = useState('');
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Cart & Discount
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountInput, setDiscountInput] = useState('0');

  // Payment State (Cash MUST be default)
  const [paymentMode, setPaymentMode] = useState<'cash' | 'momo'>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [momoPhone, setMomoPhone] = useState('');
  const [momoNetwork, setMomoNetwork] = useState<'MTN' | 'TELECEL' | 'AT'>('MTN');
  const [processingSale, setProcessingSale] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);

  // Active Moolre payment tracking
  const [pendingMomo, setPendingMomo] = useState<{
    paymentReference: string;
    status: string;
    amount: number;
    phone: string;
    network: string;
  } | null>(null);

  // Post-sale Digital Receipt
  const [completedReceipt, setCompletedReceipt] = useState<ReceiptSnapshot | null>(null);

  // Modals: Expense QR, Close Shift, Refund Request
  const [qrModal, setQrModal] = useState<{
    qrDataUrl: string;
    submitUrl: string;
    expiresAt: string;
  } | null>(null);
  const [closeShiftModal, setCloseShiftModal] = useState<{
    summary: {
      opening_cash: number;
      cash_sales: number;
      momo_sales: number;
      cash_expenses: number;
      momo_expenses: number;
      other_expenses: number;
      cash_refunds: number;
      expected_cash: number;
      transaction_count: number;
      expense_count: number;
    };
  } | null>(null);
  const [declaredCloseCash, setDeclaredCloseCash] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [closedShiftReport, setClosedShiftReport] = useState<any | null>(null);

  // Refund Request form
  const [selectedRefundSaleId, setSelectedRefundSaleId] = useState('');
  const [selectedRefundItemId, setSelectedRefundItemId] = useState('');
  const [refundQty, setRefundQty] = useState('1');
  const [refundCondition, setRefundCondition] = useState<'resaleable' | 'damaged' | 'expired'>('resaleable');
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMessage, setRefundMessage] = useState<string | null>(null);

  // Offline queue
  const [offlineQueue, setOfflineQueue] = useState<QueuedOfflineSale[]>(() => loadOfflineSalesQueue());
  const [syncingOffline, setSyncingOffline] = useState(false);

  useEffect(() => {
    if (!session) {
      navigate('/cashier/login');
    }
  }, [session, navigate]);

  const loadPosData = useCallback(async () => {
    if (!session) return;
    setLoadingData(true);
    setDataError(null);
    try {
      const [meRes, dataRes] = await Promise.all([
        fetch('/api/cashier/me', { headers: { Authorization: `Bearer ${session.token}` } }),
        fetch('/api/cashier/pos-data', { headers: { Authorization: `Bearer ${session.token}` } }),
      ]);
      if (meRes.status === 401 || dataRes.status === 401) {
        onSessionUpdate(null);
        navigate('/cashier/login');
        return;
      }
      const meJson = await meRes.json();
      const posJson = await dataRes.json();
      if (!dataRes.ok) throw new Error(posJson.error || 'Failed to load POS inventory');

      setShopSettings(meJson.shopSettings || null);
      if (meJson.activeShift?.id !== session.activeShift?.id) {
        onSessionUpdate({ ...session, activeShift: meJson.activeShift || null });
      }
      setProducts(posJson.products || []);
      setShiftSales(posJson.shiftSales || []);
      setShiftExpenses(posJson.shiftExpenses || []);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Network error loading POS data');
    } finally {
      setLoadingData(false);
    }
  }, [session, navigate, onSessionUpdate]);

  useEffect(() => {
    if (session) {
      loadPosData();
    }
  }, [session?.token]);

  // Poll Moolre status while awaiting authorization
  useEffect(() => {
    if (!pendingMomo) return;
    if (['successful', 'failed', 'cancelled', 'expired'].includes(pendingMomo.status)) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/moolre/status/${encodeURIComponent(pendingMomo.paymentReference)}`);
        const data = await res.json();
        if (res.ok && data.payment) {
          setPendingMomo((prev) =>
            prev ? { ...prev, status: data.payment.status } : null
          );
          if (data.payment.status === 'successful') {
            setCart([]);
            setDiscountInput('0');
            setCashTendered('');
            setPaymentMode('cash');
            if (data.receipt?.snapshot_json) {
              setCompletedReceipt(data.receipt.snapshot_json);
            }
            setPendingMomo(null);
            loadPosData();
          }
        }
      } catch {
        // Keep polling until expiry
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [pendingMomo, loadPosData]);

  const addProductToCart = useCallback((product: Product, conversionId: string | null = null) => {
    setSaleError(null);
    const conv = conversionId
      ? product.product_unit_conversions?.find((c) => c.id === conversionId)
      : null;

    const unitName = conv ? conv.unit_name : product.measurement_units?.code || 'unit';
    const conversionToBase = conv ? Number(conv.conversion_to_base) : 1;
    const unitPrice = computeUnitPrice(
      Number(product.selling_price),
      conversionToBase,
      conv?.selling_price
    );
    const allowDecimal = product.measurement_units?.allow_decimal ?? true;
    const key = `${product.id}::${conversionId || 'base'}`;

    setCart((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        {
          key,
          product,
          conversionId,
          unitName,
          conversionToBase,
          unitPrice,
          quantity: 1,
          allowDecimal,
        },
      ];
    });
  }, []);

  const handleBarcodeOrSearchSubmit = useCallback(
    (rawInput: string) => {
      const term = rawInput.trim();
      if (!term) return;

      // Exact barcode match first (product.barcode or product_barcodes)
      for (const p of products) {
        if (p.barcode && p.barcode.toLowerCase() === term.toLowerCase()) {
          addProductToCart(p, null);
          setSearchQuery('');
          return;
        }
        const alt = p.product_barcodes?.find((b) => b.barcode.toLowerCase() === term.toLowerCase());
        if (alt) {
          addProductToCart(p, alt.unit_conversion_id);
          setSearchQuery('');
          return;
        }
      }
    },
    [products, addProductToCart]
  );

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.categories?.name && p.categories.name.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  const cartTotals = useMemo(() => {
    return calculateCartTotals(
      cart.map((c) => ({
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        conversionToBase: c.conversionToBase,
        costBasisPerBaseUnit: null,
      })),
      Number(discountInput) || 0
    );
  }, [cart, discountInput]);

  const cashNeeded = paymentMode === 'cash' ? cartTotals.totalAmount : 0;

  const momoNeeded = paymentMode === 'momo' ? cartTotals.totalAmount : 0;

  const cashCalc = useMemo(
    () => calculateCashChange(cashNeeded, Number(cashTendered) || 0),
    [cashNeeded, cashTendered]
  );

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setOpeningShiftLoading(true);
    setSaleError(null);
    try {
      const res = await fetch('/api/cashier/shift/open', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ openingCash: Number(openingCashInput) || 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to open shift');
      onSessionUpdate({ ...session, activeShift: data.shift });
      await loadPosData();
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Failed to open shift');
    } finally {
      setOpeningShiftLoading(false);
    }
  };

  const handleCompleteSale = async () => {
    if (!session || !session.activeShift) return;
    if (cart.length === 0) {
      setSaleError('Add at least one product to the cart.');
      return;
    }

    // Validate stock locally before sending (server also enforces authoritatively)
    for (const item of cart) {
      const baseRequired = computeBaseQuantity(item.quantity, item.conversionToBase);
      if (Number(item.product.stock_quantity) < baseRequired) {
        setSaleError(`Insufficient stock for ${item.product.name} (${item.product.stock_quantity} available).`);
        return;
      }
    }

    if (cashNeeded > 0 && !cashCalc.valid) {
      setSaleError(`Cash tendered must cover ${formatGHS(cashNeeded)}.`);
      return;
    }

    if (momoNeeded > 0 && (!momoPhone.trim() || momoPhone.trim().length < 9)) {
      setSaleError('Customer Mobile Money telephone number is required.');
      return;
    }

    const clientTxRef = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Offline handling: Cash sales only can queue locally; MoMo requires network
    if (!isOnline) {
      if (momoNeeded > 0) {
        setSaleError('Moolre Mobile Money requires active internet connectivity. Switch to Cash or reconnect.');
        return;
      }
      const nextQueue = enqueueOfflineSale({
        clientTxRef,
        shiftId: session.activeShift.id,
        items: cart.map((c) => ({
          product_id: c.product.id,
          conversion_id: c.conversionId,
          quantity: c.quantity,
          product_name: c.product.name,
          unit_name: c.unitName,
          unit_price: c.unitPrice,
        })),
        discountAmount: Number(discountInput) || 0,
        cashAmount: cashNeeded,
        cashTendered: Number(cashTendered) || cashNeeded,
        totalAmount: cartTotals.totalAmount,
      });
      setOfflineQueue(nextQueue);
      setCart([]);
      setDiscountInput('0');
      setCashTendered('');
      setPaymentMode('cash');
      setSaleError(null);
      setActiveTab('offline');
      return;
    }

    setProcessingSale(true);
    setSaleError(null);

    try {
      const saleResp = await fetch('/api/cashier/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          clientTxRef,
          shiftId: session.activeShift.id,
          items: cart.map((c) => ({
            product_id: c.product.id,
            conversion_id: c.conversionId,
            quantity: c.quantity,
          })),
          discountAmount: Number(discountInput) || 0,
          cashAmount: cashNeeded,
          cashTendered: cashNeeded > 0 ? Number(cashTendered) || cashNeeded : 0,
          momoAmount: momoNeeded,
        }),
      });
      const saleData = await saleResp.json();
      if (!saleResp.ok) throw new Error(saleData.error || 'Could not process sale');

      if (momoNeeded > 0) {
        // Initiate real Moolre USSD request
        const momoResp = await fetch('/api/payments/moolre/initiate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            saleId: saleData.saleResult.sale_id,
            payerPhone: momoPhone.trim(),
            network: momoNetwork,
            amount: momoNeeded,
            idempotencyKey: `momo-${clientTxRef}`,
          }),
        });
        const momoJson = await momoResp.json();
        if (!momoResp.ok) {
          throw new Error(momoJson.error || 'Moolre MoMo payment initiation failed');
        }
        setPendingMomo({
          paymentReference: momoJson.paymentReference,
          status: momoJson.status,
          amount: momoNeeded,
          phone: momoPhone.trim(),
          network: momoNetwork,
        });
      } else {
        // Cash-only sale completed immediately
        setCart([]);
        setDiscountInput('0');
        setCashTendered('');
        setPaymentMode('cash');
        if (saleData.receipt?.snapshot_json) {
          setCompletedReceipt(saleData.receipt.snapshot_json);
        }
        await loadPosData();
      }
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Checkout error');
    } finally {
      setProcessingSale(false);
    }
  };

  const handleGenerateExpenseQR = async () => {
    if (!session?.activeShift) return;
    setSaleError(null);
    try {
      const res = await fetch('/api/cashier/expense-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ shiftId: session.activeShift.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create QR session');
      setQrModal(data);
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'QR generation failed');
    }
  };

  const handleOpenCloseShift = async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/cashier/shift/summary', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load shift summary');
      setCloseShiftModal({ summary: data.summary });
      setDeclaredCloseCash('');
      setClosingNotes('');
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Failed to load shift closing summary');
    }
  };

  const handleConfirmCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.activeShift) return;
    try {
      const res = await fetch('/api/cashier/shift/close', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          shiftId: session.activeShift.id,
          declaredCash: Number(declaredCloseCash),
          closingNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to close shift');
      setCloseShiftModal(null);
      setClosedShiftReport(data.report);
      onSessionUpdate({ ...session, activeShift: null });
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Failed to close shift');
    }
  };

  const handleSubmitRefundRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setRefundMessage(null);
    const sale = shiftSales.find((s) => s.id === selectedRefundSaleId);
    const item = sale?.sale_items?.find((i) => i.id === selectedRefundItemId);
    if (!sale || !item) {
      setRefundMessage('Select a sale and product item to return.');
      return;
    }

    try {
      const res = await fetch('/api/cashier/returns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          saleId: sale.id,
          saleItemId: item.id,
          productId: item.product_id,
          quantityReturned: Number(refundQty),
          conversionToBase: item.conversion_to_base,
          reason: refundReason,
          productCondition: refundCondition,
          requestedRefundAmount: Number(refundAmount || item.unit_price * Number(refundQty)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not submit return request');
      setRefundMessage(`Return request ${data.returnRequest.refund_ref} submitted for Shop Owner approval.`);
      setRefundReason('');
      setRefundQty('1');
    } catch (err) {
      setRefundMessage(err instanceof Error ? err.message : 'Return submission failed');
    }
  };

  const handleSyncOffline = async () => {
    if (!session) return;
    setSyncingOffline(true);
    try {
      const result = await syncPendingOfflineSales(session.token);
      setOfflineQueue(result.remainingQueue);
      if (result.syncedCount > 0) {
        await loadPosData();
      }
    } finally {
      setSyncingOffline(false);
    }
  };

  const handleLogout = async () => {
    if (session) {
      await fetch('/api/cashier/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      }).catch(() => {});
    }
    onSessionUpdate(null);
    navigate('/cashier/login');
  };

  if (!session) return null;

  const shiftTodaySales = shiftSales
    .filter((s) => s.payment_status === 'paid')
    .reduce((sum, s) => sum + Number(s.total_amount), 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F4F6] text-[#1F2937]">
      {/* Red POS Header matching reference */}
      <header className="bg-[#E60000] text-white px-4 lg:px-6 h-14 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <ShoppingBag className="h-6 w-6 shrink-0" />
          <div className="min-w-0">
            <p className="font-display text-sm sm:text-base font-bold leading-tight truncate">
              {shopSettings?.shop_name || 'Provision Shop'} POS
            </p>
            <p className="text-[11px] text-white/85 truncate">
              {session.activeShift ? `Shift ${session.activeShift.shift_ref}` : 'Shift Not Opened'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-300" />
                <span className="hidden sm:inline">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-300" />
                <span>Offline</span>
              </>
            )}
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs font-semibold leading-tight">{session.cashier.full_name}</p>
            <p className="text-[10px] text-white/80">Cashier</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25 transition-colors cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Charcoal POS Sidebar */}
        <aside className="bg-[#111827] text-white lg:w-56 shrink-0 flex lg:flex-col justify-between p-2 lg:p-3 gap-1 overflow-x-auto">
          <div className="flex lg:flex-col gap-1">
            {[
              { id: 'pos', label: 'New Sale', icon: ShoppingBag },
              { id: 'history', label: 'Shift Sales', icon: ReceiptText },
              { id: 'refund', label: 'Refund Request', icon: RotateCcw },
              { id: 'offline', label: `Sync Queue (${offlineQueue.length})`, icon: CloudUpload },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id as PosTab)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === id
                    ? 'bg-[#E60000] text-white'
                    : 'text-gray-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={handleGenerateExpenseQR}
              disabled={!session.activeShift}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white disabled:opacity-40 whitespace-nowrap cursor-pointer"
            >
              <QrCode className="h-4 w-4 shrink-0" />
              <span>Expense QR</span>
            </button>
          </div>

          {session.activeShift && (
            <div className="hidden lg:block space-y-2 pt-3 border-t border-white/10">
              <div className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-gray-300">
                <div className="flex items-center gap-1.5 text-white font-semibold">
                  <Clock className="h-3.5 w-3.5 text-[#E60000]" />
                  Shift Active
                </div>
                <p className="mt-1 tabular-nums">Open: {formatGHS(Number(session.activeShift.opening_cash))}</p>
                <p className="tabular-nums">Sales: {formatGHS(shiftTodaySales)}</p>
              </div>
              <button
                type="button"
                onClick={handleOpenCloseShift}
                className="w-full rounded-lg border border-white/20 py-2 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                Close Shift
              </button>
            </div>
          )}
        </aside>

        {/* Main POS Area */}
        <main className="flex-1 p-4 lg:p-5 overflow-y-auto">
          {!session.activeShift && !closedShiftReport ? (
            /* Mandatory Shift Opening Gate */
            <div className="max-w-md mx-auto mt-8 rounded-2xl bg-white border border-[#E5E7EB] p-6 shadow-sm">
              <h2 className="font-display text-lg font-bold text-[#1F2937]">Open Cashier Shift</h2>
              <p className="text-xs text-[#6B7280] mt-1">
                Welcome, <strong>{session.cashier.full_name}</strong>. Declare your opening cash drawer amount to unlock the POS.
              </p>
              {saleError && (
                <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {saleError}
                </div>
              )}
              <form onSubmit={handleOpenShift} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="opening-cash" className="block text-xs font-semibold text-[#1F2937] mb-1.5">
                    Opening Cash in Drawer (GH₵)
                  </label>
                  <input
                    id="opening-cash"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={openingCashInput}
                    onChange={(e) => setOpeningCashInput(e.target.value)}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2.5 text-base font-semibold tabular-nums focus:outline-none focus:border-[#E60000]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={openingShiftLoading}
                  className="w-full rounded-lg bg-[#E60000] py-3 text-sm font-semibold text-white hover:bg-[#cc0000] disabled:opacity-60 cursor-pointer"
                >
                  {openingShiftLoading ? 'Opening Shift...' : 'Open Shift & Start POS'}
                </button>
              </form>
            </div>
          ) : closedShiftReport ? (
            /* Shift Closed Summary Report */
            <div className="max-w-lg mx-auto mt-6 rounded-2xl bg-white border border-[#E5E7EB] p-6 shadow-sm">
              <div className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-6 w-6" />
                <h2 className="font-display text-lg font-bold text-[#1F2937]">Shift Closed Successfully</h2>
              </div>
              <p className="text-xs text-[#6B7280] mt-1 font-mono">{closedShiftReport.shift_ref}</p>

              <div className="mt-4 divide-y divide-[#E5E7EB] text-sm">
                <div className="py-2 flex justify-between">
                  <span className="text-[#6B7280]">Opening Cash</span>
                  <span className="font-semibold tabular-nums">{formatGHS(Number(closedShiftReport.opening_cash))}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-[#6B7280]">Cash Sales</span>
                  <span className="font-semibold tabular-nums">{formatGHS(Number(closedShiftReport.cash_sales))}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-[#6B7280]">MoMo Sales (Separate)</span>
                  <span className="font-semibold tabular-nums">{formatGHS(Number(closedShiftReport.momo_sales))}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-[#6B7280]">Cash Drawer Expenses</span>
                  <span className="font-semibold text-[#E60000] tabular-nums">-{formatGHS(Number(closedShiftReport.cash_expenses))}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-[#6B7280]">Expected Cash</span>
                  <span className="font-bold tabular-nums">{formatGHS(Number(closedShiftReport.expected_cash))}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-[#6B7280]">Declared Cash</span>
                  <span className="font-bold tabular-nums">{formatGHS(Number(closedShiftReport.declared_cash))}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="font-semibold">Cash Discrepancy</span>
                  <span
                    className={`font-bold tabular-nums ${
                      Number(closedShiftReport.cash_discrepancy) === 0
                        ? 'text-emerald-700'
                        : Number(closedShiftReport.cash_discrepancy) < 0
                        ? 'text-[#E60000]'
                        : 'text-amber-700'
                    }`}
                  >
                    {formatGHS(Number(closedShiftReport.cash_discrepancy))}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setClosedShiftReport(null)}
                  className="flex-1 rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
                >
                  Open New Shift
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex-1 rounded-lg border border-[#E5E7EB] py-2.5 text-sm font-semibold text-[#1F2937] hover:bg-[#F3F4F6] cursor-pointer"
                >
                  Logout
                </button>
              </div>
            </div>
          ) : activeTab === 'pos' ? (
            /* Main POS Split Grid */
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              {/* Left 7 Cols: Search + Barcode + Product Catalogue + Cart */}
              <div className="xl:col-span-7 space-y-4">
                {/* Mobile Close Shift Trigger */}
                <div className="flex lg:hidden items-center justify-between rounded-xl bg-white border border-[#E5E7EB] px-4 py-2.5">
                  <span className="text-xs font-semibold">
                    Open Cash: <span className="tabular-nums">{formatGHS(Number(session.activeShift?.opening_cash || 0))}</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleOpenCloseShift}
                    className="rounded-lg bg-[#1F2937] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Close Shift
                  </button>
                </div>

                {/* Search & Continuous Barcode Input */}
                <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-display text-sm font-bold text-[#1F2937]">Quick Sale & Barcode Scan</h2>
                    <span className="text-xs text-[#6B7280] tabular-nums">{products.length} products</span>
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleBarcodeOrSearchSubmit(searchQuery);
                    }}
                    className="flex gap-2"
                  >
                    <div className="relative flex-1">
                      <Search className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Scan barcode or search products..."
                        aria-label="Scan barcode or search products"
                        className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                      />
                      <ScanBarcode className="h-4 w-4 text-[#6B7280] absolute right-3 top-1/2 -translate-y-1/2" />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCameraScanner(true)}
                      aria-label="Open camera barcode scanner"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3.5 py-2.5 text-xs font-semibold text-[#1F2937] hover:bg-[#F3F4F6] cursor-pointer"
                    >
                      <Camera className="h-4 w-4 text-[#E60000]" />
                      <span className="hidden sm:inline">Scan</span>
                    </button>
                  </form>

                  {dataError && (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      {dataError}
                    </div>
                  )}

                  {loadingData ? (
                    <p className="py-10 text-center text-xs text-[#6B7280]">Loading shop inventory...</p>
                  ) : filteredProducts.length === 0 ? (
                    <div className="py-10 text-center">
                      <p className="text-sm font-semibold text-[#1F2937]">No products available</p>
                      <p className="text-xs text-[#6B7280] mt-1">
                        {products.length === 0
                          ? 'The shop owner has not registered any products yet.'
                          : 'No products match your search query.'}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-[300px] overflow-y-auto pr-1">
                      {filteredProducts.slice(0, 40).map((product) => {
                        const outOfStock = Number(product.stock_quantity) <= 0;
                        return (
                          <button
                            key={product.id}
                            type="button"
                            disabled={outOfStock}
                            onClick={() => addProductToCart(product, null)}
                            className={`text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                              outOfStock
                                ? 'border-[#E5E7EB] bg-[#F9FAFB] opacity-55 cursor-not-allowed'
                                : 'border-[#E5E7EB] bg-white hover:border-[#E60000] hover:bg-red-50/20'
                            }`}
                          >
                            {(product as any).image_url && (
                              <img
                                src={(product as any).image_url}
                                alt={product.name}
                                className="mb-2 h-16 w-full rounded-lg object-cover"
                              />
                            )}
                            <p className="text-xs font-bold text-[#1F2937] line-clamp-2 min-h-[32px]">
                              {product.name}
                            </p>
                            <p className="mt-1.5 text-sm font-bold text-[#E60000] tabular-nums">
                              {formatGHS(Number(product.selling_price))}
                            </p>
                            <p className="text-[10px] text-[#6B7280] tabular-nums mt-0.5">
                              {Number(product.stock_quantity).toFixed(2).replace(/\.00$/, '')}{' '}
                              {product.measurement_units?.code || 'unit'} left
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Active Cart with Smart Unit Selector & Measured Decimal Quantities */}
                <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
                  <div className="border-b border-[#E5E7EB] px-4 py-3 flex items-center justify-between bg-[#F9FAFB]">
                    <h2 className="font-display text-sm font-bold text-[#1F2937]">
                      Current Cart ({cart.length})
                    </h2>
                    {cart.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setCart([])}
                        className="text-xs font-semibold text-[#E60000] hover:underline cursor-pointer"
                      >
                        Clear Cart
                      </button>
                    )}
                  </div>

                  {cart.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#6B7280]">
                      Scan a barcode or tap a product above to begin a sale.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E5E7EB]">
                      {cart.map((item) => {
                        const conversions = item.product.product_unit_conversions?.filter((c) => c.is_sale_unit) || [];
                        return (
                          <div key={item.key} className="p-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-[#1F2937] truncate">{item.product.name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <select
                                  aria-label={`Select sale unit for ${item.product.name}`}
                                  value={item.conversionId || ''}
                                  onChange={(e) => {
                                    const nextConvId = e.target.value || null;
                                    const conv = nextConvId
                                      ? conversions.find((c) => c.id === nextConvId)
                                      : null;
                                    const nextFactor = conv ? Number(conv.conversion_to_base) : 1;
                                    const nextPrice = computeUnitPrice(
                                      Number(item.product.selling_price),
                                      nextFactor,
                                      conv?.selling_price
                                    );
                                    const nextUnitName = conv
                                      ? conv.unit_name
                                      : item.product.measurement_units?.code || 'unit';

                                    setCart((prev) =>
                                      prev.map((row) =>
                                        row.key === item.key
                                          ? {
                                              ...row,
                                              conversionId: nextConvId,
                                              unitName: nextUnitName,
                                              conversionToBase: nextFactor,
                                              unitPrice: nextPrice,
                                            }
                                          : row
                                      )
                                    );
                                  }}
                                  className="rounded border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-1 text-xs text-[#1F2937]"
                                >
                                  <option value="">
                                    {item.product.measurement_units?.code || 'Base'} ({formatGHS(Number(item.product.selling_price))})
                                  </option>
                                  {conversions.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.unit_name} ({formatGHS(computeUnitPrice(Number(item.product.selling_price), Number(c.conversion_to_base), c.selling_price))})
                                    </option>
                                  ))}
                                </select>
                                <span className="text-[11px] text-[#6B7280] tabular-nums">
                                  Deducts {computeBaseQuantity(item.quantity, item.conversionToBase)}{' '}
                                  {item.product.measurement_units?.code || ''}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`Decrease quantity of ${item.product.name}`}
                                onClick={() =>
                                  setCart((prev) =>
                                    prev
                                      .map((r) =>
                                        r.key === item.key ? { ...r, quantity: Math.max(0, r.quantity - 1) } : r
                                      )
                                      .filter((r) => r.quantity > 0)
                                  )
                                }
                                className="h-8 w-8 rounded-lg border border-[#E5E7EB] flex items-center justify-center hover:bg-[#F3F4F6] cursor-pointer"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <input
                                type="number"
                                step={item.allowDecimal ? '0.01' : '1'}
                                min="0.01"
                                aria-label={`Quantity for ${item.product.name}`}
                                value={item.quantity}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  if (!Number.isFinite(val) || val <= 0) return;
                                  setCart((prev) =>
                                    prev.map((r) => (r.key === item.key ? { ...r, quantity: val } : r))
                                  );
                                }}
                                className="w-16 rounded-lg border border-[#E5E7EB] py-1 text-center text-sm font-semibold tabular-nums"
                              />
                              <button
                                type="button"
                                aria-label={`Increase quantity of ${item.product.name}`}
                                onClick={() =>
                                  setCart((prev) =>
                                    prev.map((r) => (r.key === item.key ? { ...r, quantity: r.quantity + 1 } : r))
                                  )
                                }
                                className="h-8 w-8 rounded-lg border border-[#E5E7EB] flex items-center justify-center hover:bg-[#F3F4F6] cursor-pointer"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="text-right min-w-[85px]">
                              <p className="text-sm font-bold text-[#1F2937] tabular-nums">
                                {formatGHS(item.quantity * item.unitPrice)}
                              </p>
                              <button
                                type="button"
                                aria-label={`Remove ${item.product.name}`}
                                onClick={() => setCart((prev) => prev.filter((r) => r.key !== item.key))}
                                className="text-[11px] text-[#E60000] hover:underline inline-flex items-center gap-0.5 mt-0.5 cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" /> Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right 5 Cols: Payment Method (Cash Default), MoMo Pay, Split & Checkout */}
              <div className="xl:col-span-5 space-y-4">
                <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
                  <div className="bg-[#E60000] px-4 py-3 text-white">
                    <h2 className="font-display text-sm font-bold">Payment Method</h2>
                  </div>

                  <div className="p-4 space-y-4">
                    {/* Payment Mode Radios — Cash selected by default */}
                    <div className="space-y-2">
                      <label
                        className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition-colors ${
                          paymentMode === 'cash'
                            ? 'border-[#E60000] bg-red-50/30'
                            : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="pos-payment-method"
                            checked={paymentMode === 'cash'}
                            onChange={() => setPaymentMode('cash')}
                            className="accent-[#E60000]"
                          />
                          <Banknote className="h-5 w-5 text-emerald-600" />
                          <div>
                            <p className="text-sm font-bold text-[#1F2937]">Cash (Default)</p>
                            <p className="text-[11px] text-[#6B7280]">Drawer cash settlement</p>
                          </div>
                        </div>
                      </label>

                      <label
                        className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition-colors ${
                          paymentMode === 'momo'
                            ? 'border-[#E60000] bg-red-50/30'
                            : 'border-[#E5E7EB] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="pos-payment-method"
                            checked={paymentMode === 'momo'}
                            onChange={() => setPaymentMode('momo')}
                            className="accent-[#E60000]"
                          />
                          <Smartphone className="h-5 w-5 text-amber-600" />
                          <div>
                            <p className="text-sm font-bold text-[#1F2937]">MoMo Pay (Optional)</p>
                            <p className="text-[11px] text-[#6B7280]">Moolre Mobile Money USSD prompt</p>
                          </div>
                        </div>
                      </label>

                    </div>

                    {/* Discount */}
                    {(shopSettings?.max_cashier_discount_pct ?? 0) > 0 && (
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E5E7EB]">
                        <label htmlFor="pos-discount" className="text-xs font-semibold text-[#6B7280]">
                          Discount (Max {shopSettings?.max_cashier_discount_pct}%)
                        </label>
                        <input
                          id="pos-discount"
                          type="number"
                          step="0.01"
                          min="0"
                          value={discountInput}
                          onChange={(e) => setDiscountInput(e.target.value)}
                          className="w-28 rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums"
                        />
                      </div>
                    )}



                    {/* Cash Tendered & Change */}
                    {cashNeeded > 0 && (
                      <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <label htmlFor="cash-tendered" className="text-xs font-semibold text-[#1F2937]">
                            Cash Received (GH₵)
                          </label>
                          <button
                            type="button"
                            onClick={() => setCashTendered(cashNeeded.toFixed(2))}
                            className="text-[11px] font-semibold text-[#E60000] hover:underline cursor-pointer"
                          >
                            Exact Amount
                          </button>
                        </div>
                        <input
                          id="cash-tendered"
                          type="number"
                          step="0.01"
                          min="0"
                          value={cashTendered}
                          onChange={(e) => setCashTendered(e.target.value)}
                          placeholder={cashNeeded.toFixed(2)}
                          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-base font-bold tabular-nums focus:outline-none focus:border-[#E60000]"
                        />
                        <div className="flex justify-between text-xs">
                          <span className="text-[#6B7280]">Change Due:</span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {formatGHS(cashCalc.change)}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Moolre Mobile Money Fields (No PIN field ever!) */}
                    {momoNeeded > 0 && (
                      <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3 space-y-2.5">
                        <div className="grid grid-cols-3 gap-1.5">
                          {(['MTN', 'TELECEL', 'AT'] as const).map((net) => (
                            <button
                              key={net}
                              type="button"
                              onClick={() => setMomoNetwork(net)}
                              className={`rounded-lg border py-1.5 text-xs font-bold cursor-pointer ${
                                momoNetwork === net
                                  ? 'border-[#E60000] bg-red-50 text-[#E60000]'
                                  : 'border-[#E5E7EB] bg-white text-[#4B5563]'
                              }`}
                            >
                              {net}
                            </button>
                          ))}
                        </div>
                        <div>
                          <label htmlFor="momo-phone" className="block text-xs font-semibold text-[#1F2937] mb-1">
                            Customer MoMo Number
                          </label>
                          <input
                            id="momo-phone"
                            type="tel"
                            value={momoPhone}
                            onChange={(e) => setMomoPhone(e.target.value)}
                            placeholder="024XXXXXXX"
                            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus:border-[#E60000]"
                          />
                        </div>
                        <p className="text-[11px] text-[#6B7280]">
                          Customer authorizes payment directly on their own phone via Moolre USSD prompt.
                        </p>
                      </div>
                    )}

                    {/* Total Amount Display */}
                    <div className="pt-3 border-t border-[#E5E7EB] text-center">
                      <p className="text-xs font-semibold text-[#6B7280]">Total Amount</p>
                      <p className="mt-1 font-display text-3xl font-extrabold text-[#E60000] tabular-nums">
                        {formatGHS(cartTotals.totalAmount)}
                      </p>
                    </div>

                    {saleError && (
                      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        {saleError}
                      </div>
                    )}

                    {pendingMomo && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                        <p className="font-bold">Moolre Request: {pendingMomo.status.replace(/_/g, ' ')}</p>
                        <p className="font-mono text-[11px]">Ref: {pendingMomo.paymentReference}</p>
                        <p>Waiting for customer ({pendingMomo.phone}) to authorize {formatGHS(pendingMomo.amount)}...</p>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={processingSale || cart.length === 0}
                      onClick={handleCompleteSale}
                      className="w-full rounded-xl bg-[#E60000] py-3.5 text-sm font-bold text-white hover:bg-[#cc0000] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {processingSale
                        ? 'Processing Transaction...'
                        : isOnline
                        ? 'Complete Sale'
                        : 'Queue Cash Sale Offline'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : activeTab === 'history' ? (
            /* Cashier Shift Sales History (NO historical reprint for cashiers per Sec 10) */
            <div className="space-y-4">
              <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
                <div className="bg-[#E60000] px-4 py-3 text-white flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold">Current Shift Transactions</h2>
                  <span className="text-xs tabular-nums">{shiftSales.length} sales</span>
                </div>
                {shiftSales.length === 0 ? (
                  <p className="p-8 text-center text-xs text-[#6B7280]">No sales recorded in this shift yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB] text-xs text-[#6B7280]">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-semibold">Receipt #</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Time</th>
                          <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {shiftSales.map((s) => (
                          <tr key={s.id} className="hover:bg-[#F9FAFB]">
                            <td className="px-4 py-2.5 font-mono text-xs font-semibold">{s.receipt_number}</td>
                            <td className="px-4 py-2.5 text-xs text-[#6B7280] tabular-nums">
                              {new Date(s.created_at).toLocaleTimeString()}
                            </td>
                            <td className="px-4 py-2.5 text-xs capitalize">{s.payment_status}</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                              {formatGHS(Number(s.total_amount))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-white border border-[#E5E7EB] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
                  <h2 className="font-display text-sm font-bold text-[#1F2937]">Shift Expenses</h2>
                  <span className="text-xs text-[#6B7280] tabular-nums">{shiftExpenses.length} expenses</span>
                </div>
                {shiftExpenses.length === 0 ? (
                  <p className="p-6 text-center text-xs text-[#6B7280]">No expenses recorded in this shift yet.</p>
                ) : (
                  <div className="divide-y divide-[#E5E7EB]">
                    {shiftExpenses.map((exp) => (
                      <div key={exp.id} className="px-4 py-3 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-semibold text-[#1F2937]">{exp.expense_name}</p>
                          <p className="text-[#6B7280]">
                            {exp.category_name} · {exp.payment_source.replace('_', ' ')}
                          </p>
                        </div>
                        <span className="font-bold tabular-nums text-[#E60000]">{formatGHS(Number(exp.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'refund' ? (
            /* Cashier Return / Refund Request Form (Owner approves) */
            <div className="max-w-lg mx-auto rounded-xl bg-white border border-[#E5E7EB] p-5">
              <h2 className="font-display text-base font-bold text-[#1F2937]">Submit Return / Refund Request</h2>
              <p className="text-xs text-[#6B7280] mt-1">
                Cashier requests require Shop Owner approval before financial totals or stock are updated.
              </p>
              {refundMessage && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
                  {refundMessage}
                </div>
              )}
              <form onSubmit={handleSubmitRefundRequest} className="mt-4 space-y-3.5">
                <div>
                  <label htmlFor="ret-sale" className="block text-xs font-semibold mb-1">Original Shift Sale</label>
                  <select
                    id="ret-sale"
                    required
                    value={selectedRefundSaleId}
                    onChange={(e) => {
                      setSelectedRefundSaleId(e.target.value);
                      setSelectedRefundItemId('');
                    }}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select receipt...</option>
                    {shiftSales
                      .filter((s) => s.payment_status === 'paid')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.receipt_number} — {formatGHS(Number(s.total_amount))}
                        </option>
                      ))}
                  </select>
                </div>

                {selectedRefundSaleId && (
                  <div>
                    <label htmlFor="ret-item" className="block text-xs font-semibold mb-1">Product Item</label>
                    <select
                      id="ret-item"
                      required
                      value={selectedRefundItemId}
                      onChange={(e) => setSelectedRefundItemId(e.target.value)}
                      className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Select product...</option>
                      {shiftSales
                        .find((s) => s.id === selectedRefundSaleId)
                        ?.sale_items?.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.product_name} ({item.quantity_in_sale_unit} {item.sale_unit_name})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ret-qty" className="block text-xs font-semibold mb-1">Quantity Returned</label>
                    <input
                      id="ret-qty"
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={refundQty}
                      onChange={(e) => setRefundQty(e.target.value)}
                      className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                    />
                  </div>
                  <div>
                    <label htmlFor="ret-amt" className="block text-xs font-semibold mb-1">Refund Amount (GH₵)</label>
                    <input
                      id="ret-amt"
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm tabular-nums"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="ret-cond" className="block text-xs font-semibold mb-1">Product Condition</label>
                  <select
                    id="ret-cond"
                    value={refundCondition}
                    onChange={(e) => setRefundCondition(e.target.value as 'resaleable' | 'damaged' | 'expired')}
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm bg-white"
                  >
                    <option value="resaleable">Resaleable (Return to Stock)</option>
                    <option value="damaged">Damaged (Do Not Restock)</option>
                    <option value="expired">Expired (Do Not Restock)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ret-reason" className="block text-xs font-semibold mb-1">Reason</label>
                  <textarea
                    id="ret-reason"
                    required
                    rows={2}
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Reason for return..."
                    className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
                >
                  Submit Request to Owner
                </button>
              </form>
            </div>
          ) : (
            /* Offline Sync Queue */
            <div className="max-w-2xl mx-auto rounded-xl bg-white border border-[#E5E7EB] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-bold text-[#1F2937]">Offline Cash Queue</h2>
                  <p className="text-xs text-[#6B7280]">
                    Pending local cash transactions have NOT reached Supabase until synchronized.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isOnline || syncingOffline || offlineQueue.length === 0}
                  onClick={handleSyncOffline}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#E60000] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                >
                  <CloudUpload className="h-4 w-4" />
                  {syncingOffline ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>

              {offlineQueue.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#6B7280]">All transactions are synchronized with Supabase.</p>
              ) : (
                <div className="divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-lg">
                  {offlineQueue.map((q) => (
                    <div key={q.clientTxRef} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <p className="font-mono font-semibold">{q.clientTxRef}</p>
                        <p className="text-[#6B7280]">{q.items.length} items · Queued {new Date(q.queuedAt).toLocaleTimeString()}</p>
                        {q.lastError && <p className="text-[#E60000] mt-0.5">{q.lastError}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-bold tabular-nums">{formatGHS(q.totalAmount)}</p>
                        <span className="text-[11px] font-semibold text-amber-700">
                          {q.syncStatus === 'pending_sync' ? 'Pending Sync' : 'Sync Failed'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Camera Barcode Scanner */}
      {showCameraScanner && (
        <CameraBarcodeScannerModal
          onScanSuccess={(code) => handleBarcodeOrSearchSubmit(code)}
          onClose={() => setShowCameraScanner(false)}
        />
      )}

      {/* Post-Sale Digital Receipt */}
      {completedReceipt && (
        <ReceiptModal
          receipt={completedReceipt}
          shop={shopSettings}
          mode="cashier_post_sale"
          onClose={() => setCompletedReceipt(null)}
        />
      )}

      {/* Expense QR Session Modal */}
      {qrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-[#E5E7EB] p-5 text-center space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#1F2937]">Single-Use Expense QR</h3>
              <button
                type="button"
                onClick={() => setQrModal(null)}
                aria-label="Close QR modal"
                className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-[#6B7280]">
              Scan with your smartphone to capture a receipt photo and record the expense. Expires{' '}
              {new Date(qrModal.expiresAt).toLocaleTimeString()}.
            </p>
            <img src={qrModal.qrDataUrl} alt="Single-use expense submission QR code" className="mx-auto rounded-lg border border-[#E5E7EB]" />
            <a
              href={qrModal.submitUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-xs font-semibold text-[#E60000] hover:underline break-all"
            >
              Open Mobile Form Link
            </a>
          </div>
        </div>
      )}

      {/* Close Shift Reconciliation Modal */}
      {closeShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-[#E5E7EB] p-5">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
              <h3 className="font-display text-base font-bold text-[#1F2937]">Close Shift & Cash Reconciliation</h3>
              <button
                type="button"
                onClick={() => setCloseShiftModal(null)}
                aria-label="Cancel shift close"
                className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-1.5 text-xs border-b border-[#E5E7EB] pb-3">
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Opening Cash</span>
                <span className="tabular-nums font-medium">{formatGHS(closeShiftModal.summary.opening_cash)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Cash Sales</span>
                <span className="tabular-nums font-medium">{formatGHS(closeShiftModal.summary.cash_sales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7280]">MoMo Sales (Excluded from Drawer)</span>
                <span className="tabular-nums font-medium">{formatGHS(closeShiftModal.summary.momo_sales)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Cash Drawer Expenses</span>
                <span className="tabular-nums font-medium text-[#E60000]">-{formatGHS(closeShiftModal.summary.cash_expenses)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-1">
                <span>Expected Drawer Cash</span>
                <span className="tabular-nums">{formatGHS(closeShiftModal.summary.expected_cash)}</span>
              </div>
            </div>

            <form onSubmit={handleConfirmCloseShift} className="mt-4 space-y-3">
              <div>
                <label htmlFor="declared-cash" className="block text-xs font-semibold mb-1">
                  Actual Counted Cash in Drawer (GH₵)
                </label>
                <input
                  id="declared-cash"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={declaredCloseCash}
                  onChange={(e) => setDeclaredCloseCash(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-base font-bold tabular-nums focus:outline-none focus:border-[#E60000]"
                />
              </div>
              <div>
                <label htmlFor="closing-notes" className="block text-xs font-semibold mb-1">
                  Closing Notes (Optional)
                </label>
                <textarea
                  id="closing-notes"
                  rows={2}
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#E60000] py-2.5 text-sm font-semibold text-white hover:bg-[#cc0000] cursor-pointer"
              >
                Confirm & Close Shift
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
