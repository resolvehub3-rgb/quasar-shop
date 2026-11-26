const test = require('node:test');
const assert = require('node:assert');
const { enumeratePrinters, isPrinterOnline } = require('../dist/printers/windowsPrinter');

test('printer enumeration returns an array on Windows', async () => {
  const printers = await enumeratePrinters();
  assert.ok(Array.isArray(printers));
  if (process.platform === 'win32') {
    // Windows always exposes at least a virtual printer driver
    assert.ok(printers.length > 0, 'expected at least one Windows printer');
    for (const p of printers) {
      assert.equal(typeof p.name, 'string');
      assert.ok(p.name.length > 0);
    }
  }
});

test('isPrinterOnline reflects offline flag', () => {
  assert.equal(isPrinterOnline({ name: 'p', printerStatus: 0, workOffline: false }), true);
  assert.equal(isPrinterOnline({ name: 'p', printerStatus: 0, workOffline: true }), false);
  assert.equal(isPrinterOnline({ name: 'p', printerStatus: 4, workOffline: false }), false);
  assert.equal(isPrinterOnline({ name: 'p', printerStatus: undefined, workOffline: undefined }), true);
});