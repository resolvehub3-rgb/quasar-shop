import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart,
  Banknote,
  Smartphone,
  Wallet,
  TrendingUp,
  Scale,
  Package,
  AlertTriangle,
  Calendar,
  ArrowRight,
  Clock,
  Truck,
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatGHS } from '../../lib/posCalculations';
import { evaluateStockAlert } from '../../lib/inventoryMath';
import type { Product, SaleRecord, ExpenseRecord, CashierShift, Supplier } from '../../types/database';

type DateRange = 'today' | '7d' | '30d';

export const OwnerDashboardPage: React.FC = () => {
  const [range, setRange] = useState<DateRange>('today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pendingReturnsCount, setPendingReturnsCount] = useState(0);

  const fetchDashboard = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const daysBack = range === 'today' ? 1 : range === '7d' ? 7 : 30;
      const startDate = new Date();
      if (range === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else {
        startDate.setDate(startDate.getDate() - (daysBack - 1));
        startDate.setHours(0, 0, 0, 0);
      }

      // Always fetch last 7 days for the Sales Overview chart as well
      const chartStart = new Date();
      chartStart.setDate(chartStart.getDate() - 6);
      chartStart.setHours(0, 0, 0, 0);
      const queryStart = startDate < chartStart ? startDate : chartStart;

      const [salesRes, expRes, prodRes, shiftRes, supRes, retRes] = await Promise.all([
        supabase
          .from('sales')
          .select('id, receipt_number, total_amount, paid_amount, discount_amount, payment_status, created_at, payments(method, amount, status), sale_items(quantity_in_sale_unit, conversion_to_base, cost_basis_per_base_unit, line_total)')
          .gte('created_at', queryStart.toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('expenses')
          .select('id, expense_ref, expense_name, category_name, amount, payment_source, status, created_at')
          .eq('status', 'recorded')
          .gte('created_at', queryStart.toISOString())
          .order('created_at', { ascending: false }),
        supabase
          .from('products')
          .select('id, name, stock_quantity, min_stock_level, expiry_date, is_archived, purchase_cost, selling_price')
          .eq('is_archived', false),
        supabase
          .from('cashier_shifts')
          .select('id, shift_ref, status, opened_at, closed_at, opening_cash, expected_cash, declared_cash, cash_discrepancy, cashiers(full_name)')
          .order('opened_at', { ascending: false })
          .limit(6),
        supabase.from('suppliers').select('id, name, outstanding_balance').eq('is_active', true),
        supabase.from('return_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);

      if (salesRes.error) throw salesRes.error;
      setSales((salesRes.data as unknown as SaleRecord[]) || []);
      setExpenses((expRes.data as unknown as ExpenseRecord[]) || []);
      setProducts((prodRes.data as unknown as Product[]) || []);
      setShifts((shiftRes.data as unknown as CashierShift[]) || []);
      setSuppliers((supRes.data as unknown as Supplier[]) || []);
      setPendingReturnsCount(retRes.count || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard metrics');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Realtime subscription on operational tables
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const channel = client
      .channel('owner-dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cashier_shifts' }, () => fetchDashboard())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchDashboard())
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [fetchDashboard]);

  const metrics = useMemo(() => {
    const start = new Date();
    if (range === 'today') {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(start.getDate() - (range === '7d' ? 6 : 29));
      start.setHours(0, 0, 0, 0);
    }

    const filteredSales = sales.filter(
      (s) =>
        new Date(s.created_at) >= start &&
        ['paid', 'partial', 'partially_refunded'].includes(s.payment_status)
    );
    const filteredExpenses = expenses.filter((e) => new Date(e.created_at) >= start);

    const totalSales = filteredSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
    let cashSales = 0;
    let momoSales = 0;

    let costTrackedRevenue = 0;
    let totalCogs = 0;
    let hasAllCostData = filteredSales.length > 0;

    for (const s of filteredSales) {
      for (const p of s.payments || []) {
        if (p.status === 'successful') {
          if (p.method === 'cash') cashSales += Number(p.amount);
          if (p.method === 'momo') momoSales += Number(p.amount);
        }
      }
      for (const item of s.sale_items || []) {
        if (item.cost_basis_per_base_unit === null || item.cost_basis_per_base_unit === undefined) {
          hasAllCostData = false;
        } else {
          costTrackedRevenue += Number(item.line_total);
          totalCogs +=
            Number(item.quantity_in_sale_unit) *
            Number(item.conversion_to_base) *
            Number(item.cost_basis_per_base_unit);
        }
      }
    }

    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const estimatedGrossProfit =
      hasAllCostData && filteredSales.length > 0 ? totalSales - totalCogs : null;
    const estimatedNetProfit =
      estimatedGrossProfit !== null ? estimatedGrossProfit - totalExpenses : null;

    const alerts: Array<{ level: 'warning' | 'danger' | 'info'; message: string }> = [];
    let lowStockCount = 0;
    let expiringCount = 0;

    for (const p of products) {
      const status = evaluateStockAlert(Number(p.stock_quantity), Number(p.min_stock_level), p.expiry_date);
      if (status.stockLevel === 'low_stock' || status.stockLevel === 'out_of_stock') {
        lowStockCount += 1;
        alerts.push({
          level: status.stockLevel === 'out_of_stock' ? 'danger' : 'warning',
          message:
            status.stockLevel === 'out_of_stock'
              ? `Out of stock: ${p.name}`
              : `Low stock: ${p.name} (${Number(p.stock_quantity)} left)`,
        });
      }
      if (status.isExpired || status.isExpiringSoon) {
        expiringCount += 1;
        alerts.push({
          level: status.isExpired ? 'danger' : 'info',
          message: status.isExpired
            ? `Expired product: ${p.name}`
            : `Nearing expiry: ${p.name} (${status.daysUntilExpiry} days)`,
        });
      }
    }

    if (pendingReturnsCount > 0) {
      alerts.unshift({
        level: 'warning',
        message: `${pendingReturnsCount} refund request(s) awaiting owner review`,
      });
    }

    const supplierBalanceTotal = suppliers.reduce((sum, s) => sum + Number(s.outstanding_balance), 0);

    // 7-day chart buckets
    const chartDays: Array<{ label: string; sales: number; expenses: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const daySales = sales
        .filter((s) => s.created_at.slice(0, 10) === key && s.payment_status === 'paid')
        .reduce((a, b) => a + Number(b.total_amount), 0);
      const dayExp = expenses
        .filter((e) => e.created_at.slice(0, 10) === key)
        .reduce((a, b) => a + Number(b.amount), 0);
      chartDays.push({
        label: d.toLocaleDateString('en-US', { weekday: 'short' }),
        sales: daySales,
        expenses: dayExp,
      });
    }

    return {
      totalSales,
      cashSales,
      momoSales,
      totalExpenses,
      estimatedGrossProfit,
      estimatedNetProfit,
      productsInStock: products.filter((p) => Number(p.stock_quantity) > 0).length,
      lowStockCount,
      expiringCount,
      supplierBalanceTotal,
      alerts: alerts.slice(0, 6),
      recentSales: filteredSales.slice(0, 5),
      chartDays,
      costTrackedRevenue,
    };
  }, [sales, expenses, products, suppliers, pendingReturnsCount, range]);

  const paymentTotal = metrics.cashSales + metrics.momoSales;
  const cashPct = paymentTotal > 0 ? Math.round((metrics.cashSales / paymentTotal) * 100) : 0;

  // SVG line chart scaling
  const maxChartVal = Math.max(
    100,
    ...metrics.chartDays.map((d) => Math.max(d.sales, d.expenses))
  );

  return (
    <div className="space-y-5">
      {/* Header & Date Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#1F2937]">Dashboard</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Live shop metrics synchronized with Supabase PostgreSQL
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5">
          <Calendar className="h-4 w-4 text-[#6B7280]" />
          <select
            aria-label="Dashboard date range"
            value={range}
            onChange={(e) => setRange(e.target.value as DateRange)}
            className="text-xs font-semibold text-[#1F2937] bg-transparent focus:outline-none cursor-pointer"
          >
            <option value="today">Today</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* KPI Row 1 (4 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4 flex items-center gap-4">
          <div className="h-11 w-11 rounded-full bg-[#E60000]/10 text-[#E60000] flex items-center justify-center shrink-0">
            <ShoppingCart className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#6B7280]">
              {range === 'today' ? "Today's Sales" : range === '7d' ? '7-Day Sales' : '30-Day Sales'}
            </p>
            <p className="font-display text-xl font-bold text-[#1F2937] tabular-nums truncate">
              {loading ? '...' : formatGHS(metrics.totalSales)}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4 flex items-center gap-4">
          <div className="h-11 w-11 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Banknote className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#6B7280]">Cash Sales</p>
            <p className="font-display text-xl font-bold text-[#1F2937] tabular-nums truncate">
              {loading ? '...' : formatGHS(metrics.cashSales)}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4 flex items-center gap-4">
          <div className="h-11 w-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#6B7280]">MoMo Sales</p>
            <p className="font-display text-xl font-bold text-[#1F2937] tabular-nums truncate">
              {loading ? '...' : formatGHS(metrics.momoSales)}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4 flex items-center gap-4">
          <div className="h-11 w-11 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#6B7280]">Expenses</p>
            <p className="font-display text-xl font-bold text-[#1F2937] tabular-nums truncate">
              {loading ? '...' : formatGHS(metrics.totalExpenses)}
            </p>
          </div>
        </div>
      </div>

      {/* KPI Row 2 (5 metrics: Profit, Stock, Low Stock, Supplier Balances) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[#6B7280]">
            <TrendingUp className="h-4 w-4 text-amber-600" />
            <span>Estimated Gross Profit</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-[#1F2937] tabular-nums">
            {metrics.estimatedGrossProfit !== null
              ? formatGHS(metrics.estimatedGrossProfit)
              : 'Cost basis unavailable'}
          </p>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[#6B7280]">
            <Scale className="h-4 w-4 text-blue-600" />
            <span>Estimated Net Profit</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-[#1F2937] tabular-nums">
            {metrics.estimatedNetProfit !== null
              ? formatGHS(metrics.estimatedNetProfit)
              : 'Cost basis unavailable'}
          </p>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[#6B7280]">
            <Package className="h-4 w-4 text-orange-600" />
            <span>Products in Stock</span>
          </div>
          <p className="mt-2 font-display text-lg font-bold text-[#1F2937] tabular-nums">
            {metrics.productsInStock}
          </p>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#6B7280]">
              <AlertTriangle className="h-4 w-4 text-[#E60000]" />
              <span>Low-Stock / Expiring</span>
            </div>
            <p className="mt-2 font-display text-lg font-bold text-[#1F2937] tabular-nums">
              {metrics.lowStockCount} / {metrics.expiringCount}
            </p>
          </div>
          <Link to="/owner/products" className="text-xs font-semibold text-[#E60000] hover:underline">
            View →
          </Link>
        </div>

        <div className="rounded-xl bg-white border border-[#E5E7EB] p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-[#6B7280]">
              <Truck className="h-4 w-4 text-[#6B7280]" />
              <span>Supplier Balances</span>
            </div>
            <p className="mt-2 font-display text-lg font-bold text-[#1F2937] tabular-nums">
              {formatGHS(metrics.supplierBalanceTotal)}
            </p>
          </div>
          <Link to="/owner/suppliers" className="text-xs font-semibold text-[#E60000] hover:underline">
            Pay →
          </Link>
        </div>
      </div>

      {/* Charts & Recent Transactions Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Sales Overview Chart (5 cols) */}
        <div className="lg:col-span-5 rounded-xl bg-white border border-[#E5E7EB] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold text-[#1F2937]">Sales Overview (7 Days)</h2>
            <div className="flex items-center gap-3 text-[11px] text-[#6B7280]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#E60000]" /> Sales
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[#6B7280]" /> Expenses
              </span>
            </div>
          </div>

          {sales.length === 0 && expenses.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-center text-xs text-[#6B7280]">
              No sales or expense records yet. Complete a sale or record an expense to see live trends.
            </div>
          ) : (
            <svg viewBox="0 0 360 170" className="w-full h-48 overflow-visible" role="img" aria-label="7-day sales and expenses line chart">
              {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
                const y = 135 - t * 115;
                return (
                  <g key={i}>
                    <line x1="35" y1={y} x2="350" y2={y} stroke="#E5E7EB" strokeDasharray="3 3" />
                    <text x="0" y={y + 3} fontSize="9" fill="#6B7280">
                      {Math.round(maxChartVal * t)}
                    </text>
                  </g>
                );
              })}

              {/* Sales polyline */}
              <polyline
                fill="none"
                stroke="#E60000"
                strokeWidth="2.5"
                points={metrics.chartDays
                  .map((d, idx) => {
                    const x = 45 + idx * 48;
                    const y = 135 - (d.sales / maxChartVal) * 115;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />
              {/* Expenses polyline */}
              <polyline
                fill="none"
                stroke="#6B7280"
                strokeWidth="2"
                points={metrics.chartDays
                  .map((d, idx) => {
                    const x = 45 + idx * 48;
                    const y = 135 - (d.expenses / maxChartVal) * 115;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />

              {metrics.chartDays.map((d, idx) => {
                const x = 45 + idx * 48;
                const yS = 135 - (d.sales / maxChartVal) * 115;
                return (
                  <g key={d.label}>
                    <circle cx={x} cy={yS} r="3.5" fill="#E60000" />
                    <text x={x} y="156" textAnchor="middle" fontSize="10" fill="#6B7280">
                      {d.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Payment Breakdown Donut (3 cols) */}
        <div className="lg:col-span-3 rounded-xl bg-white border border-[#E5E7EB] p-5 flex flex-col justify-between">
          <h2 className="font-display text-base font-bold text-[#1F2937]">Payment Breakdown</h2>

          {paymentTotal === 0 ? (
            <p className="py-12 text-center text-xs text-[#6B7280]">No settled payments in this period.</p>
          ) : (
            <div className="my-3 flex items-center justify-center">
              <div className="relative h-36 w-36">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <circle cx="60" cy="60" r="46" fill="none" stroke="#2563EB" strokeWidth="16" />
                  <circle
                    cx="60"
                    cy="60"
                    r="46"
                    fill="none"
                    stroke="#E60000"
                    strokeWidth="16"
                    strokeDasharray={`${(cashPct / 100) * 289} 289`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-display text-xl font-bold text-[#1F2937] tabular-nums">{cashPct}%</span>
                  <span className="text-[11px] text-[#6B7280]">Cash</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5 text-xs pt-2 border-t border-[#E5E7EB]">
            <div className="flex justify-between">
              <span className="text-[#6B7280]">Cash</span>
              <span className="font-semibold tabular-nums">{formatGHS(metrics.cashSales)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6B7280]">MoMo</span>
              <span className="font-semibold tabular-nums">{formatGHS(metrics.momoSales)}</span>
            </div>
          </div>
        </div>

        {/* Recent Transactions (4 cols) */}
        <div className="lg:col-span-4 rounded-xl bg-white border border-[#E5E7EB] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base font-bold text-[#1F2937]">Recent Transactions</h2>
            <Link
              to="/owner/sales"
              className="inline-flex items-center gap-1 rounded-lg bg-[#E60000] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#cc0000]"
            >
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {metrics.recentSales.length === 0 ? (
            <p className="py-12 text-center text-xs text-[#6B7280]">No sales recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[#6B7280] border-b border-[#E5E7EB]">
                  <tr>
                    <th className="text-left py-2 font-semibold">Receipt</th>
                    <th className="text-right py-2 font-semibold">Amount</th>
                    <th className="text-right py-2 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {metrics.recentSales.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 font-mono font-medium">{s.receipt_number}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {formatGHS(Number(s.total_amount))}
                      </td>
                      <td className="py-2 text-right text-[#6B7280] tabular-nums">
                        {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Row: Cashier Shift Activity & Business Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 rounded-xl bg-white border border-[#E5E7EB] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base font-bold text-[#1F2937]">Cashier Shift Activity</h2>
            <Link
              to="/owner/shifts"
              className="inline-flex items-center gap-1 rounded-lg bg-[#E60000] px-2.5 py-1 text-[11px] font-semibold text-white"
            >
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {shifts.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#6B7280]">No cashier shifts opened yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[#6B7280] border-b border-[#E5E7EB]">
                  <tr>
                    <th className="text-left py-2 font-semibold">Cashier</th>
                    <th className="text-left py-2 font-semibold">Shift Ref</th>
                    <th className="text-left py-2 font-semibold">Status</th>
                    <th className="text-right py-2 font-semibold">Opened At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {shifts.map((sh) => (
                    <tr key={sh.id}>
                      <td className="py-2.5 font-medium">{sh.cashiers?.full_name || 'Cashier'}</td>
                      <td className="py-2.5 font-mono text-[#6B7280]">{sh.shift_ref}</td>
                      <td className="py-2.5 capitalize font-semibold">
                        <span className={sh.status === 'open' ? 'text-emerald-700' : 'text-[#6B7280]'}>
                          {sh.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-[#6B7280] tabular-nums">
                        {new Date(sh.opened_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 rounded-xl bg-white border border-[#E5E7EB] p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base font-bold text-[#1F2937]">Business Alerts</h2>
            <Link to="/owner/products" className="text-xs font-semibold text-[#E60000] hover:underline">
              Manage Stock →
            </Link>
          </div>
          {metrics.alerts.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#6B7280]">
              <Clock className="h-5 w-5 mx-auto mb-1.5 text-gray-400" />
              No active low-stock, expiry, or refund alerts.
            </div>
          ) : (
            <ul className="space-y-2 text-xs">
              {metrics.alerts.map((a, idx) => (
                <li key={idx} className="flex items-start gap-2.5 py-1.5 border-b border-[#F3F4F6] last:border-0">
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 mt-0.5 ${
                      a.level === 'danger' ? 'text-[#E60000]' : a.level === 'warning' ? 'text-amber-600' : 'text-blue-600'
                    }`}
                  />
                  <span className="text-[#1F2937]">{a.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
