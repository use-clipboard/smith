'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { User, X, ChevronDown, Search } from 'lucide-react';

export interface SelectedClient {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  vat_number: string | null;
}

interface ClientSelectorProps {
  value: SelectedClient | null;
  onSelect: (client: SelectedClient | null) => void;
}

interface ClientRow {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  vat_number: string | null;
}

export default function ClientSelector({ value, onSelect }: ClientSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchClients = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void fetchClients(search), 200);
    return () => clearTimeout(timer);
  }, [open, search, fetchClients]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleOpen() {
    setSearch('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleSelect(c: ClientRow) {
    onSelect({ id: c.id, name: c.name, client_ref: c.client_ref, business_type: c.business_type, vat_number: c.vat_number });
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onSelect(null);
  }

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-light)] border border-[var(--accent)] border-opacity-40 rounded-lg text-sm">
          <User size={14} className="text-[var(--accent)] shrink-0" />
          <span className="text-[var(--accent)] font-medium">{value.name}</span>
          {value.client_ref && (
            <span className="text-[var(--accent)] opacity-70 font-mono text-xs">({value.client_ref})</span>
          )}
          <button
            type="button"
            onClick={handleClear}
            className="ml-1 text-[var(--accent)] opacity-60 hover:opacity-100 transition-opacity"
            title="Clear client"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-2 px-3 py-2 border border-[var(--border-input)] rounded-lg text-sm text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] bg-[var(--bg-input)] transition-all"
        >
          <User size={14} className="text-[var(--text-muted)]" />
          Link to client
          <ChevronDown size={12} className="ml-auto text-[var(--text-muted)]" />
        </button>
      )}

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 glass-solid rounded-xl border border-[var(--border)] shadow-dropdown overflow-hidden animate-slide-up">
          <div className="p-2 border-b border-[var(--border)]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--bg-input)] rounded-lg border border-[var(--border-input)]">
              <Search size={13} className="text-[var(--text-muted)] shrink-0" />
              <input
                ref={inputRef}
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients…"
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto scrollbar-thin">
            {loading ? (
              <p className="text-center text-xs text-[var(--text-muted)] py-4">Loading…</p>
            ) : clients.length === 0 ? (
              <p className="text-center text-xs text-[var(--text-muted)] py-4">No clients found</p>
            ) : (
              clients.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="w-full text-left px-3 py-2.5 hover:bg-[var(--bg-nav-hover)] transition-colors flex items-center justify-between gap-2"
                >
                  <span className="text-sm text-[var(--text-primary)]">{c.name}</span>
                  {c.client_ref && (
                    <span className="text-xs text-[var(--text-muted)] font-mono shrink-0">{c.client_ref}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
