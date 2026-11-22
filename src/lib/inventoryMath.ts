/**
 * Pure inventory, smart unit conversion, and stock valuation calculations.
 * Zero UI or database dependencies so every calculation is deterministically unit-tested.
 */

export interface StockAlertStatus {
  stockLevel: 'out_of_stock' | 'low_stock' | 'healthy';
  isExpired: boolean;
  isExpiringSoon: boolean;
  daysUntilExpiry: number | null;
}

export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Converts a sold or purchased quantity in a sub/pack unit into the product's base unit.
 * Example: selling 1 x 500ml (conversionToBase = 0.5 when base is L) => 0.5 L.
 * Example: selling 2 x 250g (conversionToBase = 0.25 when base is kg) => 0.5 kg.
 */
export function computeBaseQuantity(quantityInUnit: number, conversionToBase: number): number {
  if (!Number.isFinite(quantityInUnit) || quantityInUnit <= 0) {
    throw new Error('Quantity must be a positive number');
  }
  if (!Number.isFinite(conversionToBase) || conversionToBase <= 0) {
    throw new Error('Conversion factor must be a positive number');
  }
  return roundTo(quantityInUnit * conversionToBase, 4);
}

/**
 * Computes unit selling price for a conversion unit, using explicit override if set,
 * otherwise scaling the base unit selling price proportionally.
 */
export function computeUnitPrice(
  baseSellingPrice: number,
  conversionToBase: number,
  overrideSellingPrice?: number | null
): number {
  if (overrideSellingPrice !== null && overrideSellingPrice !== undefined && Number.isFinite(overrideSellingPrice)) {
    return roundTo(Math.max(0, overrideSellingPrice), 2);
  }
  return roundTo(Math.max(0, baseSellingPrice) * conversionToBase, 2);
}

/**
 * Computes base-unit purchase cost when buying in cartons, crates, sacks, or containers.
 * Example: 1 carton of 24 bottles bought at GHS 240 => base cost = GHS 10.0000 per bottle.
 */
export function computeBaseUnitCost(unitCostPerPurchaseUnit: number, conversionToBase: number): number {
  if (!Number.isFinite(unitCostPerPurchaseUnit) || unitCostPerPurchaseUnit < 0) {
    throw new Error('Purchase unit cost cannot be negative');
  }
  if (!Number.isFinite(conversionToBase) || conversionToBase <= 0) {
    throw new Error('Conversion factor must be positive');
  }
  return roundTo(unitCostPerPurchaseUnit / conversionToBase, 4);
}

/**
 * Evaluates low-stock and expiry alert flags without any fabricated thresholds.
 */
export function evaluateStockAlert(
  stockQuantity: number,
  minStockLevel: number,
  expiryDate?: string | null,
  referenceDate: Date = new Date(),
  expiringWindowDays = 14
): StockAlertStatus {
  const stockLevel: StockAlertStatus['stockLevel'] =
    stockQuantity <= 0 ? 'out_of_stock' : stockQuantity <= minStockLevel ? 'low_stock' : 'healthy';

  let isExpired = false;
  let isExpiringSoon = false;
  let daysUntilExpiry: number | null = null;

  if (expiryDate) {
    const exp = new Date(`${expiryDate.slice(0, 10)}T23:59:59`);
    const todayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const diffMs = exp.getTime() - todayStart.getTime();
    daysUntilExpiry = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) {
      isExpired = true;
    } else if (daysUntilExpiry <= expiringWindowDays) {
      isExpiringSoon = true;
    }
  }

  return {
    stockLevel,
    isExpired,
    isExpiringSoon,
    daysUntilExpiry,
  };
}
