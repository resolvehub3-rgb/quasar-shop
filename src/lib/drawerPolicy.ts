/**
 * Cash drawer opening policy.
 *
 * The drawer is only ever opened by the local bridge after a *completed* sale
 * that contains a real cash component. This module centralises that decision so
 * it can be unit-tested and reused by every checkout path (cash, MoMo, split,
 * offline queue).
 *
 * Rules (see docs/HARDWARE_BRIDGE.md):
 *  - Completed cash sale .............. open
 *  - Completed MoMo-only sale ......... do NOT open
 *  - Completed cash + MoMo (split) .... open
 *  - Failed payment ................... do NOT open
 *  - Pending MoMo payment ............. do NOT open
 *  - Cancelled sale ................... do NOT open
 *  - Refund ........................... do NOT open (unless an explicitly
 *                                       authorised refund flow asks for it)
 */

export interface SalePaymentInput {
  /** Cash component of the sale, in major units. */
  cashAmount?: number | null;
  /** Mobile-money component of the sale, in major units. */
  momoAmount?: number | null;
}

export type SaleOutcome = 'completed' | 'pending' | 'failed' | 'cancelled';

/**
 * Decide whether a drawer kick should be issued for a sale.
 * Returns false for anything that is not a completed sale with cash present.
 */
export function shouldOpenDrawer(input: SalePaymentInput, outcome: SaleOutcome = 'completed'): boolean {
  if (outcome !== 'completed') return false;
  const cash = Number(input?.cashAmount ?? 0);
  return Number.isFinite(cash) && cash > 0;
}

/**
 * Convenience wrapper for the raw API payload of the existing checkout
 * endpoint (`/api/cashier/sales` -> `saleResult.cash_amount`).
 */
export function shouldOpenDrawerForSaleResult(saleResult: {
  cash_amount?: number | null;
  payment_status?: string | null;
} | null | undefined): boolean {
  if (!saleResult) return false;
  const status = String(saleResult.payment_status || 'paid').toLowerCase();
  if (status !== 'paid' && status !== 'completed') return false;
  return shouldOpenDrawer({ cashAmount: saleResult.cash_amount }, 'completed');
}

/**
 * A drawer kick is a physical side-effect, so retries must be keyed by a stable
 * operation id derived from the transaction reference. The same id must be used
 * for every retry of the same transaction and never for a different one.
 */
export function drawerOperationId(transactionRef: string): string {
  return `drawer:${transactionRef}`;
}

/**
 * Print operations are likewise keyed by transaction reference so a browser
 * timeout followed by a retry cannot submit a second job for the same receipt.
 */
export function printOperationId(transactionRef: string): string {
  return `print:${transactionRef}`;
}