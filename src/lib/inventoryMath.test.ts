import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBaseQuantity,
  computeBaseUnitCost,
  computeUnitPrice,
  evaluateStockAlert,
} from './inventoryMath';

test('liquid volume conversion deducts exact decimal litres (500 ml from 25 L container)', () => {
  const deducted = computeBaseQuantity(1, 0.5);
  assert.equal(deducted, 0.5);
  const remaining = 25 - deducted;
  assert.equal(remaining, 24.5);

  // Selling 3 x 250ml bottles
  assert.equal(computeBaseQuantity(3, 0.25), 0.75);
});

test('weight conversion handles custom kg and gram measurements', () => {
  assert.equal(computeBaseQuantity(1, 0.25), 0.25); // 250g from kg base
  assert.equal(computeBaseQuantity(1.5, 1), 1.5); // 1.5 kg custom weight
  assert.equal(computeBaseQuantity(2, 50), 100); // 2 sacks of 50kg
});

test('computeBaseUnitCost derives per-piece cost from carton purchase cost', () => {
  assert.equal(computeBaseUnitCost(240, 24), 10);
  assert.equal(computeBaseUnitCost(312.5, 25), 12.5);
});

test('computeUnitPrice respects explicit override or scales proportionally', () => {
  assert.equal(computeUnitPrice(40, 0.5, null), 20);
  assert.equal(computeUnitPrice(40, 0.25, 12), 12);
});

test('evaluateStockAlert detects out-of-stock, low-stock, expiring soon, and expired items', () => {
  const ref = new Date('2026-11-21T10:00:00Z');
  const low = evaluateStockAlert(3, 5, '2026-11-24', ref, 14);
  assert.equal(low.stockLevel, 'low_stock');
  assert.equal(low.isExpiringSoon, true);
  assert.equal(low.isExpired, false);

  const expired = evaluateStockAlert(10, 5, '2026-11-10', ref, 14);
  assert.equal(expired.stockLevel, 'healthy');
  assert.equal(expired.isExpired, true);
});
