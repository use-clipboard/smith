'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check, Building2 } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';

interface Props {
  value: string | null;
  onChange: (clientId: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  placeholder?: string;
}

/**
 * Searchable client picker over the provider's client list — replaces a plain
 * <select> so firms with hundreds of clients can type-to-find. Filters
 * client-side by name or reference.
 */
export default function ClientCombobox({
  value, onChange, allowNone = false, noneLabel = 'Internal / none', placeholder = 'Select client…',
}: Props) {
  const { clients } = useTimesheets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = clients.find(c => c.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? clients.filter(c => c.name.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q))
      : clients;
    return list.slice(0, 60);
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    // Focus the search box when the panel opens.
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => { document.removeEventListener('mousedown', onDoc); window.clearTimeout(t); };
  }, [open]);

  const pick = (id: string | null) => { onChange(id); setOpen(false); setQuery(''); };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="input-base flex items-center justify-between gap-2 text-left"
      >
        <span className={`truncate ${selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
          {selected ? selected.name : (value === null && allowNone ? noneLabel : placeholder)}
        </span>
        <ChevronDown size={15} className="shrink-0 text-[var(--text-muted)]" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-[0_12px_40px_rgba(31,38,88,0.18)]">
          <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2">
            <Search size={14} className="text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search clients…"
              className="w-full bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div className="max-h-60 overflow-y-auto scrollbar-thin py-1">
            {allowNone && (
              <button type="button" onClick={() => pick(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] hover:bg-black/[0.04]">
                <Building2 size={14} className="text-[var(--text-muted)]" /> {noneLabel}
                {value === null && <Check size={14} className="ml-auto text-[var(--accent)]" />}
              </button>
            )}
            {filtered.map(c => (
              <button key={c.id} type="button" onClick={() => pick(c.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-black/[0.04]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{c.name}</p>
                  {c.ref && <p className="truncate text-[10.5px] text-[var(--text-muted)]">{c.ref}</p>}
                </div>
                {value === c.id && <Check size={14} className="ml-auto shrink-0 text-[var(--accent)]" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">No clients match “{query}”.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
