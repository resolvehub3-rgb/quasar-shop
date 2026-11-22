import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X } from 'lucide-react';

interface CameraBarcodeScannerModalProps {
  onScanSuccess: (barcode: string) => void;
  onClose: () => void;
}

export const CameraBarcodeScannerModal: React.FC<CameraBarcodeScannerModalProps> = ({
  onScanSuccess,
  onClose,
}) => {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  useEffect(() => {
    const regionId = 'pos-camera-barcode-reader';
    const scanner = new Html5Qrcode(regionId);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 140 } },
        (decodedText) => {
          const now = Date.now();
          if (decodedText === lastScanRef.current.code && now - lastScanRef.current.time < 1200) {
            return;
          }
          lastScanRef.current = { code: decodedText, time: now };
          onScanSuccess(decodedText.trim());
        },
        () => {
          // Ignore per-frame decode misses
        }
      )
      .catch((err) => {
        setError(
          err instanceof Error
            ? `Camera unavailable: ${err.message}`
            : 'Unable to access device camera for barcode scanning.'
        );
      });

    return () => {
      if (scanner.isScanning) {
        scanner.stop().catch(() => {});
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white border border-[#E5E7EB] shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#E60000]" />
            <h3 className="text-sm font-bold text-[#1F2937]">Camera Barcode Scanner</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close barcode scanner"
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F3F4F6]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
              <p className="mt-2 text-xs text-red-600">
                You can continue scanning with a USB barcode scanner or searching products manually.
              </p>
            </div>
          ) : (
            <div>
              <div id="pos-camera-barcode-reader" className="w-full overflow-hidden rounded-lg bg-black" />
              <p className="mt-2 text-center text-xs text-[#6B7280]">
                Point your camera at a product barcode. Continuous scanning is active.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
