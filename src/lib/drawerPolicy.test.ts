import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldOpenDrawer,
  shouldOpenDrawerForSaleResult,
  drawerOperationId,
  printOperationId,
} from './drawerPolicy';

test('completed cash sale opens the drawer', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: 10 }, 'completed'), true);
});

test('completed MoMo-only sale does not open the drawer', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: 0, momoAmount: 50 }, 'completed'), false);
});

test('completed split cash + MoMo sale opens the drawer', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: 20, momoAmount: 30 }, 'completed'), true);
});

test('failed payment never opens the drawer', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: 10 }, 'failed'), false);
});

test('pending MoMo payment never opens the drawer', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: 10 }, 'pending'), false);
});

test('cancelled sale never opens the drawer', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: 10 }, 'cancelled'), false);
});

test('refund outcome does not open the drawer by default', () => {
  assert.equal(shouldOpenDrawer({ cashAmount: -10 }, 'completed'), false);
});

test('sale result helper reads cash_amount and payment status', () => {
  assert.equal(shouldOpenDrawerForSaleResult({ cash_amount: 5, payment_status: 'paid' }), true);
  assert.equal(shouldOpenDrawerForSaleResult({ cash_amount: 0, payment_status: 'paid' }), false);
  assert.equal(shouldOpenDrawerForSaleResult({ cash_amount: 5, payment_status: 'pending' }), false);
  assert.equal(shouldOpenDrawerForSaleResult(null), false);
});

test('operation ids are stable per transaction and distinct per operation', () => {
  assert.equal(drawerOperationId('TX-1'), drawerOperationId('TX-1'));
  assert.equal(drawerOperationId('TX-1'), 'drawer:TX-1');
  assert.equal(printOperationId('TX-1'), 'print:TX-1');
  assert.notEqual(drawerOperationId('TX-1'), printOperationId('TX-1'));
  assert.notEqual(drawerOperationId('TX-1'), drawerOperationId('TX-2'));
});