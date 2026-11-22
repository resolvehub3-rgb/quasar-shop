import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShoppingBag, Lock, Mail, User, Phone, Store, ArrowRight, ShieldCheck, KeyRound, Loader2 } from 'lucide-react';
import { supabase, isSupabaseClientConfigured } from '../lib/supabaseClient';
import { PWAInstallButton } from '../components/PWAInstallButton';

interface OwnerAuthPageProps {
  onOwnerAuthenticated: () => Promise<void>;
}

export const OwnerAuthPage: React.FC<OwnerAuthPageProps> = ({ onOwnerAuthenticated }) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [shopClaimed, setShopClaimed] = useState(() => {
    try {
      return localStorage.getItem('shopClaimed') === 'true';
    } catch {
      return false;
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/owner/bootstrap/status');
        if (!resp.ok) return;
        const json = await resp.json();
        if (!cancelled && json?.claimed) {
          setShopClaimed(true);
          setMode('signin');
        }
      } catch {
        // Ignore; default to showing setup option.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    if (!supabase || !isSupabaseClientConfigured) {
      setError('Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are not configured yet.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
        if (data.session) {
          // Ensure owner profile exists or bootstrap if this is the very first owner
          const bootResp = await fetch('/api/owner/bootstrap', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${data.session.access_token}`,
            },
            body: JSON.stringify({}),
          });
          const bootJson = await bootResp.json();
          if (!bootResp.ok) {
            await supabase.auth.signOut();
            throw new Error(bootJson.error || 'Account is not authorized as the shop owner.');
          }
          try {
            localStorage.setItem('shopClaimed', 'true');
          } catch {
            // Ignore storage errors.
          }
          setShopClaimed(true);
          await onOwnerAuthenticated();
          navigate('/owner/dashboard');
        }
      } else {
        if (!fullName.trim() || !shopName.trim()) {
          throw new Error('Full name and shop name are required to initialize your shop.');
        }
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (signUpErr) throw signUpErr;

        if (data.session) {
          const bootResp = await fetch('/api/owner/bootstrap', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${data.session.access_token}`,
            },
            body: JSON.stringify({
              fullName: fullName.trim(),
              shopName: shopName.trim(),
              phone: phone.trim(),
            }),
          });
          const bootJson = await bootResp.json();
          if (!bootResp.ok) {
            throw new Error(bootJson.error || 'Could not claim shop ownership.');
          }
          try {
            localStorage.setItem('shopClaimed', 'true');
          } catch {
            // Ignore storage errors.
          }
          setShopClaimed(true);
          await onOwnerAuthenticated();
          navigate('/owner/dashboard');
        } else {
          try {
            localStorage.setItem('shopClaimed', 'true');
          } catch {
            // Ignore storage errors.
          }
          setShopClaimed(true);
          setInfoMessage('Account created. Please confirm your email address, then sign in to complete shop setup.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#111827] flex flex-col">
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

      {/* Top Bar */}
      <header className="relative z-10 bg-white/95 backdrop-blur-md border-b border-[#E5E7EB] px-3 sm:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-lg bg-[#E60000] flex items-center justify-center text-white">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <span className="font-display text-sm sm:text-lg font-bold text-[#1F2937] truncate">
            Qusar Ventures
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton />
          <Link
            to="/cashier/login"
            className="inline-flex items-center gap-1.5 sm:gap-2 rounded-lg bg-[#1F2937] px-3 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#111827] whitespace-nowrap transition-colors"
          >
            <KeyRound className="h-4 w-4 text-[#E60000] shrink-0" />
            <span>
              Cashier POS<span className="hidden sm:inline"> Login</span>
            </span>
          </Link>
        </div>
      </header>

      {/* Main Split Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-3 sm:p-8">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-2xl bg-white border border-white/20 shadow-2xl overflow-hidden">
          {/* Left Brand Column (shown second on mobile so auth form is above the fold) */}
          <div className="order-2 lg:order-1 lg:col-span-5 bg-[#111827] text-white p-6 sm:p-8 flex flex-col justify-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg bg-[#E60000] px-3 py-1.5 text-xs font-semibold">
                <ShieldCheck className="h-4 w-4" />
                Single-Shop Super Admin
              </div>
              <h1 className="mt-6 font-display text-2xl sm:text-3xl font-bold leading-tight text-balance">
                Manage inventory, sales, cashiers, and Mobile Money in real time.
              </h1>
              <p className="mt-3 text-sm text-gray-300 leading-relaxed">
                Every sale, stock conversion, supplier balance, shift reconciliation, and QR-verified expense is managed securely from one place.
              </p>
            </div>
          </div>

          {/* Right Auth Form */}
          <div className="order-1 lg:order-2 lg:col-span-7 p-5 sm:p-10">

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E7EB] pb-4">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold text-[#1F2937]">
                  {mode === 'signin' ? 'Shop Owner Sign In' : 'Initialize Shop Owner Account'}
                </h2>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  {mode === 'signin'
                    ? 'Sign in with your Supabase Auth credentials'
                    : 'First-run setup for the single authorized shop owner'}
                </p>
              </div>
              {!shopClaimed && (
                <div className="flex self-start sm:self-auto shrink-0 rounded-lg bg-[#F3F4F6] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setError(null);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      mode === 'signin' ? 'bg-white text-[#1F2937] shadow-sm' : 'text-[#6B7280]'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      mode === 'register' ? 'bg-white text-[#1F2937] shadow-sm' : 'text-[#6B7280]'
                    }`}
                  >
                    First Setup
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {error}
              </div>
            )}
            {infoMessage && (
              <div role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                {infoMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              {mode === 'register' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="owner-full-name" className="block text-xs font-semibold text-[#1F2937] mb-1.5">
                        Owner Full Name
                      </label>
                      <div className="relative">
                        <User className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="owner-full-name"
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="e.g. Kwame Boateng"
                          className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="owner-phone" className="block text-xs font-semibold text-[#1F2937] mb-1.5">
                        Owner Telephone (SMS Alerts)
                      </label>
                      <div className="relative">
                        <Phone className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          id="owner-phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="024XXXXXXX"
                          className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="shop-name" className="block text-xs font-semibold text-[#1F2937] mb-1.5">
                      Shop Name
                    </label>
                    <div className="relative">
                      <Store className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="shop-name"
                        type="text"
                        required
                        value={shopName}
                        onChange={(e) => setShopName(e.target.value)}
                        placeholder="e.g. Adom Provision Store"
                        className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="owner-email" className="block text-xs font-semibold text-[#1F2937] mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="owner-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@yourshop.com"
                    className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="owner-password" className="block text-xs font-semibold text-[#1F2937] mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-[#6B7280] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="owner-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full rounded-lg border border-[#E5E7EB] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#E60000]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#E60000] px-4 py-3 text-sm font-semibold text-white hover:bg-[#cc0000] disabled:opacity-60 transition-colors cursor-pointer"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? 'Authenticating...' : mode === 'signin' ? 'Sign In to Owner Console' : 'Create Owner & Initialize Shop'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-[#E5E7EB] flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B7280]">
              <span>Are you a cashier starting a shift?</span>
              <Link to="/cashier/login" className="font-semibold text-[#E60000] hover:underline whitespace-nowrap">
                Go to 6-Digit Cashier Login →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
