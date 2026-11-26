export function escposInit(): Buffer { return Buffer.from([0x1b, 0x40]); }
export function escposAlign(n: number): Buffer { return Buffer.from([0x1b, 0x61, n]); }
export function escposBold(on: boolean): Buffer { return Buffer.from([0x1b, 0x45, on ? 1 : 0]); }
export function escposText(s: string): Buffer { return Buffer.from(String(s ?? ''), 'utf8'); }
export function escposNewline(): Buffer { return Buffer.from([0x0a]); }
export function escposCut(): Buffer { return Buffer.from([0x1d, 0x56, 0x00]); }
export function escposDrawerKick(): Buffer {
  // ESC p 0 25 250 (pin 2)
  return Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
}

export interface ReceiptPayload {
  shopName?: string;
  shopPhone?: string | null;
  shopAddress?: string | null;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  receiptNumber: string;
  clientTxRef: string;
  date: string;
  cashierName: string;
  paperWidth?: string;
  items: Array<{ product_name: string; unit_name?: string; quantity: number; unit_price: number; line_total: number }>;
  subtotal: number;
  discount?: number;
  total: number;
  payments?: Array<{ method: string; network?: string; amount: number }>;
  changeGiven?: number;
}

export function buildReceipt(payload: ReceiptPayload): Buffer {
  const width = payload.paperWidth === '58mm' ? 32 : 48;
  const line = (ch: string) => ch.repeat(width);
  const chunks: Buffer[] = [];
  const push = (b: Buffer) => chunks.push(b);

  push(escposInit());
  push(escposAlign(1));
  push(escposBold(true));
  push(escposText('QUSAR VENTURES'));
  push(escposNewline());
  push(escposText(payload.shopName || 'Shop'));
  push(escposNewline());
  push(escposBold(false));
  if (payload.shopAddress) { push(escposText(payload.shopAddress)); push(escposNewline()); }
  if (payload.shopPhone) { push(escposText('Tel: ' + payload.shopPhone)); push(escposNewline()); }
  if (payload.receiptHeader) { push(escposText(payload.receiptHeader)); push(escposNewline()); }
  push(escposText(line('-')));
  push(escposNewline());

  push(escposAlign(0));
  push(escposText('Receipt #: ' + payload.receiptNumber));
  push(escposNewline());
  push(escposText('Ref: ' + payload.clientTxRef));
  push(escposNewline());
  push(escposText('Date: ' + new Date(payload.date).toLocaleString()));
  push(escposNewline());
  push(escposText('Cashier: ' + payload.cashierName));
  push(escposNewline());
  push(escposText(line('-')));
  push(escposNewline());

  for (const item of payload.items || []) {
    push(escposText(item.product_name));
    push(escposNewline());
    const qty = String(item.quantity);
    const price = Number(item.unit_price).toFixed(2);
    const total = Number(item.line_total).toFixed(2);
    const detail = `  ${qty} x ${price} = ${total}`;
    push(escposText(detail));
    push(escposNewline());
  }
  push(escposText(line('-')));
  push(escposNewline());

  push(escposAlign(2));
  push(escposText('Subtotal: ' + Number(payload.subtotal).toFixed(2)));
  push(escposNewline());
  if (Number(payload.discount) > 0) {
    push(escposText('Discount: -' + Number(payload.discount).toFixed(2)));
    push(escposNewline());
  }
  push(escposBold(true));
  push(escposText('TOTAL: ' + Number(payload.total).toFixed(2)));
  push(escposNewline());
  push(escposBold(false));

  push(escposAlign(0));
  for (const p of payload.payments || []) {
    push(escposText(String(p.method).toUpperCase() + (p.network ? ' (' + p.network + ')' : '') + ': ' + Number(p.amount).toFixed(2)));
    push(escposNewline());
  }
  if (Number(payload.changeGiven) > 0) {
    push(escposText('Change Given: ' + Number(payload.changeGiven).toFixed(2)));
    push(escposNewline());
  }
  push(escposText(line('-')));
  push(escposNewline());

  push(escposAlign(1));
  if (payload.receiptFooter) { push(escposText(payload.receiptFooter)); push(escposNewline()); }
  push(escposText('Thank you!'));
  push(escposNewline());
  push(escposNewline());
  push(escposCut());

  return Buffer.concat(chunks);
}

export function buildDrawerKick(): Buffer {
  return Buffer.concat([escposInit(), escposDrawerKick()]);
}

export function buildTestReceipt(paperWidth: string): Buffer {
  return buildReceipt({
    shopName: 'QusarShop Test',
    shopAddress: 'Hardware bridge test print',
    receiptNumber: 'TEST-' + Date.now(),
    clientTxRef: 'BRIDGE-TEST',
    date: new Date().toISOString(),
    cashierName: 'Bridge',
    paperWidth,
    items: [{ product_name: 'Test Item', unit_name: 'pcs', quantity: 1, unit_price: 1.0, line_total: 1.0 }],
    subtotal: 1.0,
    discount: 0,
    total: 1.0,
    payments: [{ method: 'cash', amount: 1.0 }],
    changeGiven: 0,
    receiptHeader: 'Printer diagnostics',
    receiptFooter: 'End of test',
  });
}