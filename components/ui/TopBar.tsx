'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search, Bell, MessageSquare, X, FileSearch, ArrowLeftRight, Building2,
  ClipboardCheck, TrendingUp, Receipt, ShieldAlert, FileText, Users, CalendarDays, MicVocal, UserPlus,
} from 'lucide-react';
import Avatar from './Avatar';
import { useChatContext } from '@/components/chat/ChatProvider';
import ChatPanel from '@/components/chat/ChatPanel';
import { useTabContext } from '@/components/ui/TabContext';
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
  '/full-analysis':   'Full Transaction Analysis',
  '/bank-to-csv':     'Bank to CSV',
  '/landlord':        'Landlord Analysis',
  '/final-accounts':  'Accounts Review',
  '/performance':     'Performance Analysis',
  '/p32':             'P32 Summary',
  '/risk-assessment': 'Risk Assessment',
  '/summarise':       'Summarise Documents',
  '/ch-secretarial':  'CH Secretarial',
  '/calendar':        'Calendar',
  '/meeting-notes':   'Meeting Notes',
  '/staff-hire':      'Staff Hire',
  '/policies':        'Policies & Procedures',
  '/clients':         'Clients',
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
  { label: 'Landlord Analysis',    href: '/landlord',        icon: Building2 },
  { label: 'Accounts Review',      href: '/final-accounts',  icon: ClipboardCheck },
  { label: 'Performance Analysis', href: '/performance',     icon: TrendingUp },
  { label: 'P32 Summary',          href: '/p32',             icon: Receipt },
  { label: 'Risk Assessment',      href: '/risk-assessment', icon: ShieldAlert },
  { label: 'Summarise',            href: '/summarise',       icon: FileText },
  { label: 'CH Secretarial',       href: '/ch-secretarial',  icon: Building2 },
  { label: 'Calendar',             href: '/calendar',        icon: CalendarDays },
  { label: 'Meeting Notes',        href: '/meeting-notes',   icon: MicVocal },
  { label: 'Staff Hire',           href: '/staff-hire',      icon: UserPlus },
  { label: 'Clients',              href: '/clients',         icon: Users },
];

interface ClientResult {
  id: string;
  name: string;
  client_ref: string | null;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
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
  if (type === 'calendar_invite') return '#10b981';   // emerald
  if (type === 'calendar_updated') return '#3b82f6';  // blue
  if (type === 'calendar_deleted') return '#ef4444';  // red
  return '#9ca3af';                                   // grey
}

export default function TopBar({ userName, avatarUrl }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = getPageTitle(pathname);
  const { totalUnread, isPanelOpen, setIsPanelOpen } = useChatContext();
  const { openTab } = useTabContext();

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<ClientResult[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const clientDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const notifIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silently ignore — notifications are non-critical
    }
  }, []);

  // Fetch on mount and poll every 30 seconds
  useEffect(() => {
    fetchNotifications();
    notifIntervalRef.current = setInterval(fetchNotifications, 30000);
    return () => {
      if (notifIntervalRef.current) clearInterval(notifIntervalRef.current);
    };
  }, [fetchNotifications]);

  async function handleMarkAllRead() {
    try {
      await fetch('/api/notifications', { method: 'PATCH' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }

  async function handleDismiss(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setNotifications(prev => {
        const updated = prev.filter(n => n.id !== id);
        setUnreadCount(updated.filter(n => !n.read).length);
        return updated;
      });
    } catch {
      // ignore
    }
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
    <header className="glass-topbar h-14 flex items-center px-6 gap-4 shrink-0 z-30">
      {/* Page title */}
      <h1 className="flex-1 text-base font-semibold text-[var(--text-primary)] tracking-tight truncate">
        {title}
      </h1>

      {/* Right actions */}
      <div className="flex items-center gap-2">

        {/* Search */}
        <div className="relative" ref={searchRef}>
          <button
            onClick={() => { setSearchOpen(v => !v); setNotifOpen(false); }}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              searchOpen ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
            }`}
            title="Search"
          >
            <Search size={16} />
          </button>

          {searchOpen && (
            <div className="absolute right-0 top-10 w-80 glass-solid rounded-xl border border-[var(--border)] shadow-xl overflow-hidden z-50">
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border)]">
                <Search size={14} className="text-[var(--text-muted)] shrink-0" />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search tools, clients…"
                  className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={13} />
                  </button>
                )}
              </div>

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
                          <Icon size={14} className="text-[var(--accent)] shrink-0" />
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

                {/* No query — hint */}
                {!q && (
                  <p className="px-3 py-3 text-xs text-[var(--text-muted)]">Type to search clients…</p>
                )}

                {q && filteredTools.length === 0 && filteredClients.length === 0 && !loadingClients && (
                  <p className="px-3 py-6 text-sm text-[var(--text-muted)] text-center">No results for &ldquo;{query}&rdquo;</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Team Messages */}
        <div className="relative">
          <button
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all relative ${
              isPanelOpen
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
            }`}
            title="Team Messages"
          >
            <MessageSquare size={16} />
            {totalUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5 leading-none">
                {totalUnread > 9 ? '9+' : totalUnread}
              </span>
            )}
          </button>
          {isPanelOpen && <ChatPanel />}
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setNotifOpen(v => !v); setSearchOpen(false); }}
            className={`relative w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              notifOpen ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
            }`}
            title="Notifications"
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5 leading-none">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-10 w-80 glass-solid rounded-xl border border-[var(--border)] shadow-xl overflow-hidden z-50">
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
                    return (
                      <div
                        key={n.id}
                        className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0 group
                          ${!n.read ? 'bg-[var(--accent-light)]' : 'bg-transparent'}`}
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
                        <button
                          onClick={e => handleDismiss(n.id, e)}
                          className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Dismiss"
                        >
                          <X size={12} />
                        </button>
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
