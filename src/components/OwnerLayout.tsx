import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MonitorSmartphone,
  Package,
  ShoppingCart,
  Users,
  ReceiptText,
  Wallet,
  BookOpen,
  RotateCcw,
  BarChart3,
  UserCheck,
  Clock,
  MessageSquare,
  Settings,
  Cpu,
  LogOut,
  Menu,
  X,
  ShoppingBag,
  User,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface OwnerLayoutProps {
  shopName: string;
  tagline: string;
  ownerName: string;
  onLogout: () => Promise<void>;
}

const NAV_ITEMS = [
  { to: '/owner/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/owner/pos', label: 'POS', icon: MonitorSmartphone },
  { to: '/owner/products', label: 'Products', icon: Package },
  { to: '/owner/purchases', label: 'Purchases', icon: ShoppingCart },
  { to: '/owner/suppliers', label: 'Suppliers', icon: Users },
  { to: '/owner/sales', label: 'Sales History', icon: ReceiptText },
  { to: '/owner/expenses', label: 'Expenses', icon: Wallet },
  { to: '/owner/storebook', label: 'Storebook', icon: BookOpen },
  { to: '/owner/returns', label: 'Returns & Refunds', icon: RotateCcw },
  { to: '/owner/reports', label: 'Reports', icon: BarChart3 },
  { to: '/owner/cashiers', label: 'Cashiers', icon: UserCheck },
  { to: '/owner/shifts', label: 'Shifts', icon: Clock },
  { to: '/owner/sms', label: 'SMS Reports', icon: MessageSquare },
  { to: '/owner/hardware', label: 'POS Hardware', icon: Cpu },
  { to: '/owner/settings', label: 'Settings', icon: Settings },
];

export const OwnerLayout: React.FC<OwnerLayoutProps> = ({
  shopName,
  tagline,
  ownerName,
  onLogout,
}) => {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await onLogout();
    navigate('/');
  };

  const SidebarContent = (
    <div className="flex h-full flex-col bg-[#111827] text-white">
      {/* Red Brand Header matching reference */}
      <div className="bg-[#E60000] px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/branding/qusar-ventures-logo.png"
            alt="QUSAR VENTURES"
            className="h-9 w-auto shrink-0 object-contain bg-white rounded-md px-1"
          />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold leading-tight truncate">{shopName}</p>
            <p className="text-[11px] text-white/85 truncate">{tagline}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden rounded-lg p-1.5 text-white/90 hover:bg-white/15"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav aria-label="Owner Navigation" className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileDrawerOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[#E60000] text-white'
                  : 'text-gray-300 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom Owner Badge & Logout */}
      <div className="p-3 border-t border-white/10 space-y-2 shrink-0">
        <div className="flex items-center gap-3 rounded-xl bg-[#E60000] px-3.5 py-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#E60000]">
            <User className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-white truncate">{ownerName}</p>
            <p className="text-[11px] text-white/85">Super Admin</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F3F4F6] text-[#1F2937]">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full shadow-2xl">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-[#E5E7EB] bg-white px-4 lg:px-6 h-14 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-lg p-2 text-[#1F2937] hover:bg-[#F3F4F6] min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="font-display text-base font-bold text-[#1F2937] truncate">
              {shopName}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            <div className="hidden sm:flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#E60000] text-[11px] font-bold text-white">
                {ownerName.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-xs font-semibold text-[#1F2937] whitespace-nowrap">{ownerName}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6 pb-20 lg:pb-8 overflow-x-hidden">
          <Outlet />
        </main>

        {/* Mobile Bottom Quick Bar (<= 15% mobile viewport) */}
        <nav
          aria-label="Mobile Quick Navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-30 grid grid-cols-4 border-t border-[#E5E7EB] bg-white/95 backdrop-blur-sm h-14"
        >
          <NavLink
            to="/owner/dashboard"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center text-[10px] font-medium ${
                isActive ? 'text-[#E60000]' : 'text-[#6B7280]'
              }`
            }
          >
            <LayoutDashboard className="h-4 w-4 mb-0.5" />
            Dashboard
          </NavLink>
          <NavLink
            to="/owner/pos"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center text-[10px] font-medium ${
                isActive ? 'text-[#E60000]' : 'text-[#6B7280]'
              }`
            }
          >
            <MonitorSmartphone className="h-4 w-4 mb-0.5" />
            POS
          </NavLink>
          <NavLink
            to="/owner/products"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center text-[10px] font-medium ${
                isActive ? 'text-[#E60000]' : 'text-[#6B7280]'
              }`
            }
          >
            <Package className="h-4 w-4 mb-0.5" />
            Products
          </NavLink>
          <NavLink
            to="/owner/reports"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center text-[10px] font-medium ${
                isActive ? 'text-[#E60000]' : 'text-[#6B7280]'
              }`
            }
          >
            <BarChart3 className="h-4 w-4 mb-0.5" />
            Reports
          </NavLink>
        </nav>
      </div>
    </div>
  );
};
