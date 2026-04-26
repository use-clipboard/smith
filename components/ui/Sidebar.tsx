'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  Settings, HelpCircle, ChevronLeft, ChevronRight,
  LogOut, Puzzle, Loader2, Check, Plus, Star,
} from 'lucide-react';
import { useTabActivityContext } from './TabActivityContext';
import Avatar from './Avatar';
import { useTabContext, Tab } from './TabContext';
import { useModules } from './ModulesProvider';
import { useFavourites } from './FavouritesProvider';
import { createClient } from '@/lib/supabase';
import {
  DASHBOARD_ITEM, TOOL_NAV_ITEMS, WORKSPACE_NAV_ITEMS,
  NAV_ITEM_BY_ID, WORKSPACE_MODULE_IDS, type NavItem,
} from '@/config/navItems';
import { CALENDAR_CHANGED } from '@/lib/calendarBus';

interface SidebarProps {
  userName?: string;
  userEmail?: string;
  userRole?: string;
  avatarUrl?: string | null;
}

export default function Sidebar({ userName, userEmail, userRole, avatarUrl }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [todayEventCount, setTodayEventCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const { openTab, openInNewTab, setActiveTabId, tabs, activeTabId } = useTabContext();
  const { getActivity, resetIfDone } = useTabActivityContext();
  const { isModuleActive } = useModules();
  const { favourites } = useFavourites();
  const supabase = createClient();
  const isAdmin = userRole === 'admin';
  const vaultActive = isModuleActive('document-vault');

  useEffect(() => {
    if (!vaultActive) return;
    fetch('/api/vault/sync/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.untaggedCount > 0) setUntaggedCount(data.untaggedCount); })
      .catch(() => {});
  }, [vaultActive]);

  // Fetch count of today's remaining events for the calendar badge
  useEffect(() => {
    const todayStr = new Date().toDateString();
    function fetchCount() {
      fetch('/api/calendar/reminders')
        .then(r => r.ok ? r.json() : { events: [] })
        .then(d => {
          const count = (d.events ?? []).filter(
            (e: { start: string }) => new Date(e.start).toDateString() === todayStr
          ).length;
          setTodayEventCount(count);
        })
        .catch(() => {});
    }
    fetchCount();
    const id = setInterval(fetchCount, 15 * 60 * 1000);
    window.addEventListener(CALENDAR_CHANGED, fetchCount);
    return () => {
      clearInterval(id);
      window.removeEventListener(CALENDAR_CHANGED, fetchCount);
    };
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handleNavClick(item: NavItem) {
    if (item.href === '/dashboard') { setActiveTabId(null); return; }
    const IconComponent = item.icon as Tab['icon'];
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.route !== item.href && getActivity(activeTab.route) === 'processing') {
      const openNew = confirm(
        `"${activeTab.title}" is still processing.\n\nClick OK to open ${item.label} in a new tab, or Cancel to stay here.`
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
    openInNewTab({ id: item.moduleId, title: item.label, route: item.href, icon: item.icon as Tab['icon'] });
    resetIfDone(item.href);
    window.history.replaceState(null, '', item.href);
  }

  // ── Computed sets ──────────────────────────────────────────────────────────

  // Active favourites: user's ordered list, resolved to NavItems, filtered to active modules only
  const activeFavouriteItems: NavItem[] = favourites
    .map(id => NAV_ITEM_BY_ID.get(id))
    .filter((item): item is NavItem => {
      if (!item) return false;
      if (item.moduleId === 'dashboard' || item.moduleId === 'settings' || item.moduleId === 'help') return false;
      if (WORKSPACE_MODULE_IDS.has(item.moduleId)) return true; // clients etc. always active
      return isModuleActive(item.moduleId);
    });

  // Set of moduleIds already shown in Favourites — exclude from Tools & Workspace sections
  const favouritedIds = new Set(activeFavouriteItems.map(i => i.moduleId));

  const visibleTools = TOOL_NAV_ITEMS.filter(item => isModuleActive(item.moduleId) && !favouritedIds.has(item.moduleId));
  const inactiveCount = TOOL_NAV_ITEMS.filter(item => !isModuleActive(item.moduleId)).length;
  const visibleWorkspace = WORKSPACE_NAV_ITEMS.filter(item => !favouritedIds.has(item.moduleId));

  const width = collapsed ? 64 : 240;

  // ── Render helpers ─────────────────────────────────────────────────────────

  /** Section label — hidden when collapsed */
  function sectionLabel(text: string) {
    if (collapsed) return <div className="h-2" />;
    return (
      <p className="px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {text}
      </p>
    );
  }

  /** Tool item (tab-based active state, open-in-new-tab affordance) */
  function renderToolItem(item: NavItem, isFavourite = false) {
    const Icon = item.icon;
    const isActive = tabs.find(t => t.id === activeTabId)?.route === item.href;
    const colorClass = isActive
      ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
      : isFavourite
        ? 'bg-[var(--accent-light)] text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
        : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
    const iconClass = `shrink-0 transition-colors duration-150 ${isActive ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'}`;

    const isCalendar = item.moduleId === 'google-calendar';
    const calBadge   = isCalendar && todayEventCount > 0;
    const badgeLabel = todayEventCount > 9 ? '9+' : String(todayEventCount);

    if (collapsed) {
      return (
        <div key={item.href} className="relative">
          <button
            onClick={() => handleNavClick(item)}
            title={calBadge ? `${item.label} · ${todayEventCount} event${todayEventCount !== 1 ? 's' : ''} today` : item.label}
            className={`flex items-center justify-center w-full h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
          >
            <Icon size={18} className={iconClass} />
          </button>
          {calBadge && (
            <span className={`absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                             text-[9px] font-bold flex items-center justify-center pointer-events-none
                             ${isActive ? 'bg-white text-[var(--accent)]' : 'bg-[var(--accent)] text-white'}`}>
              {badgeLabel}
            </span>
          )}
        </div>
      );
    }

    const isInBackgroundTab = !isActive && tabs.some(t => t.route === item.href);
    const activity = isInBackgroundTab ? getActivity(item.href) : 'idle';

    return (
      <div
        key={item.href}
        className={`relative flex items-center h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
      >
        <button
          onClick={() => handleNavClick(item)}
          className="flex items-center gap-3 flex-1 min-w-0 h-full px-3"
        >
          <Icon size={18} className={iconClass} />
          <span className="text-sm font-medium truncate text-left">{item.label}</span>
        </button>

        {!isActive && (
          <span className="flex items-center shrink-0 pr-2 gap-1">
            {isInBackgroundTab && (
              <span className="group-hover:hidden flex items-center">
                {activity === 'processing' && <span title="Processing"><Loader2 size={11} className="animate-spin text-[var(--accent)]" /></span>}
                {activity === 'done'       && <span title="Done"><Check size={11} className="text-emerald-500" /></span>}
                {activity === 'idle'       && <span className="block w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-60" title="Open in tab" />}
              </span>
            )}
            {isFavourite && (
              <Star
                size={9}
                className="text-[var(--accent)] opacity-50 group-hover:opacity-0 transition-opacity pointer-events-none"
                fill="currentColor"
              />
            )}
            <button
              onClick={e => { e.stopPropagation(); handleOpenInNewTab(item); }}
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
              title="Open in new tab"
            >
              <Plus size={10} />
            </button>
          </span>
        )}

        {item.moduleId === 'document-vault' && untaggedCount > 0 && (
          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-white text-[10px] font-bold flex items-center justify-center mr-2">
            {untaggedCount > 99 ? '99+' : untaggedCount}
          </span>
        )}

        {calBadge && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           flex items-center justify-center mr-2
                           ${isActive ? 'bg-white text-[var(--accent)]' : 'bg-[var(--accent)] text-white'}`}>
            {badgeLabel}
          </span>
        )}
      </div>
    );
  }

  /** Workspace item (pathname-based active state, with + new-tab affordance) */
  function renderWorkspaceItem(item: NavItem, isFavourite = false) {
    const Icon = item.icon;
    const isActive = pathname.startsWith(item.href);
    const isInBackgroundTab = !isActive && tabs.some(t => t.route === item.href);
    const activity = isInBackgroundTab ? getActivity(item.href) : 'idle';
    const colorClass = isActive
      ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
      : isFavourite
        ? 'bg-[var(--accent-light)] text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
        : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
    const iconClass = `shrink-0 transition-colors duration-150 ${isActive ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'}`;

    if (collapsed) {
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={() => handleNavClick(item)}
          title={item.label}
          className={`flex items-center justify-center w-full h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
        >
          <Icon size={18} className={iconClass} />
        </Link>
      );
    }

    return (
      <div
        key={item.href}
        className={`relative flex items-center h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
      >
        <Link
          href={item.href}
          onClick={() => handleNavClick(item)}
          className="flex items-center gap-3 flex-1 min-w-0 h-full px-3"
        >
          <Icon size={18} className={iconClass} />
          <span className="text-sm font-medium truncate">{item.label}</span>
        </Link>

        {/* Background-tab dot + new-tab button — same affordance as tool items */}
        {!isActive && (
          <span className="flex items-center shrink-0 pr-2 gap-1">
            {isInBackgroundTab && (
              <span className="group-hover:hidden flex items-center">
                {activity === 'processing' && <span title="Processing"><Loader2 size={11} className="animate-spin text-[var(--accent)]" /></span>}
                {activity === 'done'       && <span title="Done"><Check size={11} className="text-emerald-500" /></span>}
                {activity === 'idle'       && <span className="block w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-60" title="Open in tab" />}
              </span>
            )}
            {isFavourite && (
              <Star
                size={9}
                className="text-[var(--accent)] opacity-50 group-hover:opacity-0 transition-opacity pointer-events-none"
                fill="currentColor"
              />
            )}
            <button
              onClick={e => { e.stopPropagation(); handleOpenInNewTab(item); }}
              className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
              title="Open in new tab"
            >
              <Plus size={10} />
            </button>
          </span>
        )}
      </div>
    );
  }

  /** Dispatch to the correct renderer based on item type */
  function renderFavouriteItem(item: NavItem) {
    if (WORKSPACE_MODULE_IDS.has(item.moduleId)) return renderWorkspaceItem(item, true);
    return renderToolItem(item, true);
  }

  // ── Dashboard item ─────────────────────────────────────────────────────────
  const dashIsActive = pathname === '/dashboard' && activeTabId === null;
  const dashColorClass = dashIsActive
    ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
    : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
  const DashIcon = DASHBOARD_ITEM.icon;

  return (
    <aside
      style={{ width, minWidth: width }}
      className="glass-sidebar flex flex-col h-screen sticky top-0 z-40 transition-[width] duration-200 ease-in-out overflow-hidden"
    >
      {/* Logo */}
      <div className={`flex items-center h-14 px-4 border-b border-[var(--border)] shrink-0 ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SMITH" className="w-7 h-7 rounded shrink-0 dark:invert" />
          {!collapsed && (
            <span className="font-bold text-base text-[var(--text-primary)] whitespace-nowrap tracking-tight">
              SMITH
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2 space-y-0.5">

        {/* ── Dashboard (always first, no section label) ─────────────────── */}
        <Link
          href="/dashboard"
          onClick={() => handleNavClick(DASHBOARD_ITEM)}
          title={collapsed ? 'Dashboard' : undefined}
          className={`flex items-center gap-3 rounded-lg transition-all duration-150 group
            ${collapsed ? 'justify-center px-0 h-11' : 'px-3 h-11'} ${dashColorClass}`}
        >
          <DashIcon
            size={18}
            className={`shrink-0 transition-colors duration-150 ${dashIsActive ? 'text-white' : 'text-[var(--text-muted)] group-hover:text-[var(--accent)]'}`}
          />
          {!collapsed && <span className="text-sm font-medium truncate">Dashboard</span>}
        </Link>

        {/* ── Favourites section (only shown when user has active favourites) */}
        {activeFavouriteItems.length > 0 && (
          <>
            {sectionLabel('Favourites')}
            {activeFavouriteItems.map(item => renderFavouriteItem(item))}
          </>
        )}

        {/* ── Tools section ──────────────────────────────────────────────── */}
        {visibleTools.length > 0 && (
          <>
            {sectionLabel('Tools')}
            {visibleTools.map(item => renderToolItem(item))}
          </>
        )}

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

        {/* ── Workspace section ───────────────────────────────────────────── */}
        {visibleWorkspace.length > 0 && sectionLabel('Workspace')}
        {visibleWorkspace.map(item => renderWorkspaceItem(item))}

        {/* Shortcut to manage favourites — collapsed: star icon, expanded: text link */}
        {!collapsed && (
          <Link
            href="/settings?tab=preferences"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-nav-hover)] transition-all duration-150 group"
          >
            <Star size={12} className="shrink-0 group-hover:text-[var(--accent)]" />
            <span>Manage favourites</span>
          </Link>
        )}
      </nav>

      {/* User Profile */}
      <div className="border-t border-[var(--border)] px-2 py-3 shrink-0">
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

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center h-8 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-all duration-150 mt-1"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span className="text-xs ml-1">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
