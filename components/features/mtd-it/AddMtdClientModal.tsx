'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Loader2, Check } from 'lucide-react';

interface ClientOption {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  mtd_it?: boolean | null;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export default function AddMtdClientModal({ onClose, onAdded }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchClients = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients?search=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Failed to load clients');
      const data = await res.json();
      setResults((data.clients ?? []) as ClientOption[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void fetchClients(search), 200);
    return () => clearTimeout(t);
  }, [search, fetchClients]);

  async function add(clientId: string) {
    setAdding(clientId);
    setError(null);
    try {
      const res = await fetch('/api/mtd-it/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to add client');
      }
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add client');
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Add MTD IT client</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients by name or code…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </div>
        </div>

        {error && (
          <div className="px-5 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : results.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-500">No clients found.</div>
          ) : (
            <ul>
              {results.map(c => (
                <li key={c.id} className="flex items-center justify-between px-5 py-2.5 border-b border-gray-50 hover:bg-gray-50/70">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900 truncate">{c.name}</div>
                    <div className="text-xs text-gray-500 font-mono">{c.client_ref ?? '—'}</div>
                  </div>
                  {c.mtd_it ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-1 rounded-full">
                      <Check size={12} /> On list
                    </span>
                  ) : (
                    <button
                      disabled={adding === c.id}
                      onClick={() => add(c.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-60 flex items-center gap-1"
                    >
                      {adding === c.id ? <Loader2 size={12} className="animate-spin" /> : null}
                      Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
