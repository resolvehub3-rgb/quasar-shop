import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { StockMovementRecord, ReceiptSnapshot, ShopSettings } from '../types/database';
import { formatGHS } from './posCalculations';

export function exportStorebookToExcel(rows: StockMovementRecord[], filename = 'storebook-ledger.xlsx') {
  const data = rows.map((r) => ({
    'Date & Time': new Date(r.created_at).toLocaleString(),
    Product: r.products?.name || r.product_id,
    'Transaction Ref': r.transaction_ref,
    'Movement Type': r.movement_type,
    Description: r.description,
    'Stock In': Number(r.stock_in),
    'Stock Out': Number(r.stock_out),
    'Running Balance': Number(r.running_balance),
    Unit: r.products?.measurement_units?.code || '',
    'Actor': `${r.actor_name} (${r.actor_type})`,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Storebook');
  XLSX.writeFile(wb, filename);
}

export function exportStorebookToPdf(
  rows: StockMovementRecord[],
  shopName = 'Provision Shop',
  filename = 'storebook-ledger.pdf'
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(`${shopName} — Storebook Stock Movement Ledger`, 14, 16);
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()} | Records: ${rows.length}`, 14, 22);

  autoTable(doc, {
    startY: 28,
    head: [['Date & Time', 'Product', 'Ref', 'Type', 'Description', 'In', 'Out', 'Balance', 'User']],
    body: rows.map((r) => [
      new Date(r.created_at).toLocaleString(),
      r.products?.name || r.product_id,
      r.transaction_ref,
      r.movement_type.replace(/_/g, ' '),
      r.description,
      Number(r.stock_in).toFixed(2),
      Number(r.stock_out).toFixed(2),
      `${Number(r.running_balance).toFixed(2)} ${r.products?.measurement_units?.code || ''}`.trim(),
      r.actor_name,
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [230, 0, 0] },
  });

  doc.save(filename);
}

export function exportReceiptToPdf(receipt: ReceiptSnapshot, shop?: ShopSettings | null) {
  const doc = new jsPDF({ unit: 'mm', format: [80, 180] });
  let y = 10;
  doc.setFontSize(12);
  doc.text(shop?.shop_name || 'Provision Shop', 40, y, { align: 'center' });
  y += 5;
  doc.setFontSize(8);
  if (shop?.address) {
    doc.text(shop.address, 40, y, { align: 'center' });
    y += 4;
  }
  if (shop?.phone) {
    doc.text(`Tel: ${shop.phone}`, 40, y, { align: 'center' });
    y += 4;
  }
  y += 2;
  doc.text(`Receipt: ${receipt.receipt_number}`, 5, y);
  y += 4;
  doc.text(`Date: ${new Date(receipt.date).toLocaleString()}`, 5, y);
  y += 4;
  doc.text(`Cashier: ${receipt.cashier_name}`, 5, y);
  y += 5;

  autoTable(doc, {
    startY: y,
    margin: { left: 4, right: 4 },
    head: [['Item', 'Qty', 'Total']],
    body: receipt.items.map((item) => [
      `${item.product_name} (${item.unit_name})`,
      String(item.quantity),
      formatGHS(item.line_total),
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [31, 41, 55] },
  });

  const finalY = (doc as any).lastAutoTable?.finalY + 5 || y + 30;
  doc.setFontSize(9);
  doc.text(`Subtotal: ${formatGHS(receipt.subtotal)}`, 75, finalY, { align: 'right' });
  if (receipt.discount > 0) {
    doc.text(`Discount: -${formatGHS(receipt.discount)}`, 75, finalY + 4, { align: 'right' });
  }
  doc.setFontSize(10);
  doc.text(`TOTAL: ${formatGHS(receipt.total)}`, 75, finalY + 9, { align: 'right' });
  doc.setFontSize(8);
  doc.text(`Change: ${formatGHS(receipt.change_given)}`, 75, finalY + 14, { align: 'right' });

  doc.save(`${receipt.receipt_number}.pdf`);
}
