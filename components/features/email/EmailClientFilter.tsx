'use client';

/**
 * EmailClientFilter — the "All clients" pill in the filter bar. A body-portalled
 * dropdown (so it escapes the bar's overflow) with server-side client search
 * (/api/clients?search=). Kept local to the filter bar rather than reusing the
 * shared ClientSearchInput, whose absolute dropdown gets clipped here.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Users, ChevronDown, X, Search, Loader2 } from 'lucide-react';
import { usePortalMenu } from './usePortalMenu';

interface ClientOpt { id: string; name: string; client_ref?: string | null; }

interface Props {
  clientId: string;
  clientName: string;
  onChange: (id: string, name: string) => void;
}

export default function EmailClientFilter({ clientId, clientName, onChange }: Props) {
  const menu = usePortalMenu(260, 'left');
  const [search, setSearch] = useState('');
  const [opts, setOpts] = useState<ClientOpt[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!menu.open) return;
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients?search=${encodeURIComponent(search)}`);
        const data = await res.json() as { clients?: ClientOpt[] };
        if (active) setOpts((data.clients ?? []).slice(0, 50));
      } catch {
        if (active) setOpts([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [search, menu.open]);

  const pill = 'shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors max-w-[180px]';
  const idle = 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]';
  const on = 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]';

  return (
    <>
      <button ref={menu.triggerRef} onClick={menu.toggle} className={`${pill} ${clientId ? on : idle}`}>
        <Users size={13} className="shrink-0" />
        <span className="truncate">{clientId ? clientName : 'All clients'}</span>
        {clientId
          ? <X size={12} className="shrink-0" onClick={e => { e.stopPropagation(); onChange('', ''); }} />
          : <ChevronDown size={12} className="shrink-0" />}
      </button>
      {menu.open && menu.pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => menu.setOpen(false)} />
          <div
            style={{ position: 'fixed', top: menu.pos.top, left: menu.pos.left, width: menu.width }}
            className="z-[61] bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden"
          >
            <div className="p-2 border-b border-[var(--border)]">
              <div className="flex items-center gap-2 px-2 py-1 border border-[var(--border)] rounded-lg bg-[var(--bg-nav-hover)]">
                <Search size={13} className="text-[var(--text-muted)] shrink-0" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search clients…"
                  className="flex-1 text-xs bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] min-w-0"
                />
                {loading && <Loader2 size={13} className="text-[var(--text-muted)] animate-spin shrink-0" />}
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto scrollbar-thin py-1">
              <button onClick={() => { onChange('', ''); menu.setOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]">All clients</button>
              {!loading && opts.length === 0 && <p className="px-3 py-3 text-xs text-center text-[var(--text-muted)]">No clients found.</p>}
              {opts.map(c => (
                <button
                  key={c.id}
                  onClick={() => { onChange(c.id, c.name); menu.setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-[var(--bg-nav-hover)] ${clientId === c.id ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-primary)]'}`}
                >
                  <span className="truncate flex-1">{c.name}</span>
                  {c.client_ref && <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">{c.client_ref}</span>}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
