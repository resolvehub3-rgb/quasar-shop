import React, { useState } from 'react';
import { Printer, CheckCircle2, FileDown, X } from 'lucide-react';
import type { ReceiptSnapshot, ShopSettings } from '../types/database';
import { formatGHS } from '../lib/posCalculations';
import { exportReceiptToPdf } from '../lib/exportUtils';

interface ReceiptModalProps {
  receipt: ReceiptSnapshot;
  shop?: ShopSettings | null;
  mode: 'cashier_post_sale' | 'owner_reprint';
  onClose: () => void;
  onReprintLogged?: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  receipt,
  shop,
  mode,
  onClose,
  onReprintLogged,
}) => {
  const [paperWidth, setPaperWidth] = useState<'58mm' | '80mm'>(
    shop?.thermal_paper_width || '80mm'
  );

  const handlePrint = () => {
    if (mode === 'owner_reprint' && onReprintLogged) {
      onReprintLogged();
    }
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="w-full max-w-md rounded-xl bg-white border border-[#E5E7EB] shadow-2xl overflow-hidden">
        <div className="no-print flex items-center justify-between border-b border-[#E5E7EB] px-5 py-3.5 bg-[#F3F4F6]">
          <div>
            <h3 className="text-base font-bold text-[#1F2937]">
              {mode === 'cashier_post_sale' ? 'Sale Completed — Digital Receipt' : 'Owner Receipt Reprint'}
            </h3>
            <p className="text-xs text-[#6B7280] font-mono tabular-nums">{receipt.receipt_number}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Thermal paper width"
              value={paperWidth}
              onChange={(e) => setPaperWidth(e.target.value as '58mm' | '80mm')}
              className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-medium text-[#1F2937]"
            >
              <option value="80mm">80mm Thermal</option>
              <option value="58mm">58mm Thermal</option>
            </select>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close receipt modal"
              className="rounded-lg p-1.5 text-[#6B7280] hover:bg-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="p-5 max-h-[65vh] overflow-y-auto bg-[#F9FAFB] flex justify-center">
          <div
            className={`printable-receipt ${paperWidth === '58mm' ? 'paper-58mm max-w-[240px]' : 'paper-80mm max-w-[320px]'} w-full rounded-lg border border-[#E5E7EB] bg-white p-4 text-xs text-[#1F2937] shadow-sm`}
          >
            <div className="text-center border-b border-dashed border-[#D1D5DB] pb-3">
              <img
                src="/branding/qusar-ventures-logo.png"
                alt="QUSAR VENTURES"
                className="mx-auto mb-2 h-10 w-auto object-contain"
              />
              <p className="text-sm font-bold uppercase tracking-wide">
                {shop?.shop_name || 'Provision Shop'}
              </p>
              {shop?.address && <p className="text-[11px] text-[#6B7280] mt-0.5">{shop.address}</p>}
              {shop?.phone && <p className="text-[11px] text-[#6B7280]">Tel: {shop.phone}</p>}
              {shop?.receipt_header && (
                <p className="text-[11px] text-[#4B5563] mt-1">{shop.receipt_header}</p>
              )}
            </div>

            <div className="py-2.5 space-y-1 border-b border-dashed border-[#D1D5DB] text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Receipt #</span>
                <span className="font-mono font-semibold tabular-nums">{receipt.receipt_number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Ref</span>
                <span className="font-mono tabular-nums truncate max-w-[160px]">{receipt.client_tx_ref}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Date</span>
                <span className="tabular-nums">{new Date(receipt.date).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Cashier</span>
                <span>{receipt.cashier_name}</span>
              </div>
            </div>

            <table className="w-full my-2.5 text-[11px]">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                  <th className="text-left py-1 font-medium">Item</th>
                  <th className="text-right py-1 font-medium">Qty</th>
                  <th className="text-right py-1 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {receipt.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-[#F3F4F6]">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium text-[#1F2937]">{item.product_name}</div>
                      <div className="text-[10px] text-[#6B7280] tabular-nums">
                        {formatGHS(item.unit_price)} / {item.unit_name}
                      </div>
                    </td>
                    <td className="py-1.5 text-right tabular-nums align-top">{item.quantity}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums align-top">
                      {formatGHS(item.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-dashed border-[#D1D5DB] pt-2.5 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-[#6B7280]">Subtotal</span>
                <span className="tabular-nums">{formatGHS(receipt.subtotal)}</span>
              </div>
              {receipt.discount > 0 && (
                <div className="flex justify-between text-[#E60000]">
                  <span>Discount</span>
                  <span className="tabular-nums">-{formatGHS(receipt.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-[#1F2937] pt-1 border-t border-[#E5E7EB]">
                <span>Total</span>
                <span className="tabular-nums">{formatGHS(receipt.total)}</span>
              </div>
            </div>

            <div className="mt-2.5 border-t border-dashed border-[#D1D5DB] pt-2 space-y-1 text-[11px]">
              {receipt.payments.map((p, idx) => (
                <div key={idx} className="flex justify-between">
                  <span className="text-[#6B7280] uppercase">
                    {p.method} {p.network ? `(${p.network})` : ''}
                  </span>
                  <span className="tabular-nums font-medium">{formatGHS(p.amount)}</span>
                </div>
              ))}
              {receipt.change_given > 0 && (
                <div className="flex justify-between font-semibold">
                  <span>Change Given</span>
                  <span className="tabular-nums">{formatGHS(receipt.change_given)}</span>
                </div>
              )}
            </div>

            {shop?.receipt_footer && (
              <p className="mt-3 pt-2 border-t border-dashed border-[#D1D5DB] text-center text-[10px] text-[#6B7280]">
                {shop.receipt_footer}
              </p>
            )}
          </div>
        </div>

        <div className="no-print border-t border-[#E5E7EB] p-4 bg-white flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#E60000] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cc0000] transition-colors cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            Print Receipt
          </button>
          {mode === 'owner_reprint' && (
            <button
              type="button"
              onClick={() => exportReceiptToPdf(receipt, shop)}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-semibold text-[#1F2937] hover:bg-[#F3F4F6] cursor-pointer"
            >
              <FileDown className="h-4 w-4" />
              PDF
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F3F4F6] px-4 py-2.5 text-sm font-semibold text-[#1F2937] hover:bg-[#E5E7EB] transition-colors cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {mode === 'cashier_post_sale' ? 'Complete Without Printing' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};
