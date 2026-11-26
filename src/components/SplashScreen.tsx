import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  visible: boolean;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ visible }) => {
  const [shouldRender, setShouldRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
    } else {
      // Allow fade-out animation before unmount.
      const t = window.setTimeout(() => setShouldRender(false), 400);
      return () => window.clearTimeout(t);
    }
  }, [visible]);

  if (!shouldRender) return null;

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      aria-hidden={!visible}
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white transition-opacity duration-400 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div
        className={`flex flex-col items-center gap-6 ${reduceMotion ? '' : 'animate-[splashIn_0.6s_ease-out]'}`}
      >
        <img
          src="/branding/qusar-ventures-logo.png"
          alt="QUSAR VENTURES"
          className="w-40 sm:w-52 h-auto select-none"
          draggable={false}
        />
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#E60000] animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-[#10213D] animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-[#E60000] animate-bounce" />
        </div>
      </div>
      <style>{`
        @keyframes splashIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};
