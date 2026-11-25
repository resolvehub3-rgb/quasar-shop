import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  looksLikeScannerBurst,
  normalizeScannedBarcode,
  isTextInputElement,
} from './barcodeScan';

test('looksLikeScannerBurst accepts fast burst', () => {
  assert.equal(looksLikeScannerBurst('1234567890', 100), true);
});

test('looksLikeScannerBurst rejects too short', () => {
  assert.equal(looksLikeScannerBurst('12', 10), false);
});

test('looksLikeScannerBurst rejects slow human typing', () => {
  assert.equal(looksLikeScannerBurst('1234567890', 2000), false);
});

test('normalizeScannedBarcode trims', () => {
  assert.equal(normalizeScannedBarcode('  12345\n'), '12345');
});

test('isTextInputElement detects input', () => {
  const el = { tagName: 'INPUT' } as any;
  assert.equal(isTextInputElement(el), true);
  const div = { tagName: 'DIV' } as any;
  assert.equal(isTextInputElement(div), false);
});
