const test = require('node:test');
const assert = require('node:assert');
const { buildReceipt, buildDrawerKick } = require('../dist/printers/escpos');

test('buildReceipt returns Buffer with init and cut', () => {
  const buf = buildReceipt({
    receiptNumber: 'R1', clientTxRef: 'TX1', date: new Date().toISOString(), cashierName: 'A',
    items: [{ product_name: 'Item', quantity: 1, unit_price: 2, line_total: 2 }],
    subtotal: 2, discount: 0, total: 2, payments: [{ method: 'cash', amount: 2 }], changeGiven: 0,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 0);
  assert.equal(buf[0], 0x1b);
  assert.equal(buf[1], 0x40);
});

test('buildDrawerKick includes drawer command', () => {
  const buf = buildDrawerKick();
  assert.ok(buf.includes(Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])));
});