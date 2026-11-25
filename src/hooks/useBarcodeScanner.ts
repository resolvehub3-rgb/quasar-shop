import { useEffect, useRef } from 'react';
import { isTextInputElement, looksLikeScannerBurst, normalizeScannedBarcode } from '../lib/barcodeScan';

export interface UseBarcodeScannerOptions {
  enabled: boolean;
  onScan: (code: string) => void;
  /** Optional guard: when false, scanner is disabled. */
  canScan?: () => boolean;
}

/**
 * Listens for keyboard-wedge barcode scanner input globally.
 * - Accumulates characters between keystrokes.
 * - Finalizes on Enter (or configured terminator).
 * - Ignores input while focus is in a text field (so normal typing is preserved).
 * - Deduplicates rapid repeated identical scans.
 */
export function useBarcodeScanner({ enabled, onScan, canScan }: UseBarcodeScannerOptions) {
  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const scanStartRef = useRef(0);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (canScan && !canScan()) return;
      const target = e.target as Element | null;
      // Never intercept when typing in an input/textarea/select/contenteditable.
      if (isTextInputElement(target)) return;

      const now = Date.now();

      if (e.key === 'Enter') {
        const code = normalizeScannedBarcode(bufferRef.current);
        const elapsed = now - scanStartRef.current;
        bufferRef.current = '';
        if (
          code.length >= 3 &&
          looksLikeScannerBurst(code, elapsed) &&
          !(code === lastScanRef.current.code && now - lastScanRef.current.time < 1200)
        ) {
          lastScanRef.current = { code, time: now };
          onScan(code);
        }
        return;
      }

      // Accumulate printable characters only.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (bufferRef.current.length === 0) {
          scanStartRef.current = now;
        }
        // Reset buffer if too much time has passed (human typing / interrupted scan).
        if (now - lastKeyTimeRef.current > 100 && bufferRef.current.length > 0) {
          bufferRef.current = '';
          scanStartRef.current = now;
        }
        bufferRef.current += e.key;
        lastKeyTimeRef.current = now;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled, onScan, canScan]);
}
