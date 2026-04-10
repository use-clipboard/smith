'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Search, Bell, MessageSquare, X, FileSearch, ArrowLeftRight, Building2, ClipboardCheck, TrendingUp, Receipt, ShieldAlert, FileText, Users } from 'lucide-react';
import Avatar from './Avatar';
import { useChatContext } from '@/components/chat/ChatProvider';
import ChatPanel from '@/components/chat/ChatPanel';

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
  { label: 'Clients',              href: '/clients',         icon: Users },
];

interface ClientResult {
  id: string;
  name: string;
  client_ref: string | null;
}

export default function TopBar({ userName, avatarUrl }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const title = getPageTitle(pathname);
  const { totalUnread, isPanelOpen, setIsPanelOpen } = useChatContext();

  // Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<ClientResult[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Notifications
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Open search
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
      // Pre-load clients
      setLoadingClients(true);
      fetch('/api/clients?status=active')
        .then(r => r.json())
        .then(d => setClients(d.clients ?? []))
        .catch(() => {})
        .finally(() => setLoadingClients(false));
    } else {
      setQuery('');
    }
  }, [searchOpen]);

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
  const filteredClients = q
    ? clients.filter(c => c.name.toLowerCase().includes(q) || (c.client_ref ?? '').toLowerCase().includes(q))
    : clients.slice(0, 5);

  function navigate(href: string) {
    setSearchOpen(false);
    router.push(href);
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

                {/* Clients */}
                {!loadingClients && filteredClients.length > 0 && (
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
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${
              notifOpen ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
            }`}
            title="Notifications"
          >
            <Bell size={16} />
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-10 w-72 glass-solid rounded-xl border border-[var(--border)] shadow-xl overflow-hidden z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-semibold text-[var(--text-primary)]">Notifications</p>
                <button onClick={() => setNotifOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={14} />
                </button>
              </div>
              <div className="px-4 py-8 text-center">
                <Bell size={24} className="text-[var(--text-muted)] mx-auto mb-2 opacity-40" />
                <p className="text-sm text-[var(--text-muted)]">No notifications</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 opacity-70">You&apos;re all caught up.</p>
              </div>
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
