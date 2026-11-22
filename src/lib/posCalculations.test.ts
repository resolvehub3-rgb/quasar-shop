import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartTotals,
  calculateCashChange,
  calculateExpectedDrawerCash,
  calculateShiftDiscrepancy,
  reconcileSplitPayment,
} from './posCalculations';

test('calculateCartTotals computes subtotal, discount, and hides profit if cost basis missing', () => {
  const withCosts = calculateCartTotals(
    [
      { quantity: 2, unitPrice: 50, conversionToBase: 1, costBasisPerBaseUnit: 35 },
      { quantity: 1, unitPrice: 20, conversionToBase: 0.5, costBasisPerBaseUnit: 28 },
    ],
    10
  );
  assert.equal(withCosts.subtotal, 120);
  assert.equal(withCosts.totalAmount, 110);
  assert.equal(withCosts.estimatedCogs, 84); // 2*1*35 + 1*0.5*28 = 70 + 14 = 84
  assert.equal(withCosts.estimatedGrossProfit, 26);

  const missingCost = calculateCartTotals([
    { quantity: 1, unitPrice: 50, conversionToBase: 1, costBasisPerBaseUnit: null },
  ]);
  assert.equal(missingCost.estimatedCogs, null);
  assert.equal(missingCost.estimatedGrossProfit, null);
});

test('cash change and split payments reconcile accurately', () => {
  const change = calculateCashChange(85, 100);
  assert.equal(change.valid, true);
  assert.equal(change.change, 15);

  const split = reconcileSplitPayment(80, 50, 30);
  assert.equal(split.isFullyCovered, true);
  assert.equal(split.remainingDue, 0);

  const partial = reconcileSplitPayment(80, 50, 0);
  assert.equal(partial.isFullyCovered, false);
  assert.equal(partial.remainingDue, 30);
});

test('shift expected cash excludes MoMo and computes shortage/surplus accurately', () => {
  // Opening 200 + Cash Sales 450 - Cash Drawer Expenses 75 - Cash Refunds 25 + Cash In 50 - Cash Out 20 = 580
  const expected = calculateExpectedDrawerCash({
    openingCash: 200,
    cashSales: 450,
    cashDrawerExpenses: 75,
    cashRefunds: 25,
    otherCashIn: 50,
    otherCashOut: 20,
  });
  assert.equal(expected, 580);

  assert.deepEqual(calculateShiftDiscrepancy(580, 580), { difference: 0, status: 'balanced' });
  assert.deepEqual(calculateShiftDiscrepancy(565, 580), { difference: -15, status: 'shortage' });
  assert.deepEqual(calculateShiftDiscrepancy(595, 580), { difference: 15, status: 'surplus' });
});
