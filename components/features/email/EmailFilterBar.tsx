'use client';

/**
 * EmailFilterBar — the filter row above the thread list (clients / senders /
 * time). The client filter is server-side (refetches via ?clientId=); sender
 * and time filter the already-loaded list client-side. The sender + time menus
 * are body-portalled so they aren't clipped by the bar's overflow.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Mail, CalendarClock, X, Search } from 'lucide-react';
import EmailClientFilter from './EmailClientFilter';
import { usePortalMenu } from './usePortalMenu';

export type TimeFilter = 'all' | 'today' | '7d' | '30d';
const TIME_OPTS: { value: TimeFilter; label: string }[] = [
  { value: 'all',   label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7d',    label: 'Last 7 days' },
  { value: '30d',   label: 'Last 30 days' },
];

export interface Sender { email: string; name: string; }

interface Props {
  clientId: string;
  clientName: string;
  onClientChange: (id: string, name: string) => void;
  senders: Sender[];
  senderFilter: string | null;
  onSenderChange: (email: string | null) => void;
  timeFilter: TimeFilter;
  onTimeChange: (t: TimeFilter) => void;
}

const MENU = 'z-[61] max-h-72 overflow-y-auto scrollbar-thin bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl py-1';

export default function EmailFilterBar({
  clientId, clientName, onClientChange, senders, senderFilter, onSenderChange, timeFilter, onTimeChange,
}: Props) {
  const senderMenu = usePortalMenu(240);
  const timeMenu = usePortalMenu(160);
  const [senderSearch, setSenderSearch] = useState('');

  const activeSender = senders.find(s => s.email === senderFilter);
  const sq = senderSearch.trim().toLowerCase();
  const filteredSenders = sq
    ? senders.filter(s => (s.name || '').toLowerCase().includes(sq) || s.email.toLowerCase().includes(sq))
    : senders;
  const closeSenderMenu = () => { senderMenu.setOpen(false); setSenderSearch(''); };
  const timeLabel = TIME_OPTS.find(t => t.value === timeFilter)?.label ?? 'All time';

  const pill = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors max-w-[180px]';
  const idle = 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
  const on = 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]';

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Clients (server-side) */}
      <EmailClientFilter clientId={clientId} clientName={clientName} onChange={onClientChange} />

      {/* Senders (client-side) */}
      <button ref={senderMenu.triggerRef} onClick={senderMenu.toggle} className={`shrink-0 ${pill} ${senderFilter ? on : idle}`}>
        <Mail size={13} className="shrink-0" />
        <span className="truncate">{activeSender ? (activeSender.name || activeSender.email) : 'All senders'}</span>
        {senderFilter
          ? <X size={12} className="shrink-0" onClick={e => { e.stopPropagation(); onSenderChange(null); }} />
          : <ChevronDown size={12} className="shrink-0" />}
      </button>
      {senderMenu.open && senderMenu.pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={closeSenderMenu} />
          <div
            style={{ position: 'fixed', top: senderMenu.pos.top, left: senderMenu.pos.left, width: senderMenu.width }}
            className="z-[61] bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden"
          >
            <div className="p-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 px-2 py-1 border border-[var(--border)] rounded-lg bg-[var(--bg-nav-hover)]">
                <Search size={13} className="text-[var(--text-muted)] shrink-0" />
                <input
                  autoFocus
                  value={senderSearch}
                  onChange={e => setSenderSearch(e.target.value)}
                  placeholder="Search senders…"
                  className="flex-1 text-xs bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] min-w-0"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto scrollbar-thin py-1">
              <button onClick={() => { onSenderChange(null); closeSenderMenu(); }} className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]">All senders</button>
              {filteredSenders.length === 0 && <p className="px-3 py-2 text-xs text-[var(--text-muted)]">{senders.length === 0 ? 'No senders in view.' : 'No matches.'}</p>}
              {filteredSenders.map(s => (
                <button
                  key={s.email}
                  onClick={() => { onSenderChange(s.email); closeSenderMenu(); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-nav-hover)] ${senderFilter === s.email ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
                >
                  <span className="block truncate">{s.name || s.email}</span>
                  {s.name && <span className="block truncate text-[10px] text-[var(--text-muted)]">{s.email}</span>}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* Time (client-side) */}
      <button ref={timeMenu.triggerRef} onClick={timeMenu.toggle} className={`shrink-0 ${pill} ${timeFilter !== 'all' ? on : idle}`}>
        <CalendarClock size={13} className="shrink-0" />
        <span className="truncate">{timeLabel}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {timeMenu.open && timeMenu.pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => timeMenu.setOpen(false)} />
          <div style={{ position: 'fixed', top: timeMenu.pos.top, left: timeMenu.pos.left, width: timeMenu.width }} className={MENU}>
            {TIME_OPTS.map(t => (
              <button
                key={t.value}
                onClick={() => { onTimeChange(t.value); timeMenu.setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-nav-hover)] ${timeFilter === t.value ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
