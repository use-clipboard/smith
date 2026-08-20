'use client';

/**
 * ClientSearchInput
 *
 * Reusable client picker for the tasks tool (and anywhere that needs standard
 * Tailwind styling rather than the CSS-var-based ClientSelector used in
 * Meeting Notes).
 *
 * ── HOW IT WORKS ────────────────────────────────────────────────────────────
 * NEVER pass a pre-loaded list of all clients as a prop. Instead this
 * component calls /api/clients?search={q} directly every time the user types,
 * with a 200 ms debounce. This sidesteps the Supabase PostgREST default page
 * cap that truncates large client lists when loaded in bulk by a parent.
 *
 * The same pattern is used by ClientSelector.tsx (Meeting Notes tool) and is
 * the canonical approach across SMITH.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Search, X, Loader2 } from 'lucide-react';

interface ClientOption {
  id: string;
  name: string;
  client_ref: string;
  status?: string | null;
  business_type?: string | null;
}

interface Props {
  /** Currently selected client ID */
  value: string;
  /** Display name for the currently selected client (avoids a refetch) */
  valueName?: string;
  /** Called with (id, name, clientRef, businessType) when a client is selected, or ('', '', '', null) to clear */
  onChange: (id: string, name: string, clientRef: string, businessType?: string | null) => void;
  placeholder?: string;
  /** Extra classes applied to the root element */
  className?: string;
  disabled?: boolean;
  /** Restrict results to these business types (e.g. ['individual','sole_trader']). */
  businessTypes?: string[];
}

const STATUS_COLOURS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  hold:     'bg-amber-100 text-amber-700',
  inactive: 'bg-gray-100 text-gray-500',
};

export default function ClientSearchInput({
  value,
  valueName,
  onChange,
  placeholder = 'Select client…',
  className = '',
  disabled = false,
  businessTypes,
}: Props) {
  const [open, setOpen]       = useState(false);
  const [search, setSearch]   = useState('');
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // ── API fetch (debounced) ──────────────────────────────────────────────────
  const typesParam = businessTypes && businessTypes.length ? `&types=${encodeURIComponent(businessTypes.join(','))}` : '';
  const fetchOptions = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}${typesParam}`);
      if (r.ok) {
        const d = await r.json();
        setOptions(d.clients ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [typesParam]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void fetchOptions(search), 200);
    return () => clearTimeout(timer);
  }, [open, search, fetchOptions]);

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleOpen() {
    if (disabled) return;
    setSearch('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleSelect(c: ClientOption) {
    onChange(c.id, c.name, c.client_ref, c.business_type ?? null);
    setOpen(false);
    setSearch('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('', '', '', null);
  }

  const displayName = value
    ? (valueName || options.find(o => o.id === value)?.name || '…')
    : '';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* ── Trigger ─────────────────────────────────────────────────────────── */}
      <div
        onClick={handleOpen}
        className={`w-full flex items-center gap-2 text-sm border rounded-lg px-2.5 py-1.5 bg-white transition-colors cursor-pointer ${
          disabled
            ? 'border-gray-100 cursor-not-allowed opacity-50'
            : 'border-gray-200 hover:border-indigo-400'
        }`}
      >
        <span className={`flex-1 truncate ${value ? 'text-gray-900' : 'text-gray-400'}`}>
          {value ? displayName : placeholder}
        </span>
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="text-gray-300 hover:text-gray-500 flex-shrink-0 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
        )}
      </div>

      {/* ── Dropdown ────────────────────────────────────────────────────────── */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden min-w-[220px]">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="flex items-center gap-2 px-2 py-1 border border-gray-200 rounded-lg bg-gray-50">
              <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients…"
                className="flex-1 text-sm bg-transparent outline-none text-gray-800 placeholder-gray-400 min-w-0"
              />
              {loading && <Loader2 className="h-3.5 w-3.5 text-gray-400 animate-spin flex-shrink-0" />}
            </div>
          </div>

          {/* Results */}
          <div className="max-h-56 overflow-y-auto">
            {!loading && options.length === 0 ? (
              <p className="text-xs text-center text-gray-400 py-5">
                {search ? 'No clients found' : 'Loading…'}
              </p>
            ) : (
              options.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors flex items-center gap-2"
                >
                  <span className="flex-1 font-medium text-gray-900 truncate">{c.name}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0 font-mono">{c.client_ref}</span>
                  {c.status && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLOURS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {c.status}
                    </span>
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
