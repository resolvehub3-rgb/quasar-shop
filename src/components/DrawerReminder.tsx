import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { BridgeHealth } from '../lib/hardwareBridge';

interface DrawerReminderProps {
  transactionRef: string;
  openedAt: number;
  bridgeHealth: BridgeHealth | null;
  onAcknowledge: () => void;
}

const REMINDER_SECONDS = 30;

export const DrawerReminder: React.FC<DrawerReminderProps> = ({
  transactionRef,
  openedAt,
  bridgeHealth,
  onAcknowledge,
}) => {
  const [remaining, setRemaining] = useState(REMINDER_SECONDS);
  const [acknowledged, setAcknowledged] = useState(false);
  const [alerted, setAlerted] = useState(false);

  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - openedAt) / 1000);
      const r = Math.max(0, REMINDER_SECONDS - elapsed);
      setRemaining(r);
      if (r === 0 && !alerted) {
        setAlerted(true);
        // Play a short alert beep if supported.
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.value = 0.15;
          osc.start();
          osc.stop(ctx.currentTime + 0.25);
        } catch {
          // Audio not available; ignore.
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [openedAt, alerted]);

  const statusLabel =
    bridgeHealth?.drawerSupported === true
      ? 'Drawer status monitored by hardware bridge.'
      : 'Drawer status is not verified by hardware (manual closure assumed).';

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-900">Cash Drawer Open</p>
            <p className="text-[11px] text-amber-800 font-mono">{transactionRef}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onAcknowledge}
          aria-label="Dismiss drawer reminder"
          className="rounded-lg p-1 text-amber-700 hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-2 text-xs text-amber-900">
        {remaining > 0
          ? `Please close the cash drawer manually. Reminder: ${remaining}s remaining.`
          : 'Drawer may still be open. Please close it and acknowledge.'}
      </p>

      <p className="mt-1 text-[10px] text-amber-700">{statusLabel}</p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setAcknowledged(true);
            onAcknowledge();
          }}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {acknowledged ? 'Acknowledged' : 'I Closed the Drawer'}
        </button>
      </div>
    </div>
  );
};
