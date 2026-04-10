'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileSearch,
  ArrowLeftRight,
  Building2,
  House,
  ClipboardCheck,
  TrendingUp,
  Receipt,
  ShieldAlert,
  FileText,
  BookOpen,
  Users,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Archive,
  Puzzle,
  Loader2,
  Check,
  Plus,
} from 'lucide-react';
import { useTabActivityContext } from './TabActivityContext';
import Avatar from './Avatar';
import { useTabContext, Tab } from './TabContext';
import { useModules } from './ModulesProvider';
import { createClient } from '@/lib/supabase';

interface SidebarProps {
  userName?: string;
  userEmail?: string;
  userRole?: string;
  avatarUrl?: string | null;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** Matches module ID in modules.config.ts */
  moduleId: string;
}

// All possible tool nav items — filtered by active modules at render time
const ALL_TOOLS: NavItem[] = [
  { moduleId: 'dashboard',       href: '/dashboard',      label: 'Dashboard',         icon: LayoutDashboard },
  { moduleId: 'full-analysis',   href: '/full-analysis',  label: 'Full Analysis',      icon: FileSearch },
  { moduleId: 'bank-to-csv',     href: '/bank-to-csv',    label: 'Bank to CSV',        icon: ArrowLeftRight },
  { moduleId: 'landlord',        href: '/landlord',       label: 'Landlord',           icon: House },
  { moduleId: 'final-accounts',  href: '/final-accounts', label: 'Accounts Review',    icon: ClipboardCheck },
  { moduleId: 'performance',     href: '/performance',    label: 'Performance',        icon: TrendingUp },
  { moduleId: 'p32',             href: '/p32',            label: 'P32 Summary',        icon: Receipt },
  { moduleId: 'risk-assessment', href: '/risk-assessment',label: 'Risk Assessment',    icon: ShieldAlert },
  { moduleId: 'summarise',       href: '/summarise',      label: 'Summarise',          icon: FileText },
  { moduleId: 'ch-secretarial',  href: '/ch-secretarial', label: 'CH Secretarial',     icon: Building2 },
  { moduleId: 'document-vault',  href: '/vault',          label: 'Document Vault',     icon: Archive },
  { moduleId: 'policies',        href: '/policies',       label: 'Policies',           icon: BookOpen },
];

const WORKSPACE: NavItem[] = [
  { moduleId: 'clients',  href: '/clients',  label: 'Clients',  icon: Users },
  { moduleId: 'help',     href: '/help',     label: 'Help',     icon: HelpCircle },
  { moduleId: 'settings', href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ userName, userEmail, userRole, avatarUrl }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const { openTab, openInNewTab, setActiveTabId, tabs, activeTabId } = useTabContext();
  const { getActivity, resetIfDone } = useTabActivityContext();
  const { isModuleActive, activeModules } = useModules();
  const supabase = createClient();
  const isAdmin = userRole === 'admin';
  const vaultActive = isModuleActive('document-vault');

  // Only fetch vault status if the document-vault module is active
  useEffect(() => {
    if (!vaultActive) return;
    fetch('/api/vault/sync/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.untaggedCount > 0) setUntaggedCount(data.untaggedCount); })
      .catch(() => {});
  }, [vaultActive]);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handleNavClick(item: NavItem) {
    if (item.href === '/dashboard') {
      setActiveTabId(null);
      return;
    }

    const IconComponent = item.icon as Tab['icon'];

    // If the active tab is currently processing, warn the user before replacing it
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.route !== item.href && getActivity(activeTab.route) === 'processing') {
      const openNew = confirm(
        `"${activeTab.title}" is still processing.\n\nClick OK to open ${item.label} in a new tab (keeping this analysis running), or Cancel to stay here.`
      );
      if (!openNew) return;
      openInNewTab({ id: item.moduleId, title: item.label, route: item.href, icon: IconComponent });
      resetIfDone(item.href);
      window.history.replaceState(null, '', item.href);
      return;
    }

    openTab({ id: item.moduleId, title: item.label, route: item.href, icon: IconComponent });
    resetIfDone(item.href);
    window.history.replaceState(null, '', item.href);
  }

  function handleOpenInNewTab(item: NavItem) {
    const IconComponent = item.icon;
    openInNewTab({ id: item.moduleId, title: item.label, route: item.href, icon: IconComponent as Tab['icon'] });
    resetIfDone(item.href);
    window.history.replaceState(null, '', item.href);
  }

  // Filter tools to only those whose module is active
  const visibleTools = ALL_TOOLS.filter(item => isModuleActive(item.moduleId));

  // Count inactive optional modules (for admin hint)
  const inactiveCount = ALL_TOOLS.filter(
    item => item.moduleId !== 'dashboard' && !isModuleActive(item.moduleId)
  ).length;

  const width = collapsed ? 64 : 240;

  return (
    <aside
      style={{ width, minWidth: width }}
      className="glass-sidebar flex flex-col h-screen sticky top-0 z-40 transition-[width] duration-200 ease-in-out overflow-hidden"
    >
      {/* Logo */}
      <div className={`flex items-center h-14 px-4 border-b border-[var(--border)] shrink-0 ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="SMITH"
            className="w-7 h-7 rounded shrink-0 dark:invert"
          />
          {!collapsed && (
            <span className="font-bold text-base text-[var(--text-primary)] whitespace-nowrap tracking-tight">
              SMITH
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">
        {/* Tools section */}
        {!collapsed && (
          <p className="px-3 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Tools
          </p>
        )}
        {visibleTools.map(item => {
          const Icon = item.icon;
          const isActive = item.href === '/dashboard'
            ? pathname === '/dashboard' && activeTabId === null
            : tabs.find(t => t.id === activeTabId)?.route === item.href;

          const colorClass = isActive
            ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
            : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
          const iconClass = `shrink-0 transition-colors duration-150 ${isActive ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'}`;

          // Dashboard — plain Link, no "+" affordance needed
          if (item.href === '/dashboard') {
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => handleNavClick(item)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-lg transition-all duration-150 group w-full
                  ${collapsed ? 'justify-center px-0 h-11' : 'px-3 h-11'} ${colorClass}`}
              >
                <Icon size={18} className={iconClass} />
                {!collapsed && <span className="text-sm font-medium truncate">{item.label}</span>}
              </Link>
            );
          }

          // Tool items — wrapper div so we can have two sibling buttons (valid HTML)
          const isInBackgroundTab = !isActive && tabs.some(t => t.route === item.href);
          const activity = isInBackgroundTab ? getActivity(item.href) : 'idle';

          if (collapsed) {
            return (
              <button
                key={item.href}
                onClick={() => handleNavClick(item)}
                title={item.label}
                className={`flex items-center justify-center w-full h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
              >
                <Icon size={18} className={iconClass} />
              </button>
            );
          }

          return (
            <div
              key={item.href}
              className={`flex items-center h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
            >
              {/* Main nav action */}
              <button
                onClick={() => handleNavClick(item)}
                className="flex items-center gap-3 flex-1 min-w-0 h-full px-3"
              >
                <Icon size={18} className={iconClass} />
                <span className="text-sm font-medium truncate text-left">{item.label}</span>
              </button>

              {/* Right side: activity indicator (idle) / open-in-new-tab (+) on hover */}
              {!isActive && (
                <span className="flex items-center shrink-0 pr-2">
                  {/* Indicator — visible normally, hidden on hover */}
                  {isInBackgroundTab && (
                    <span className="group-hover:hidden">
                      {activity === 'processing' && <span title="Analysis in progress"><Loader2 size={11} className="animate-spin text-[var(--accent)]" /></span>}
                      {activity === 'done'       && <span title="Analysis complete"><Check size={11} className="text-emerald-500" /></span>}
                      {activity === 'idle'       && <span className="block w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-60" title="Open in a tab" />}
                    </span>
                  )}
                  {/* Open in new tab — hidden normally, shown on hover */}
                  <button
                    onClick={e => { e.stopPropagation(); handleOpenInNewTab(item); }}
                    className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                    title="Open in new tab"
                  >
                    <Plus size={10} />
                  </button>
                </span>
              )}

              {/* Vault untagged count badge */}
              {item.moduleId === 'document-vault' && untaggedCount > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-white text-[10px] font-bold flex items-center justify-center mr-2">
                  {untaggedCount > 99 ? '99+' : untaggedCount}
                </span>
              )}
            </div>
          );
        })}

        {/* Admin hint: inactive modules */}
        {isAdmin && !collapsed && inactiveCount > 0 && (
          <Link
            href="/settings?tab=modules"
            className="flex items-center gap-2 px-3 py-2 mt-1 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-nav-hover)] transition-all duration-150 group"
          >
            <Puzzle size={13} className="shrink-0 group-hover:text-[var(--accent)]" />
            <span>{inactiveCount} inactive module{inactiveCount !== 1 ? 's' : ''} — Manage</span>
          </Link>
        )}

        {/* Workspace section */}
        {!collapsed && (
          <p className="px-3 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Workspace
          </p>
        )}
        {collapsed && <div className="h-2" />}
        {WORKSPACE.map(item => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => handleNavClick(item)}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 rounded-lg transition-all duration-150 group
                ${collapsed ? 'justify-center px-0 h-11' : 'px-3 h-11'}
                ${isActive
                  ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
                  : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
                }`}
            >
              <Icon
                size={18}
                className={`shrink-0 transition-colors duration-150 ${isActive ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'}`}
              />
              {!collapsed && (
                <span className="text-sm font-medium truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className={`border-t border-[var(--border)] px-2 py-3 shrink-0`}>
        {collapsed ? (
          <div className="flex justify-center mb-2">
            <Avatar name={userName} avatarUrl={avatarUrl} size={36} />
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors cursor-pointer group">
            <Avatar name={userName} avatarUrl={avatarUrl} size={36} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate leading-tight">
                {userName || 'User'}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate capitalize leading-tight">
                {userRole || 'staff'}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:text-[var(--danger)]"
            >
              <LogOut size={14} className="text-[var(--text-muted)]" />
            </button>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`w-full flex items-center justify-center h-8 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-all duration-150 mt-1`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span className="text-xs ml-1">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
