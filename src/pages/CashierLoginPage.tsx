import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingCart, Delete, LogIn, ShieldCheck, ArrowLeft } from 'lucide-react';
import type { CashierShift } from '../types/database';

export interface CashierAuthSession {
  token: string;
  expiresAt: string;
  cashier: { id: string; full_name: string; phone: string };
  activeShift: CashierShift | null;
}

interface CashierLoginPageProps {
  onCashierAuthenticated: (session: CashierAuthSession) => void;
}

export const CashierLoginPage: React.FC<CashierLoginPageProps> = ({ onCashierAuthenticated }) => {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitPin = useCallback(
    async (pinValue: string) => {
      if (pinValue.length !== 6) {
        setError('Please enter your complete 6-digit access code.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch('/api/cashier/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: pinValue }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          setCode('');
          throw new Error(data.error || 'Access denied');
        }
        onCashierAuthenticated(data);
        navigate('/cashier/pos');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to verify code');
      } finally {
        setLoading(false);
      }
    },
    [navigate, onCashierAuthenticated]
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (loading) return;
      setError(null);
      setCode((prev) => (prev.length < 6 ? prev + digit : prev));
    },
    [loading]
  );

  const handleBackspace = useCallback(() => {
    if (loading) return;
    setError(null);
    setCode((prev) => prev.slice(0, -1));
  }, [loading]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Enter' && code.length === 6) {
        submitPin(code);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [code, handleBackspace, handleDigit, submitPin]);

  return (
    <div className="relative min-h-screen bg-[#111827] flex flex-col items-center justify-center p-3 sm:p-6 lg:p-8">
      <img
        src="/assets/aistudio/1795325238471_9c0b2c7b.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full object-cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[#111827]/55 backdrop-blur-[1.5px]"
      />
      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 rounded-2xl bg-white border border-white/20 shadow-2xl overflow-hidden">
        {/* Left Red Brand Column */}
        <div className="md:col-span-5 bg-[#E60000] text-white p-6 sm:p-8 flex flex-col justify-between gap-6">
          <div className="flex items-center justify-between">
            <Link
              to="/"
              aria-label="Back to owner portal"
              className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Owner Portal</span>
            </Link>
          </div>

          <div className="py-2 md:py-6">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
              <ShoppingCart className="h-8 w-8 text-white" />
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
              Provision Shop
            </h1>
            <p className="text-sm font-medium text-white/90 mt-1">
              Cashier Point of Sale Terminal
            </p>
            <p className="hidden md:block text-xs text-white/80 leading-relaxed mt-4">
              Fast counter checkout with barcode scanning, multi-unit pricing, Cash &amp; Mobile Money payments, and shift cash reconciliation.
            </p>
          </div>

          <div className="hidden md:flex items-center gap-2 pt-4 border-t border-white/20 text-xs text-white/90">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Secure Access · Authorized Cashiers Only</span>
          </div>
        </div>

        {/* Right Keypad Column */}
        <div className="md:col-span-7 p-6 sm:p-8 lg:p-10 flex items-center justify-center bg-white">
          <div className="w-full max-w-xs sm:max-w-sm">
            <div className="text-center">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-[#1F2937]">
                Cashier Login
              </h2>
              <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                Enter your 6-digit access code to continue
              </p>
            </div>

            {/* 6-Digit Indicator Slots */}
            <div className="mt-5 grid grid-cols-6 gap-2" aria-label="6-digit access code progress">
              {[0, 1, 2, 3, 4, 5].map((idx) => {
                const filled = idx < code.length;
                return (
                  <div
                    key={idx}
                    className={`h-12 rounded-xl border flex items-center justify-center transition-colors ${
                      filled
                        ? 'border-[#E60000] bg-red-50/40'
                        : 'border-[#E5E7EB] bg-[#F9FAFB]'
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-full transition-transform ${
                        filled ? 'bg-[#E60000] scale-100' : 'bg-[#D1D5DB] scale-75'
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-700"
              >
                {error}
              </div>
            )}

            {/* Numeric Keypad */}
            <div className="mt-5 grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleDigit(digit)}
                  className="h-14 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] font-display text-xl font-bold text-[#1F2937] hover:bg-[#F3F4F6] active:scale-[0.97] transition cursor-pointer"
                >
                  {digit}
                </button>
              ))}

              <button
                type="button"
                onClick={handleBackspace}
                aria-label="Backspace"
                className="h-14 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-center text-[#1F2937] hover:bg-[#F3F4F6] active:scale-[0.97] transition cursor-pointer"
              >
                <Delete className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={() => handleDigit('0')}
                className="h-14 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] font-display text-xl font-bold text-[#1F2937] hover:bg-[#F3F4F6] active:scale-[0.97] transition cursor-pointer"
              >
                0
              </button>

              <button
                type="button"
                disabled={loading || code.length !== 6}
                onClick={() => submitPin(code)}
                className="h-14 rounded-xl bg-[#E60000] text-white font-semibold text-sm flex flex-col items-center justify-center gap-0.5 hover:bg-[#cc0000] disabled:opacity-50 active:scale-[0.97] transition cursor-pointer"
              >
                <LogIn className="h-4 w-4" />
                <span>{loading ? '...' : 'Login'}</span>
              </button>
            </div>

            <div className="mt-5 flex md:hidden items-center justify-center gap-2 text-xs text-[#6B7280]">
              <ShieldCheck className="h-4 w-4 text-[#E60000]" />
              <span>Secure Access · Authorized Cashiers Only</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
