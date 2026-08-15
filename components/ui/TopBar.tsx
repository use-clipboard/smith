'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search, Bell, MessageSquare, X, FileSearch, ArrowLeftRight, Building2, House,
  ClipboardCheck, Gauge, Receipt, ShieldAlert, FileText, Users, CalendarDays, MicVocal, UserPlus,
  Maximize2, Clock, Megaphone,
} from 'lucide-react';
import Avatar from './Avatar';
import Tooltip from './Tooltip';
import StickyNotesHeaderButton from './StickyNotes/StickyNotesHeaderButton';
import { useChatContext } from '@/components/chat/ChatProvider';
import ChatPanel from '@/components/chat/ChatPanel';
import { useTabContext } from '@/components/ui/TabContext';
import { useFocusMode } from './FocusModeProvider';
import { useNotifications } from './NotificationsProvider';
import { notificationTarget, goToNotification, NAVIGATE_TAB_EVENT } from '@/lib/notificationTarget';
import { useModules } from './ModulesProvider';
import { useTimesheets } from '@/components/features/timesheets/TimesheetsProvider';
import { fmtStopwatch, timerElapsedMs } from '@/lib/timesheets/format';
import { useOpenProfile } from '@/components/features/team/useOpenProfile';
import { TOOL_NAV_ITEMS, WORKSPACE_NAV_ITEMS } from '@/config/navItems';
import type { Tab } from '@/components/ui/TabContext';
import type { LucideIcon } from 'lucide-react';

// Route → Tab definition for every item that should open in a tab
const ROUTE_TO_TAB = new Map<string, Tab>(
  [...TOOL_NAV_ITEMS, WORKSPACE_NAV_ITEMS.find(i => i.moduleId === 'clients')!]
    .map(item => [
      item.href,
      { id: item.moduleId, title: item.label, route: item.href, icon: item.icon as LucideIcon },
    ])
);

interface TopBarProps {
  userName?: string;
  avatarUrl?: string | null;
}

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard':       'Dashboard',
  '/full-analysis':   'Capture',
  '/bank-to-csv':     'Bank to CSV',
  '/landlord':        'Landlord Analysis',
  '/mtd-it':          'MTD IT',
  '/final-accounts':  'Accounts Review',
  '/accounts-studio': 'Accounts Studio',
  '/performance':     'Performance Analysis',
  '/p32':             'P32 Summary',
  '/risk-assessment': 'Risk Assessment',
  '/summarise':       'Summarise Documents',
  '/ch-secretarial':  'CH Secretarial',
  '/email':           'Email',
  '/campaigns':       'Campaigns',
  '/vault':           'Document Vault',
  '/calendar':        'Calendar',
  '/meeting-notes':   'Meeting Notes',
  '/staff-hire':      'Staff Hire',
  '/hr':              'HR',
  '/policies':        'Policies & Procedures',
  '/clients':         'Clients',
  '/tasks':           'Tasks',
  '/timesheets':      'Timesheets',
  '/bookkeeping':     'Bookkeeping',
  '/help':            'Help',
  '/settings':        'Settings',
};

function getPageTitle(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  const matched = Object.keys(ROUTE_TITLES).find(route =>
    route !== '/dashboard' && pathname.startsWith(route)
  );
  return matched ? ROUTE_TITLES[matched] : 'SMITH';
}

const TOOLS = [
  { label: 'Full Analysis',        href: '/full-analysis',   icon: FileSearch },
  { label: 'Bank to CSV',          href: '/bank-to-csv',     icon: ArrowLeftRight },
  { label: 'Landlord Analysis',    href: '/landlord',        icon: House },
  { label: 'Accounts Review',      href: '/final-accounts',  icon: ClipboardCheck },
  { label: 'Performance Analysis', href: '/performance',     icon: Gauge },
  { label: 'P32 Summary',          href: '/p32',             icon: Receipt },
  { label: 'Risk Assessment',      href: '/risk-assessment', icon: ShieldAlert },
  { label: 'Summarise',            href: '/summarise',       icon: FileText },
  { label: 'CH Secretarial',       href: '/ch-secretarial',  icon: Building2 },
  { label: 'Campaigns',            href: '/campaigns',       icon: Megaphone },
  { label: 'Calendar',             href: '/calendar',        icon: CalendarDays },
  { label: 'Meeting Notes',        href: '/meeting-notes',   icon: MicVocal },
  { label: 'Staff Hire',           href: '/staff-hire',      icon: UserPlus },
  { label: 'Clients',              href: '/clients',         icon: Users },
];

interface PersonResult {
  id: string;
  full_name?: string | null;
  email: string;
  avatar_url?: string | null;
}

interface ClientResult {
  id: string;
  name: string;
  client_ref: string | null;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function notifDotColor(type: string): string {
  if (type === 'calendar_invite') return '#10b981';      // emerald
  if (type === 'calendar_updated') return '#3b82f6';     // blue
  if (type === 'calendar_deleted') return '#ef4444';     // red
  if (type === 'client_step_complete') return '#4F46E5'; // indigo
  if (type === 'task_assigned') return '#f59e0b';        // amber
  if (type === 'task_status_changed') return '#3b82f6';  // blue
  return '#9ca3af';                                      // grey
}

export default function TopBar({ userName, avatarUrl }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = getPageTitle(pathname);
  const { totalUnread, isPanelOpen, setIsPanelOpen } = useChatContext();
  const { openTab } = useTabContext();
  const { toggleFocusMode } = useFocusMode();
  const openProfile = useOpenProfile();

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<ClientResult[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const clientDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Team members for the search "People" section — the firm list is small, so
  // we load it once and filter client-side.
  useEffect(() => {
    fetch('/api/users/team')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.members) setPeople(d.members as PersonResult[]); })
      .catch(() => {});
  }, []);

  // Notifications — sourced from the app-wide NotificationsProvider, which is
  // pushed in real time (Supabase Realtime). TopBar just renders + drives toasts.
  const { notifications, unreadCount, markAllRead: markAllReadCtx, dismiss: dismissCtx, refresh: refreshNotifs } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Timesheets quick-timer — only surfaced when the firm has the module
  // (Practice Suite). Lets a user start/see a timer from anywhere in the app.
  const { isModuleActive } = useModules();
  const timesheetsActive = isModuleActive('timesheets');
  const { timers, nowMs, openStartModal } = useTimesheets();
  const activeTimer = timers.find(t => !t.paused) ?? null; // the one counting, if any

  // Notification toasts now live in NotificationToastNotifier (rendered at the
  // app-shell level so they anchor bottom-right of the viewport, not inside the
  // header). TopBar only renders the bell + dropdown.

  // Let other parts of the app (e.g. the dashboard's notifications tile) open
  // this dropdown via a window event.
  useEffect(() => {
    const openNotifs = () => { setNotifOpen(true); setSearchOpen(false); refreshNotifs(); };
    window.addEventListener('smith:open-notifications', openNotifs);
    return () => window.removeEventListener('smith:open-notifications', openNotifs);
  }, [refreshNotifs]);

  // A notification click (from a toast or the bell) asks us to open the right
  // tool tab — we own the route→tab map, so route it through `navigate`.
  useEffect(() => {
    const onNav = (e: Event) => navigate((e as CustomEvent<string>).detail);
    window.addEventListener(NAVIGATE_TAB_EVENT, onNav);
    return () => window.removeEventListener(NAVIGATE_TAB_EVENT, onNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleMarkAllRead() {
    await markAllReadCtx();
  }

  function handleDismiss(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    void dismissCtx(id);
  }

  // Open/close search
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setClients([]);
    }
  }, [searchOpen]);

  // Debounced server-side client search — fires 250 ms after the user stops typing
  useEffect(() => {
    if (clientDebounceRef.current) clearTimeout(clientDebounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setClients([]);
      setLoadingClients(false);
      return;
    }
    setLoadingClients(true);
    clientDebounceRef.current = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(trimmed)}`)
        .then(r => r.json())
        .then(d => setClients(d.clients ?? []))
        .catch(() => setClients([]))
        .finally(() => setLoadingClients(false));
    }, 250);
    return () => {
      if (clientDebounceRef.current) clearTimeout(clientDebounceRef.current);
    };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Close search on Escape
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSearchOpen(false); setNotifOpen(false); }
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []);

  const q = query.toLowerCase().trim();
  const filteredTools = q ? TOOLS.filter(t => t.label.toLowerCase().includes(q)) : TOOLS;
  // clients are already server-filtered; only shown when a query is active
  const filteredClients = clients;
  const filteredPeople = q
    ? people.filter(m => (m.full_name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q)).slice(0, 6)
    : [];

  function navigate(href: string) {
    setSearchOpen(false);

    // Find the base tab route for this href (e.g. /clients/uuid → /clients)
    const baseRoute = [...ROUTE_TO_TAB.keys()].find(
      route => href === route || href.startsWith(route + '/')
    );

    if (baseRoute) {
      const tab = ROUTE_TO_TAB.get(baseRoute)!;
      openTab(tab);
      if (href === baseRoute) {
        // Exact tool/workspace route — component already mounted in TabPanels
        window.history.replaceState(null, '', href);
      } else {
        // Sub-route (e.g. a specific client page) — needs real navigation
        router.push(href);
      }
    } else {
      router.push(href);
    }
  }

  return (
    <header className="glass-topbar relative h-14 flex items-center px-6 gap-4 shrink-0 z-40">
      {/* Page title — takes the left, pushing search + actions to the right */}
      <h1 className="flex-1 min-w-0 text-base font-semibold text-[var(--text-primary)] tracking-tight truncate">
        {title}
      </h1>

      {/* Search bar */}
      <div className="relative w-80 shrink-0" ref={searchRef}>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
        <input
          ref={searchInputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setSearchOpen(true); setNotifOpen(false); }}
          placeholder="Search clients, documents, tools…"
          className="w-full h-9 pl-9 pr-8 rounded-lg bg-black/[0.04] border border-black/10 text-[var(--text-primary)] placeholder-[var(--text-muted)] text-sm outline-none transition focus:border-[var(--accent)] focus:bg-white"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        )}

        {searchOpen && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+8px)] rounded-xl border border-[var(--border)] bg-white shadow-dropdown overflow-hidden z-[1000]"
          >
            <div className="max-h-80 overflow-y-auto">
                {/* Tools */}
                {filteredTools.length > 0 && (
                  <div>
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Tools</p>
                    {filteredTools.map(t => {
                      const Icon = t.icon;
                      return (
                        <button key={t.href} onClick={() => navigate(t.href)}
                          className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-nav-hover)] transition-colors text-left">
                          <Icon size={14} className="text-[var(--text-muted)] shrink-0" />
                          <span className="text-sm text-[var(--text-primary)]">{t.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Clients — server-searched, only shown when query is active */}
                {q && loadingClients && (
                  <p className="px-3 py-3 text-xs text-[var(--text-muted)]">Searching clients…</p>
                )}
                {q && !loadingClients && filteredClients.length > 0 && (
                  <div>
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Clients</p>
                    {filteredClients.map(c => (
                      <button key={c.id} onClick={() => navigate(`/clients/${c.id}`)}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-nav-hover)] transition-colors text-left">
                        <Users size={14} className="text-[var(--text-muted)] shrink-0" />
                        <div className="min-w-0">
                          <span className="text-sm text-[var(--text-primary)] truncate block">{c.name}</span>
                          {c.client_ref && <span className="text-xs text-[var(--text-muted)] font-mono">{c.client_ref}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Team — team members, filtered client-side */}
                {q && filteredPeople.length > 0 && (
                  <div>
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Team</p>
                    {filteredPeople.map(m => (
                      <button
                        key={m.id}
                        onClick={() => { setSearchOpen(false); openProfile(m.id, m.full_name || m.email.split('@')[0]); }}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-nav-hover)] transition-colors text-left"
                      >
                        <Avatar name={m.full_name || m.email} avatarUrl={m.avatar_url ?? null} size={22} />
                        <div className="min-w-0">
                          <span className="text-sm text-[var(--text-primary)] truncate block">{m.full_name || m.email.split('@')[0]}</span>
                          <span className="text-xs text-[var(--text-muted)] truncate block">{m.email}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No query — hint */}
                {!q && (
                  <p className="px-3 py-3 text-xs text-[var(--text-muted)]">Type to search clients &amp; people…</p>
                )}

                {q && filteredTools.length === 0 && filteredClients.length === 0 && filteredPeople.length === 0 && !loadingClients && (
                  <p className="px-3 py-6 text-sm text-[var(--text-muted)] text-center">No results for &ldquo;{query}&rdquo;</p>
                )}
              </div>
            </div>
          )}
        </div>

      {/* Right actions */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Timesheets quick-timer — start/see timers from anywhere (Practice Suite) */}
        {timesheetsActive && (
          <Tooltip label={
            activeTimer ? `Timer running — ${activeTimer.label || activeTimer.clientName || 'Internal'}${timers.length > 1 ? ` (+${timers.length - 1} paused)` : ''}`
            : timers.length > 0 ? `${timers.length} timer${timers.length > 1 ? 's' : ''} paused — start another`
            : 'Start a timer'
          }>
            <button
              onClick={openStartModal}
              aria-label="Timers"
              className={`relative h-8 flex items-center rounded-lg transition-all ${
                activeTimer
                  ? 'gap-1.5 px-2'
                  : 'w-8 justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
              }`}
              style={activeTimer ? { background: `${activeTimer.color}1A`, color: activeTimer.color } : undefined}
            >
              {activeTimer ? (
                <>
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: activeTimer.color }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: activeTimer.color }} />
                  </span>
                  <span className="font-mono text-[12px] font-bold tabular-nums">{fmtStopwatch(timerElapsedMs(activeTimer, nowMs))}</span>
                </>
              ) : (
                <Clock size={16} />
              )}
              {timers.length > 1 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] flex items-center justify-center rounded-full bg-[var(--accent)] text-white text-[9px] font-bold px-0.5 leading-none">
                  {timers.length}
                </span>
              )}
            </button>
          </Tooltip>
        )}

        {/* Team Messages */}
        <div className="relative">
          <Tooltip label="Team Messages">
            <button
              onClick={() => setIsPanelOpen(!isPanelOpen)}
              aria-label="Team Messages"
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all relative ${
                isPanelOpen
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <MessageSquare size={16} />
              {totalUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5 leading-none">
                  {totalUnread > 9 ? '9+' : totalUnread}
                </span>
              )}
            </button>
          </Tooltip>
          {isPanelOpen && <ChatPanel />}
        </div>

        {/* Focus mode toggle — hides sidebar, top bar, tabs, banners */}
        <Tooltip label="Focus Mode">
          <button
            onClick={toggleFocusMode}
            aria-label="Enter focus mode"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-all"
          >
            <Maximize2 size={16} />
          </button>
        </Tooltip>

        {/* Sticky Notes (personal, private — sit on top of every page) */}
        <StickyNotesHeaderButton />

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <Tooltip label="Notifications">
            <button
              onClick={() => { setNotifOpen(v => !v); setSearchOpen(false); }}
              aria-label="Notifications"
              className={`relative w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
                notifOpen ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Bell size={16} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5 leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </Tooltip>

          {notifOpen && (
            <div
              className="absolute right-0 top-10 w-80 rounded-xl border border-[var(--border)] bg-white shadow-dropdown overflow-hidden z-[1000]"
            >
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Notifications</p>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-xs text-[var(--accent)] hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                  <button onClick={() => setNotifOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Notification list */}
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell size={24} className="text-[var(--text-muted)] mx-auto mb-2 opacity-40" />
                  <p className="text-sm text-[var(--text-muted)]">No notifications</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 opacity-70">You&apos;re all caught up.</p>
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  {notifications.map(n => {
                    const isCalendar = n.type === 'calendar_invite' || n.type === 'calendar_updated' || n.type === 'calendar_deleted';
                    const isClickable = !!notificationTarget(n).route;
                    return (
                      <div
                        key={n.id}
                        onClick={() => {
                          if (!isClickable) return;
                          goToNotification(n);
                          void dismissCtx(n.id);   // dealt with → clear it
                          setNotifOpen(false);
                        }}
                        className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0 group
                          ${!n.read ? 'bg-[var(--accent-light)]' : 'bg-transparent'}
                          ${isClickable ? 'cursor-pointer hover:bg-[var(--bg-nav-hover)]' : ''}`}
                      >
                        {/* Type icon */}
                        <div className="shrink-0 mt-0.5">
                          {isCalendar ? (
                            <CalendarDays size={14} style={{ color: notifDotColor(n.type) }} />
                          ) : (
                            <span
                              className="w-2.5 h-2.5 rounded-full block mt-0.5"
                              style={{ backgroundColor: notifDotColor(n.type) }}
                            />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-snug ${!n.read ? 'font-semibold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{n.body}</p>
                          )}
                          <p className="text-[10px] text-[var(--text-muted)] mt-1 opacity-70">
                            {formatRelativeTime(n.created_at)}
                          </p>
                        </div>

                        {/* Dismiss button */}
                        <Tooltip label="Dismiss" side="left" className="shrink-0">
                          <button
                            onClick={e => handleDismiss(n.id, e)}
                            aria-label="Dismiss"
                            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X size={12} />
                          </button>
                        </Tooltip>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ml-1">
          <Avatar name={userName} avatarUrl={avatarUrl} size={32} />
        </div>
      </div>

    </header>
  );
}
