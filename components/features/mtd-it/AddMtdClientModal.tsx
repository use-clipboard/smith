'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Search, Loader2, Check } from 'lucide-react';

type Status = 'active' | 'hold' | 'inactive';

interface ClientOption {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  status: Status | null;
  mtd_it?: boolean | null;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

const STATUS_STYLES: Record<Status, { pill: string; label: string; dot: string }> = {
  active:   { pill: 'bg-green-100 text-green-700', label: 'Active',   dot: 'bg-green-500' },
  hold:     { pill: 'bg-amber-100 text-amber-700', label: 'On Hold',  dot: 'bg-amber-500' },
  inactive: { pill: 'bg-gray-100 text-gray-500',   label: 'Inactive', dot: 'bg-gray-400'  },
};

// Match the values used by /api/clients (clients table business_type column)
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'individual',       label: 'Individual'       },
  { value: 'sole_trader',      label: 'Sole Trader'      },
  { value: 'rental_landlord',  label: 'Rental Landlord'  },
  { value: 'partnership',      label: 'Partnership'      },
  { value: 'limited_company',  label: 'Limited Company'  },
  { value: 'llp',              label: 'LLP'              },
  { value: 'trust',            label: 'Trust'            },
  { value: 'charity',          label: 'Charity'          },
];

function typeLabel(value: string | null): string {
  if (!value) return '';
  return TYPE_OPTIONS.find(o => o.value === value)?.label ?? value;
}

export default function AddMtdClientModal({ onClose, onAdded }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [typeFilter,   setTypeFilter]   = useState<string>('all');
  const [results, setResults] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchClients = useCallback(async (q: string, status: string, type: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q)                 params.set('search', q);
      if (status !== 'all')  params.set('status', status);
      if (type   !== 'all')  params.set('type',   type);
      const res = await fetch(`/api/clients?${params.toString()}`);
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
    const t = setTimeout(() => void fetchClients(search, statusFilter, typeFilter), 200);
    return () => clearTimeout(t);
  }, [search, statusFilter, typeFilter, fetchClients]);

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

        <div className="px-5 py-3 border-b border-gray-100 space-y-2">
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
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
            >
              <option value="all">All types</option>
              {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as 'all' | Status)}
              className="flex-1 px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="hold">On Hold</option>
              <option value="inactive">Inactive</option>
            </select>
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
              {results.map(c => {
                const s = c.status ? STATUS_STYLES[c.status] : null;
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-gray-50 hover:bg-gray-50/70">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-900 truncate">{c.name}</span>
                        {s && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${s.pill}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                            {s.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-mono">{c.client_ref ?? '—'}</span>
                        {c.business_type && (
                          <>
                            <span className="text-gray-300">·</span>
                            <span>{typeLabel(c.business_type)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {c.mtd_it ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-1 rounded-full shrink-0">
                        <Check size={12} /> On list
                      </span>
                    ) : (
                      <button
                        disabled={adding === c.id}
                        onClick={() => add(c.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-60 flex items-center gap-1 shrink-0"
                      >
                        {adding === c.id ? <Loader2 size={12} className="animate-spin" /> : null}
                        Add
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
