import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';
import { OwnerAuthPage } from './pages/OwnerAuthPage';
import { CashierLoginPage, type CashierAuthSession } from './pages/CashierLoginPage';
import { CashierPosPage } from './pages/CashierPosPage';
import { ExpenseSubmitMobilePage } from './pages/ExpenseSubmitMobilePage';
import { OwnerLayout } from './components/OwnerLayout';
import { OwnerDashboardPage } from './pages/owner/OwnerDashboardPage';
import { OwnerPosPage } from './pages/owner/OwnerPosPage';
import { OwnerProductsPage } from './pages/owner/OwnerProductsPage';
import { OwnerPurchasesPage, OwnerSuppliersPage } from './pages/owner/OwnerPurchasesSuppliersPage';
import {
  OwnerExpensesPage,
  OwnerSalesHistoryPage,
  OwnerStorebookPage,
} from './pages/owner/OwnerSalesExpensesStorebookPage';
import {
  OwnerCashiersPage,
  OwnerReportsPage,
  OwnerReturnsPage,
  OwnerSettingsPage,
  OwnerShiftsPage,
  OwnerSmsPage,
  OwnerHardwarePage,
} from './pages/owner/OwnerAdminOperationsPage';
import { OfflineIndicator } from './components/PWAInstallButton';

export default function App() {
  const [ownerAuthChecked, setOwnerAuthChecked] = useState(false);
  const [isOwnerAuthenticated, setIsOwnerAuthenticated] = useState(false);
  const [ownerName, setOwnerName] = useState('Shop Owner');
  const [shopName, setShopName] = useState('Provision Shop');
  const [shopTagline, setShopTagline] = useState('Manage · Sell · Grow');

  // Cashier session is kept in sessionStorage so a page refresh does not log the
  // cashier out, while still being cleared when the tab/browser is closed.
  const [cashierSession, setCashierSessionState] = useState<CashierAuthSession | null>(() => {
    try {
      const raw = sessionStorage.getItem('cashierSession');
      return raw ? (JSON.parse(raw) as CashierAuthSession) : null;
    } catch {
      return null;
    }
  });

  const setCashierSession = useCallback((next: CashierAuthSession | null) => {
    setCashierSessionState(next);
    try {
      if (next) {
        sessionStorage.setItem('cashierSession', JSON.stringify(next));
      } else {
        sessionStorage.removeItem('cashierSession');
      }
    } catch {
      // Ignore storage errors (e.g. private mode).
    }
  }, []);

  const refreshOwnerState = useCallback(async () => {
    if (!supabase) {
      setIsOwnerAuthenticated(false);
      setOwnerAuthChecked(true);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setIsOwnerAuthenticated(false);
      setOwnerAuthChecked(true);
      return;
    }

    const [{ data: ownerProfile }, { data: shopSettings }] = await Promise.all([
      supabase.from('owner_profiles').select('id, full_name').eq('id', user.id).maybeSingle(),
      supabase.from('shop_settings').select('shop_name, tagline').limit(1).maybeSingle(),
    ]);

    if (ownerProfile) {
      setIsOwnerAuthenticated(true);
      setOwnerName(ownerProfile.full_name || 'Shop Owner');
      if (shopSettings?.shop_name) setShopName(shopSettings.shop_name);
      if (shopSettings?.tagline) setShopTagline(shopSettings.tagline);
    } else {
      setIsOwnerAuthenticated(false);
    }
    setOwnerAuthChecked(true);
  }, []);

  useEffect(() => {
    refreshOwnerState();
    if (!supabase) return;
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      refreshOwnerState();
    });
    return () => {
      listener.subscription.unsubscribe();
    };
  }, [refreshOwnerState]);

  const handleOwnerLogout = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setIsOwnerAuthenticated(false);
  };

  return (
    <BrowserRouter>
      <OfflineIndicator />
      <Routes>
        <Route
          path="/"
          element={
            ownerAuthChecked && isOwnerAuthenticated ? (
              <Navigate to="/owner/dashboard" replace />
            ) : (
              <OwnerAuthPage onOwnerAuthenticated={refreshOwnerState} />
            )
          }
        />

        {/* Cashier Routes */}
        <Route
          path="/cashier/login"
          element={<CashierLoginPage onCashierAuthenticated={setCashierSession} />}
        />
        <Route
          path="/cashier/pos"
          element={
            <CashierPosPage session={cashierSession} onSessionUpdate={setCashierSession} />
          }
        />

        {/* Single-Use QR Expense Smartphone Route */}
        <Route path="/expense-submit/:token" element={<ExpenseSubmitMobilePage />} />

        {/* Protected Owner Routes */}
        <Route
          path="/owner"
          element={
            !ownerAuthChecked ? (
              <div className="min-h-screen flex items-center justify-center text-sm text-[#6B7280]">
                Verifying owner session...
              </div>
            ) : isOwnerAuthenticated ? (
              <OwnerLayout
                shopName={shopName}
                tagline={shopTagline}
                ownerName={ownerName}
                onLogout={handleOwnerLogout}
              />
            ) : (
              <Navigate to="/" replace />
            )
          }
        >
          <Route index element={<Navigate to="/owner/dashboard" replace />} />
          <Route path="dashboard" element={<OwnerDashboardPage />} />
          <Route path="pos" element={<OwnerPosPage />} />
          <Route path="products" element={<OwnerProductsPage />} />
          <Route path="purchases" element={<OwnerPurchasesPage />} />
          <Route path="suppliers" element={<OwnerSuppliersPage />} />
          <Route path="sales" element={<OwnerSalesHistoryPage />} />
          <Route path="expenses" element={<OwnerExpensesPage />} />
          <Route path="storebook" element={<OwnerStorebookPage />} />
          <Route path="returns" element={<OwnerReturnsPage />} />
          <Route path="reports" element={<OwnerReportsPage />} />
          <Route path="cashiers" element={<OwnerCashiersPage />} />
          <Route path="shifts" element={<OwnerShiftsPage />} />
          <Route path="sms" element={<OwnerSmsPage />} />
          <Route path="hardware" element={<OwnerHardwarePage />} />
          <Route path="settings" element={<OwnerSettingsPage onSettingsUpdated={refreshOwnerState} />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
