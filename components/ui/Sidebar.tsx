'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  Settings, HelpCircle, ChevronLeft, ChevronRight,
  LogOut, Puzzle, Loader2, Check, Plus, Star, AlertCircle,
  LayoutGrid, Search, X,
} from 'lucide-react';
import { useTabActivityContext } from './TabActivityContext';
import { TOOL_ROUTES } from './TabPanels';
import Avatar from './Avatar';
import Tooltip from './Tooltip';
import { useTabContext, Tab } from './TabContext';
import { useModules } from './ModulesProvider';
import { useEmailCount } from './EmailCountProvider';
import { useTaskCountsOrZero } from './TasksCountProvider';
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
  // Tools flyout — keeps the main rail uncluttered: favourites show individually,
  // every other tool lives behind a single "Tools" button that opens this panel.
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toolSearch, setToolSearch] = useState('');
  const [untaggedCount, setUntaggedCount] = useState(0);
  const [todayEventCount, setTodayEventCount] = useState(0);
  const [hrBadgeCount, setHrBadgeCount] = useState(0);
  const [mtdItUnreadCount, setMtdItUnreadCount] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const { openTab, openInNewTab, setActiveTabId, tabs, activeTabId } = useTabContext();
  const { getActivity, resetIfDone } = useTabActivityContext();
  const { isModuleActive } = useModules();
  const { favourites, updateFavourites } = useFavourites();
  const supabase = createClient();
  const isAdmin = userRole === 'admin';
  const vaultActive = isModuleActive('document-vault');

  // Email Triage badge = the shared Untriaged count, fetched once app-wide by
  // EmailCountProvider (and kept live by the triage page's broadcasts). null
  // while it first loads — treat as 0 for the badge.
  const { untriaged } = useEmailCount();
  const emailUnreadCount = untriaged ?? 0;

  // Tasks badge + alert markers = the shared workload counts, fetched once
  // app-wide by TasksCountProvider (same source as the dashboard hero/widget).
  const taskCounts = useTaskCountsOrZero();
  const myTaskCount = taskCounts.count;
  const myTaskOverdueCount = taskCounts.overdue;
  const myTaskDueSoonCount = taskCounts.dueWithin7;

  useEffect(() => {
    if (!vaultActive) return;
    fetch('/api/vault/sync/status')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.untaggedCount > 0) setUntaggedCount(data.untaggedCount); })
      .catch(() => {});
  }, [vaultActive]);

  // Fetch MTD IT unread approval count for the sidebar badge
  useEffect(() => {
    const mtdItActive = isModuleActive('mtd-it');
    if (!mtdItActive) return;
    function fetchMtdIt() {
      fetch('/api/mtd-it/approvals/unread')
        .then(r => r.ok ? r.json() : { total: 0 })
        .then(d => setMtdItUnreadCount(d.total ?? 0))
        .catch(() => {});
    }
    fetchMtdIt();
    const id = setInterval(fetchMtdIt, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [isModuleActive]);

  // Fetch HR badge count (pending approvals + unread hr_* notifications)
  useEffect(() => {
    const hrActive = isModuleActive('hr');
    if (!hrActive) return;
    function fetchHr() {
      fetch('/api/hr/badge-counts')
        .then(r => r.ok ? r.json() : { total: 0 })
        .then(d => setHrBadgeCount(d.total ?? 0))
        .catch(() => {});
    }
    fetchHr();
    const id = setInterval(fetchHr, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [isModuleActive]);

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

  // Use replaceState for tool tabs (kept mounted by TabPanels) and router.push for
  // workspace / settings / help / non-tool routes so Next.js actually renders them.
  function navigateTo(route: string) {
    if (TOOL_ROUTES.has(route)) {
      window.history.replaceState(null, '', route);
    } else {
      router.push(route);
    }
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
      navigateTo(item.href);
      return;
    }
    openTab({ id: item.moduleId, title: item.label, route: item.href, icon: IconComponent });
    resetIfDone(item.href);
    navigateTo(item.href);
  }

  function handleOpenInNewTab(item: NavItem) {
    openInNewTab({ id: item.moduleId, title: item.label, route: item.href, icon: item.icon as Tab['icon'] });
    resetIfDone(item.href);
    navigateTo(item.href);
  }

  // ── Computed sets ──────────────────────────────────────────────────────────

  // Active favourites: user's ordered list, resolved to NavItems, filtered to active modules only
  const activeFavouriteItems: NavItem[] = favourites
    .map(id => NAV_ITEM_BY_ID.get(id))
    .filter((item): item is NavItem => {
      if (!item) return false;
      // Dashboard/Settings/Help/Community are workspace utilities — they
      // always live in their fixed workspace slot, not the favourites list,
      // so the relative order Help → Community → Settings stays predictable.
      if (item.moduleId === 'dashboard' || item.moduleId === 'settings' || item.moduleId === 'help' || item.moduleId === 'community') return false;
      if (WORKSPACE_MODULE_IDS.has(item.moduleId)) return true; // clients etc. always active
      return isModuleActive(item.moduleId);
    });

  // Set of moduleIds already shown in Favourites — exclude from Tools & Workspace sections
  const favouritedIds = new Set(activeFavouriteItems.map(i => i.moduleId));

  // Coming-soon items are not counted as "inactive modules" — they're not yet
  // available to enable, so showing them in the admin hint would be misleading.
  const inactiveCount = TOOL_NAV_ITEMS.filter(item =>
    !item.comingSoon && !isModuleActive(item.moduleId)
  ).length;
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
  function renderToolItem(item: NavItem) {
    const Icon = item.icon;
    const isActive = tabs.find(t => t.id === activeTabId)?.route === item.href;
    const colorClass = isActive
      ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
      : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
    const iconClass = `shrink-0 transition-colors duration-150 ${isActive ? 'text-[var(--text-nav-active)]' : 'text-[var(--text-muted)]'}`;

    const isCalendar = item.moduleId === 'google-calendar';
    const calBadge   = isCalendar && todayEventCount > 0;
    const calLabel   = String(todayEventCount);

    const isEmail    = item.moduleId === 'email-triage';
    const emailBadge = isEmail && emailUnreadCount > 0;
    const emailLabel = String(emailUnreadCount);

    const isTasks    = item.moduleId === 'tasks';
    const taskBadge  = isTasks && myTaskCount > 0;
    const taskLabel  = String(myTaskCount);
    const showOverdueAlert = isTasks && myTaskOverdueCount > 0;
    const showDueSoonAlert = isTasks && myTaskDueSoonCount > 0;

    const isHr       = item.moduleId === 'hr';
    const hrBadge    = isHr && hrBadgeCount > 0;
    const hrLabel    = String(hrBadgeCount);

    const isMtdIt    = item.moduleId === 'mtd-it';
    const mtdItBadge = isMtdIt && mtdItUnreadCount > 0;
    const mtdItLabel = String(mtdItUnreadCount);

    if (collapsed) {
      const collapsedLabel =
        item.comingSoon ? `${item.label} · Coming soon`
        : calBadge   ? `${item.label} · ${todayEventCount} event${todayEventCount !== 1 ? 's' : ''} today`
        : emailBadge ? `${item.label} · ${emailUnreadCount} untriaged`
        : taskBadge  ? `${item.label} · ${myTaskCount} active task${myTaskCount !== 1 ? 's' : ''} assigned to you`
        : hrBadge    ? `${item.label} · ${hrBadgeCount} item${hrBadgeCount !== 1 ? 's' : ''} needing attention`
        : mtdItBadge ? `${item.label} · ${mtdItUnreadCount} new client response${mtdItUnreadCount !== 1 ? 's' : ''}`
        : item.label;
      return (
        <div key={item.href} className="relative">
          <Tooltip label={collapsedLabel} side="right">
            <button
              onClick={() => handleNavClick(item)}
              aria-label={collapsedLabel}
              className={`flex items-center justify-center w-full h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
            >
              <Icon size={18} className={iconClass} />
            </button>
          </Tooltip>
          {calBadge && (
            <span className={`absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                             text-[9px] font-bold flex items-center justify-center pointer-events-none
                             ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
              {calLabel}
            </span>
          )}
          {emailBadge && (
            <span className={`absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                             text-[9px] font-bold flex items-center justify-center pointer-events-none
                             ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
              {emailLabel}
            </span>
          )}
          {taskBadge && (
            <span className={`absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                             text-[9px] font-bold flex items-center justify-center pointer-events-none
                             ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
              {taskLabel}
            </span>
          )}
          {showOverdueAlert && (
            <Tooltip label={`${myTaskOverdueCount} overdue task${myTaskOverdueCount !== 1 ? 's' : ''}`} side="right">
              <span className="absolute bottom-1 right-1 pointer-events-auto">
                <AlertCircle size={11} className="text-red-500 fill-white" strokeWidth={2.5} />
              </span>
            </Tooltip>
          )}
          {!showOverdueAlert && showDueSoonAlert && (
            <Tooltip label={`${myTaskDueSoonCount} task${myTaskDueSoonCount !== 1 ? 's' : ''} due in the next 7 days`} side="right">
              <span className="absolute bottom-1 right-1 pointer-events-auto">
                <AlertCircle size={11} className="text-amber-500 fill-white" strokeWidth={2.5} />
              </span>
            </Tooltip>
          )}
          {hrBadge && (
            <span className={`absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                             text-[9px] font-bold flex items-center justify-center pointer-events-none
                             ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
              {hrLabel}
            </span>
          )}
          {mtdItBadge && (
            <span className={`absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-0.5 rounded-full
                             text-[9px] font-bold flex items-center justify-center pointer-events-none
                             ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
              {mtdItLabel}
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
          {item.comingSoon && (
            <span className="shrink-0 ml-auto mr-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200">
              Soon
            </span>
          )}
        </button>

        {!isActive && (
          <span className="flex items-center shrink-0 pr-2 gap-1">
            {isInBackgroundTab && (
              <span className="group-hover:hidden flex items-center">
                {activity === 'processing' && <Tooltip label="Processing"><span><Loader2 size={11} className="animate-spin text-white" /></span></Tooltip>}
                {activity === 'done'       && <Tooltip label="Done"><span><Check size={11} className="text-white" /></span></Tooltip>}
                {activity === 'idle'       && <Tooltip label="Open in tab"><span className="block w-1.5 h-1.5 rounded-full bg-white opacity-80" /></Tooltip>}
              </span>
            )}
            <Tooltip label="Open in new tab">
              <button
                onClick={e => { e.stopPropagation(); handleOpenInNewTab(item); }}
                aria-label="Open in new tab"
                className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-white hover:bg-white/20 transition-colors"
              >
                <Plus size={10} />
              </button>
            </Tooltip>
          </span>
        )}

        {item.moduleId === 'document-vault' && untaggedCount > 0 && (
          <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-400 text-white text-[10px] font-bold flex items-center justify-center mr-2">
            {untaggedCount}
          </span>
        )}

        {calBadge && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           flex items-center justify-center mr-2
                           ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
            {calLabel}
          </span>
        )}

        {emailBadge && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           flex items-center justify-center mr-2
                           ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
            {emailLabel}
          </span>
        )}

        {showOverdueAlert && (
          <Tooltip label={`${myTaskOverdueCount} overdue task${myTaskOverdueCount !== 1 ? 's' : ''}`}>
            <span className="shrink-0 mr-1 inline-flex items-center"><AlertCircle size={13} className="text-red-500 fill-white" strokeWidth={2.5} /></span>
          </Tooltip>
        )}
        {showDueSoonAlert && (
          <Tooltip label={`${myTaskDueSoonCount} task${myTaskDueSoonCount !== 1 ? 's' : ''} due in the next 7 days`}>
            <span className="shrink-0 mr-1 inline-flex items-center"><AlertCircle size={13} className="text-amber-500 fill-white" strokeWidth={2.5} /></span>
          </Tooltip>
        )}
        {taskBadge && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           flex items-center justify-center mr-2
                           ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
            {taskLabel}
          </span>
        )}

        {hrBadge && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           flex items-center justify-center mr-2
                           ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
            {hrLabel}
          </span>
        )}

        {mtdItBadge && (
          <span className={`shrink-0 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold
                           flex items-center justify-center mr-2
                           ${isActive ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--accent)] shadow-sm'}`}>
            {mtdItLabel}
          </span>
        )}
      </div>
    );
  }

  /** Workspace item (pathname-based active state, with + new-tab affordance) */
  function renderWorkspaceItem(item: NavItem) {
    const Icon = item.icon;
    const isActive = pathname.startsWith(item.href);
    const isInBackgroundTab = !isActive && tabs.some(t => t.route === item.href);
    const activity = isInBackgroundTab ? getActivity(item.href) : 'idle';
    const colorClass = isActive
      ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
      : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
    const iconClass = `shrink-0 transition-colors duration-150 ${isActive ? 'text-[var(--text-nav-active)]' : 'text-[var(--text-muted)]'}`;

    if (collapsed) {
      // Wrap in a block-level div so the workspace icons stack vertically.
      // Tooltip's outer element is inline-flex, so without this wrapper two
      // narrow icons (Help + Community) flow side-by-side in the 64px nav
      // rather than each taking its own row — matches what renderToolItem
      // already does for tool icons.
      return (
        <div key={item.href}>
          <Tooltip label={item.label} side="right">
            <Link
              href={item.href}
              onClick={() => handleNavClick(item)}
              aria-label={item.label}
              className={`flex items-center justify-center w-full h-11 rounded-lg transition-all duration-150 group ${colorClass}`}
            >
              <Icon size={18} className={iconClass} />
            </Link>
          </Tooltip>
        </div>
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
                {activity === 'processing' && <Tooltip label="Processing"><span><Loader2 size={11} className="animate-spin text-white" /></span></Tooltip>}
                {activity === 'done'       && <Tooltip label="Done"><span><Check size={11} className="text-white" /></span></Tooltip>}
                {activity === 'idle'       && <Tooltip label="Open in tab"><span className="block w-1.5 h-1.5 rounded-full bg-white opacity-80" /></Tooltip>}
              </span>
            )}
            <Tooltip label="Open in new tab">
              <button
                onClick={e => { e.stopPropagation(); handleOpenInNewTab(item); }}
                aria-label="Open in new tab"
                className="hidden group-hover:flex items-center justify-center w-4 h-4 rounded text-white hover:bg-white/20 transition-colors"
              >
                <Plus size={10} />
              </button>
            </Tooltip>
          </span>
        )}
      </div>
    );
  }

  /** Dispatch to the correct renderer based on item type */
  function renderFavouriteItem(item: NavItem) {
    if (WORKSPACE_MODULE_IDS.has(item.moduleId)) return renderWorkspaceItem(item);
    return renderToolItem(item);
  }

  /** Pin / unpin a tool from the flyout */
  function toggleFavourite(moduleId: string) {
    if (favourites.includes(moduleId)) {
      updateFavourites(favourites.filter(id => id !== moduleId));
    } else {
      updateFavourites([...favourites, moduleId]);
    }
  }

  // All tools available to surface in the flyout (active modules + coming-soon),
  // filtered by the search box and sorted alphabetically.
  const flyoutTools = TOOL_NAV_ITEMS
    .filter(item => item.comingSoon || isModuleActive(item.moduleId))
    .filter(item => item.label.toLowerCase().includes(toolSearch.trim().toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label));

  // ── Dashboard item ─────────────────────────────────────────────────────────
  const dashIsActive = pathname === '/dashboard' && activeTabId === null;
  const dashColorClass = dashIsActive
    ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
    : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
  const DashIcon = DASHBOARD_ITEM.icon;

  return (
    <>
    <aside
      style={{ width, minWidth: width }}
      className="glass-sidebar flex flex-col h-full z-40 transition-[width] duration-200 ease-in-out overflow-hidden"
    >
      {/* Logo */}
      <div className={`flex items-center h-14 px-4 shrink-0 ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
        <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SMITH" className="w-7 h-7 rounded shrink-0 brightness-0 invert" />
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
        {(() => {
          const dashLink = (
            <Link
              href="/dashboard"
              onClick={() => handleNavClick(DASHBOARD_ITEM)}
              aria-label="Dashboard"
              className={`flex items-center gap-3 rounded-lg transition-all duration-150 group
                ${collapsed ? 'justify-center px-0 h-11' : 'px-3 h-11'} ${dashColorClass}`}
            >
              <DashIcon
                size={18}
                className={`shrink-0 transition-colors duration-150 ${dashIsActive ? 'text-[var(--text-nav-active)]' : 'text-[var(--text-muted)]'}`}
              />
              {!collapsed && <span className="text-sm font-medium truncate">Dashboard</span>}
            </Link>
          );
          return collapsed ? <Tooltip label="Dashboard" side="right">{dashLink}</Tooltip> : dashLink;
        })()}

        {/* ── Favourites — shown individually, directly under Dashboard.
              No section label, no star, no coloured background (per design). */}
        {activeFavouriteItems.map(item => renderFavouriteItem(item))}

        {/* ── Tools — a single entry; clicking opens the flyout list of every
              other tool, keeping the rail uncluttered. ─────────────────────── */}
        {(() => {
          const toolsBtn = (
            <button
              onClick={() => setToolsOpen(o => !o)}
              aria-label="Tools"
              aria-expanded={toolsOpen}
              className={`flex items-center gap-3 w-full rounded-lg transition-all duration-150 group
                ${collapsed ? 'justify-center px-0 h-11' : 'px-3 h-11'}
                ${toolsOpen
                  ? 'bg-[var(--bg-nav-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'}`}
            >
              <LayoutGrid
                size={18}
                className="shrink-0 transition-colors duration-150 text-[var(--text-muted)]"
              />
              {!collapsed && <span className="text-sm font-medium truncate flex-1 text-left">Tools</span>}
              {!collapsed && (
                <ChevronRight
                  size={14}
                  className={`shrink-0 transition-transform duration-150 text-[var(--text-muted)] ${toolsOpen ? 'translate-x-0.5' : ''}`}
                />
              )}
            </button>
          );
          return collapsed ? <Tooltip label="Tools" side="right">{toolsBtn}</Tooltip> : toolsBtn;
        })()}

        {/* ── Workspace section ───────────────────────────────────────────── */}
        {visibleWorkspace.length > 0 && sectionLabel('Workspace')}
        {visibleWorkspace.map(item => renderWorkspaceItem(item))}
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
            <Tooltip label="Sign out" side="top">
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                aria-label="Sign out"
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:text-[var(--danger)]"
              >
                <LogOut size={14} className="text-[var(--text-muted)]" />
              </button>
            </Tooltip>
          </div>
        )}

        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="top">
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-full flex items-center justify-center h-8 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-all duration-150 mt-1"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            {!collapsed && <span className="text-xs ml-1">Collapse</span>}
          </button>
        </Tooltip>
      </div>
    </aside>

    {/* ── Tools flyout ──────────────────────────────────────────────────────
          Slides out from the rail's right edge with the full tool list. Lives
          outside the <aside> (which clips overflow) and uses fixed positioning
          anchored to the current sidebar width. */}
    {toolsOpen && (
      <>
        {/* Click-catcher to dismiss */}
        <div
          className="fixed inset-0 z-[48]"
          onClick={() => { setToolsOpen(false); setToolSearch(''); }}
        />
        <div
          style={{ left: 12 + width, top: 12, bottom: 12, backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
          className="fixed z-[49] isolate w-[300px] glass-sidebar shadow-dropdown flex flex-col animate-fade-in rounded-r-[20px] overflow-hidden"
        >
          {/* Backdrop layer — the very same app gradient the sidebar shows,
              viewport-fixed so it lines up exactly, and blurred to match the
              sidebar's backdrop-filter. Sits behind the content (-z-10) so the
              flyout reads as the sidebar background flowing straight through. */}
          <div
            aria-hidden
            className="absolute -z-10 pointer-events-none"
            style={{
              inset: 0,
              backgroundColor: '#c2c9e9',
              // Match the body's exact stack so the sidebar's gradient continues:
              // sidebar dark overlay (0.28→0.40) · the body's 15% white wash · the
              // app-background image. Viewport-fixed so it lines up pixel-for-pixel
              // with what the sidebar reveals. (No blur filter — it would break
              // background-attachment:fixed and is imperceptible on this smooth
              // gradient anyway.)
              backgroundImage:
                'linear-gradient(180deg, rgba(46, 48, 98, 0.28), rgba(46, 48, 98, 0.40)),' +
                'linear-gradient(rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.15)),' +
                'url(/app-background.png)',
              backgroundSize: 'cover, cover, cover',
              backgroundPosition: 'center, center, center',
              backgroundAttachment: 'fixed, fixed, fixed',
            }}
          />
          {/* Header */}
          <div className="flex items-center justify-between h-14 px-4 border-b border-[var(--border)] shrink-0">
            <div className="flex items-center gap-2">
              <LayoutGrid size={16} className="text-white" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Tools</span>
            </div>
            <button
              onClick={() => { setToolsOpen(false); setToolSearch(''); }}
              aria-label="Close tools"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-all"
            >
              <X size={15} />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-3 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                value={toolSearch}
                onChange={e => setToolSearch(e.target.value)}
                placeholder="Search tools…"
                autoFocus
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/55 text-sm outline-none transition focus:border-white/40 focus:bg-white/[0.16]"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-3 space-y-0.5">
            {flyoutTools.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-8">
                No tools match &ldquo;{toolSearch}&rdquo;.
              </p>
            ) : flyoutTools.map(item => {
              const Icon = item.icon;
              const isPinned = favourites.includes(item.moduleId);
              const isActiveTab = tabs.find(t => t.id === activeTabId)?.route === item.href;
              return (
                <div
                  key={item.href}
                  className={`relative flex items-center h-11 rounded-lg group transition-all duration-150
                    ${isActiveTab
                      ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
                      : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'}`}
                >
                  <button
                    onClick={() => { handleNavClick(item); setToolsOpen(false); setToolSearch(''); }}
                    className="flex items-center gap-3 flex-1 min-w-0 h-full px-3"
                  >
                    <Icon size={18} className={`shrink-0 ${isActiveTab ? 'text-[var(--text-nav-active)]' : 'text-[var(--text-muted)]'}`} />
                    <span className="text-sm font-medium truncate text-left">{item.label}</span>
                    {item.comingSoon && (
                      <span className="shrink-0 ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200">
                        Soon
                      </span>
                    )}
                  </button>
                  {!item.comingSoon && (
                    <div className="shrink-0 flex items-center gap-0.5 mr-2">
                      <Tooltip label="Open in new tab">
                        <button
                          onClick={e => { e.stopPropagation(); handleOpenInNewTab(item); setToolsOpen(false); setToolSearch(''); }}
                          aria-label="Open in new tab"
                          className="w-6 h-6 flex items-center justify-center rounded-md transition-all text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-white"
                        >
                          <Plus size={13} />
                        </button>
                      </Tooltip>
                      <Tooltip label={isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}>
                        <button
                          onClick={e => { e.stopPropagation(); toggleFavourite(item.moduleId); }}
                          aria-label={isPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
                          className={`w-6 h-6 flex items-center justify-center rounded-md transition-all
                            ${isActiveTab
                              ? 'text-white opacity-80 hover:opacity-100'
                              : isPinned
                                ? 'text-amber-300'
                                : 'text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-white'}`}
                        >
                          <Star size={13} fill={isPinned ? 'currentColor' : 'none'} />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer — admin shortcut to the plan (tools are set by the tier) */}
          {isAdmin && inactiveCount > 0 && (
            <Link
              href="/settings?tab=tiers"
              onClick={() => { setToolsOpen(false); setToolSearch(''); }}
              className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors shrink-0"
            >
              <Puzzle size={13} className="shrink-0" />
              <span>{inactiveCount} tool{inactiveCount !== 1 ? 's' : ''} in other plans — Manage plan</span>
            </Link>
          )}
        </div>
      </>
    )}
    </>
  );
}
