/**
 * Offline Cash POS Transaction Queue.
 * Strictly marks transactions as pending local sync — NEVER pretends unsynchronized
 * transactions have reached Supabase, and NEVER queues unverified MoMo payments.
 */

export interface QueuedOfflineSale {
  clientTxRef: string;
  shiftId: string;
  items: Array<{
    product_id: string;
    conversion_id?: string | null;
    quantity: number;
    product_name: string;
    unit_name: string;
    unit_price: number;
  }>;
  discountAmount: number;
  cashAmount: number;
  cashTendered: number;
  totalAmount: number;
  queuedAt: string;
  syncStatus: 'pending_sync' | 'sync_failed';
  lastError?: string;
}

const STORAGE_KEY = 'provision_shop_offline_sales_queue_v1';

export function loadOfflineSalesQueue(): QueuedOfflineSale[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineSale(sale: Omit<QueuedOfflineSale, 'queuedAt' | 'syncStatus'>): QueuedOfflineSale[] {
  const queue = loadOfflineSalesQueue();
  if (queue.some((item) => item.clientTxRef === sale.clientTxRef)) {
    return queue;
  }
  const next: QueuedOfflineSale[] = [
    ...queue,
    {
      ...sale,
      queuedAt: new Date().toISOString(),
      syncStatus: 'pending_sync',
    },
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function updateOfflineSaleStatus(
  clientTxRef: string,
  status: 'synced' | 'sync_failed',
  lastError?: string
): QueuedOfflineSale[] {
  const queue = loadOfflineSalesQueue();
  const next =
    status === 'synced'
      ? queue.filter((q) => q.clientTxRef !== clientTxRef)
      : queue.map((q) => (q.clientTxRef === clientTxRef ? { ...q, syncStatus: 'sync_failed' as const, lastError } : q));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function syncPendingOfflineSales(cashierToken: string): Promise<{
  syncedCount: number;
  failedCount: number;
  remainingQueue: QueuedOfflineSale[];
}> {
  const queue = loadOfflineSalesQueue();
  let syncedCount = 0;
  let failedCount = 0;

  for (const tx of queue) {
    try {
      const resp = await fetch('/api/cashier/sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cashierToken}`,
        },
        body: JSON.stringify({
          clientTxRef: tx.clientTxRef,
          shiftId: tx.shiftId,
          items: tx.items.map((i) => ({
            product_id: i.product_id,
            conversion_id: i.conversion_id || null,
            quantity: i.quantity,
          })),
          discountAmount: tx.discountAmount,
          cashAmount: tx.cashAmount,
          cashTendered: tx.cashTendered,
          momoAmount: 0,
          syncSource: 'offline_sync',
        }),
      });

      if (resp.ok) {
        updateOfflineSaleStatus(tx.clientTxRef, 'synced');
        syncedCount += 1;
      } else {
        const err = await resp.json().catch(() => ({ error: 'Sync rejected by server' }));
        updateOfflineSaleStatus(tx.clientTxRef, 'sync_failed', err.error);
        failedCount += 1;
      }
    } catch {
      updateOfflineSaleStatus(tx.clientTxRef, 'sync_failed', 'Network still unreachable');
      failedCount += 1;
    }
  }

  return {
    syncedCount,
    failedCount,
    remainingQueue: loadOfflineSalesQueue(),
  };
}
