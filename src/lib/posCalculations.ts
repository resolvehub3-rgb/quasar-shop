import { roundTo } from './inventoryMath';

export interface CartCalculationItem {
  quantity: number;
  unitPrice: number;
  conversionToBase: number;
  costBasisPerBaseUnit?: number | null;
}

export interface CartTotals {
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  estimatedCogs: number | null;
  estimatedGrossProfit: number | null;
}

export interface ShiftCashInput {
  openingCash: number;
  cashSales: number;
  cashDrawerExpenses: number;
  cashRefunds?: number;
  otherCashIn?: number;
  otherCashOut?: number;
}

export function formatGHS(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `GH₵ ${safe.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calculateCartTotals(
  items: CartCalculationItem[],
  discountAmount = 0
): CartTotals {
  const subtotal = roundTo(
    items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    2
  );
  const clampedDiscount = roundTo(Math.min(Math.max(0, discountAmount), subtotal), 2);
  const totalAmount = roundTo(Math.max(0, subtotal - clampedDiscount), 2);

  // Only compute gross profit when ALL items have an authentic recorded cost basis
  const hasAllCosts =
    items.length > 0 &&
    items.every((item) => item.costBasisPerBaseUnit !== null && item.costBasisPerBaseUnit !== undefined);

  let estimatedCogs: number | null = null;
  let estimatedGrossProfit: number | null = null;

  if (hasAllCosts) {
    estimatedCogs = roundTo(
      items.reduce(
        (sum, item) =>
          sum + item.quantity * item.conversionToBase * (item.costBasisPerBaseUnit ?? 0),
        0
      ),
      2
    );
    estimatedGrossProfit = roundTo(totalAmount - estimatedCogs, 2);
  }

  return {
    subtotal,
    discountAmount: clampedDiscount,
    totalAmount,
    estimatedCogs,
    estimatedGrossProfit,
  };
}

export function calculateCashChange(cashDue: number, cashTendered: number): {
  valid: boolean;
  change: number;
  shortfall: number;
} {
  const due = roundTo(Math.max(0, cashDue), 2);
  const tendered = roundTo(Math.max(0, cashTendered), 2);
  if (tendered >= due) {
    return { valid: true, change: roundTo(tendered - due, 2), shortfall: 0 };
  }
  return { valid: false, change: 0, shortfall: roundTo(due - tendered, 2) };
}

export function reconcileSplitPayment(
  totalDue: number,
  cashApplied: number,
  momoApplied: number
): {
  isFullyCovered: boolean;
  remainingDue: number;
  totalAllocated: number;
} {
  const due = roundTo(Math.max(0, totalDue), 2);
  const allocated = roundTo(Math.max(0, cashApplied) + Math.max(0, momoApplied), 2);
  const remaining = roundTo(Math.max(0, due - allocated), 2);
  return {
    isFullyCovered: remaining === 0 && due > 0,
    remainingDue: remaining,
    totalAllocated: allocated,
  };
}

/**
 * Exact Shift Expected Cash Formula:
 * Opening Cash + Cash Sales - Cash-paid Drawer Expenses + Other Cash In - Other Cash Out - Cash Refunds
 * Never includes MoMo sales or subtracts MoMo-paid expenses.
 */
export function calculateExpectedDrawerCash(input: ShiftCashInput): number {
  const opening = input.openingCash || 0;
  const sales = input.cashSales || 0;
  const expenses = input.cashDrawerExpenses || 0;
  const refunds = input.cashRefunds || 0;
  const cashIn = input.otherCashIn || 0;
  const cashOut = input.otherCashOut || 0;
  return roundTo(opening + sales - expenses - refunds + cashIn - cashOut, 2);
}

export function calculateShiftDiscrepancy(declaredCash: number, expectedCash: number): {
  difference: number;
  status: 'balanced' | 'shortage' | 'surplus';
} {
  const diff = roundTo(declaredCash - expectedCash, 2);
  if (diff === 0) return { difference: 0, status: 'balanced' };
  return { difference: diff, status: diff < 0 ? 'shortage' : 'surplus' };
}
