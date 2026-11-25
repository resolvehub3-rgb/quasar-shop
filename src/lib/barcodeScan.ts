/**
 * Pure helpers for distinguishing keyboard-wedge barcode scanner input from
 * normal human typing. Kept pure so they can be unit-tested.
 */

export interface ScanDetectionOptions {
  /** Max ms between consecutive keystrokes to be considered scanner input. */
  maxInterKeyMs?: number;
  /** Minimum barcode length to accept. */
  minLength?: number;
  /** Maximum barcode length to accept. */
  maxLength?: number;
  /** Terminator keys that finalize a scan. */
  terminators?: string[];
}

export const DEFAULT_SCAN_OPTIONS: Required<ScanDetectionOptions> = {
  maxInterKeyMs: 50,
  minLength: 3,
  maxLength: 64,
  terminators: ['Enter'],
};

/**
 * Decide whether a sequence of characters collected within the given time
 * window looks like a scanner burst rather than human typing.
 */
export function looksLikeScannerBurst(
  chars: string,
  elapsedMs: number,
  opts: ScanDetectionOptions = {}
): boolean {
  const o = { ...DEFAULT_SCAN_OPTIONS, ...opts };
  if (chars.length < o.minLength || chars.length > o.maxLength) return false;
  // Human typing rarely sustains <50ms between keys for the whole burst.
  if (elapsedMs <= 0) return true;
  const avg = elapsedMs / Math.max(1, chars.length);
  return avg <= o.maxInterKeyMs;
}

/**
 * Normalize a raw scanned value: trim whitespace and common suffixes.
 */
export function normalizeScannedBarcode(raw: string): string {
  return raw.replace(/[\r\n\t]/g, '').trim();
}

/**
 * Returns true if the active element is a text input where keystrokes should
 * NOT be intercepted (normal typing).
 */
export function isTextInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
