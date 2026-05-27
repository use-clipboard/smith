'use client';

/**
 * AccountPicker — type-to-filter dropdown for a book's COA.
 *
 * Behaviour (modelled on VT's Set Analysis Account dialog):
 *   - Type to filter. Match is case-insensitive substring on either the
 *     account name OR the "Ledger: Account" combined display.
 *   - Arrow keys navigate the suggestion list. Enter picks. Esc closes.
 *   - Accounts are grouped by ledger in the dropdown.
 *   - Optional `ledgerFilter` restricts the list to a single ledger.
 *   - "Set up a new account" inline form (Phase 2B-B): adds a new account
 *     to the book and selects it on save.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, Plus, Search, X } from 'lucide-react';
import type { BookAccountRef } from '@/types/bookkeeping';

// Fallback ledger → account_type mapping used when the picker needs to
// create a new account in an empty ledger (e.g. the first customer of a
// brand-new book). Mirrors the LTD seed in config/bookkeeping/coa-defaults.
const LEDGER_DEFAULT_TYPE: Record<string, 'asset' | 'liability' | 'equity' | 'income' | 'expense'> = {
  Income: 'income',
  'Cost of sales': 'expense',
  Expenses: 'expense',
  Taxation: 'expense',
  'FA - intangible': 'asset',
  'FA - land and buildings': 'asset',
  'FA - plant and machinery': 'asset',
  'FA - equipment, fixtures & fittings': 'asset',
  'FA - vehicles': 'asset',
  'Investments - fixed': 'asset',
  'Investments - current': 'asset',
  Stocks: 'asset',
  Customers: 'asset',
  Debtors: 'asset',
  Bank: 'asset',
  Suppliers: 'liability',
  Creditors: 'liability',
  'Deferred tax': 'liability',
  'Share capital': 'equity',
  'Share premium': 'equity',
  'Revaluation reserve': 'equity',
  'Profit and loss account': 'equity',
};

interface Props {
  bookId: string;
  value: string | null;          // selected account_id
  valueDisplay?: string;         // "Ledger: Account" — to render the chosen pill without refetching
  onChange: (account: BookAccountRef | null) => void;
  /** Restrict to a single ledger (e.g. 'Bank'). */
  ledgerFilter?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Auto-focus on mount — useful in the grid when the cursor lands here. */
  autoFocus?: boolean;
  className?: string;
}

function ledgerSort(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

export default function AccountPicker({
  bookId, value, valueDisplay, onChange, ledgerFilter,
  placeholder = 'Type to choose account…', disabled, autoFocus, className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [accounts, setAccounts] = useState<BookAccountRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // ── Inline new-account state ──────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLedger, setCreateLedger] = useState(ledgerFilter ?? '');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Portal anchor — populated client-side only so SSR doesn't try to render.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // Dropdown position computed from the input's bounding rect. We recompute
  // on open, on scroll, and on resize so it tracks correctly even inside
  // overflow-clipped table cells.
  const [pos, setPos] = useState<{ top: number; left: number; width: number; placement: 'below' | 'above' } | null>(null);
  const updatePosition = useCallback(() => {
    const anchor = containerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const dropdownMaxHeight = 288;     // tailwind max-h-72
    const margin = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Flip up only when there genuinely isn't room below AND there's more above.
    const placement: 'below' | 'above' =
      spaceBelow < dropdownMaxHeight + margin && spaceAbove > spaceBelow ? 'above' : 'below';
    const top = placement === 'below'
      ? rect.bottom + margin
      : rect.top - margin - Math.min(dropdownMaxHeight, spaceAbove);
    setPos({
      top,
      left: rect.left,
      width: Math.max(rect.width, 280),
      placement,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  // ── Load accounts on open (and when ledgerFilter changes) ─────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (ledgerFilter) params.set('ledger', ledgerFilter);
    // Hide accounts marked inactive — they're locked for new entries.
    params.set('pickable_only', 'true');
    fetch(`/api/bookkeeping/books/${bookId}/accounts?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => {
        if (cancelled) return;
        setAccounts((d.accounts ?? []) as BookAccountRef[]);
      })
      .catch(() => { if (!cancelled) setAccounts([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, bookId, ledgerFilter]);

  // ── Filter + group ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(a => {
      const combined = `${a.ledger ?? ''} ${a.name}`.toLowerCase();
      return combined.includes(q);
    });
  }, [accounts, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, BookAccountRef[]>();
    for (const a of filtered) {
      const key = a.ledger ?? '— Ungrouped';
      const arr = m.get(key) ?? [];
      arr.push(a);
      m.set(key, arr);
    }
    return [...m.entries()].sort((a, b) => ledgerSort(a[0], b[0]));
  }, [filtered]);

  // Flat list for keyboard navigation (mirrors the visual ordering).
  const flat = useMemo(() => grouped.flatMap(([, arr]) => arr), [grouped]);

  // ── Close on outside click ─────────────────────────────────────────────────
  // The dropdown lives in a portal under document.body, so the "inside" test
  // is two-way: the anchor OR the portaled dropdown.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideAnchor = containerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideAnchor && !insideDropdown) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Pull focus into the input on the render after a button→input transition,
  // so tabbing into a Picker-with-a-value lands the cursor in the typeahead
  // (otherwise focus is lost when the button unmounts mid-state-change).
  useEffect(() => {
    if (open && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // ── Autofocus / open on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      setOpen(true);
    }
  }, [autoFocus]);

  // ── Keep highlighted item in view ──────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-i="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const handlePick = useCallback((a: BookAccountRef) => {
    onChange(a);
    setQuery('');
    setOpen(false);
    // Intentionally NOT blurring — see VatTreatmentPicker for the rationale
    // (blur sends focus to <body> and the modal's focus trap then yanks it
    // to the first focusable, instead of letting Tab advance naturally).
  }, [onChange]);

  // ── Open / cancel the inline create form ──────────────────────────────────
  function openCreate() {
    setCreating(true);
    setCreateName(query.trim());
    setCreateLedger(ledgerFilter ?? '');
    setCreateError('');
    setTimeout(() => createNameRef.current?.focus(), 0);
  }
  function cancelCreate() {
    setCreating(false);
    setCreateError('');
    setCreateName('');
  }

  // Determine the account_type to use when creating. Prefer the type of any
  // existing account in that ledger (so admin-customised types stick); fall
  // back to the static map; final fallback 'asset'.
  function resolveAccountType(ledger: string): 'asset' | 'liability' | 'equity' | 'income' | 'expense' {
    const existing = accounts.find(a => a.ledger === ledger);
    if (existing) return existing.account_type;
    return LEDGER_DEFAULT_TYPE[ledger] ?? 'asset';
  }

  async function handleCreate() {
    const name = createName.trim();
    const ledger = (ledgerFilter ?? createLedger).trim();
    if (!name) { setCreateError('Name is required.'); return; }
    if (!ledger) { setCreateError('Pick a ledger.'); return; }

    setCreateSubmitting(true);
    setCreateError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ledger,
          account_type: resolveAccountType(ledger),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? 'Could not create account');
      }
      const { account } = await r.json();
      // Insert into the local list + select it.
      setAccounts(prev => [...prev, account as BookAccountRef]);
      setCreating(false);
      setCreateName('');
      handlePick(account as BookAccountRef);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Could not create account');
    } finally {
      setCreateSubmitting(false);
    }
  }

  // Ledgers available to pick from when no filter is set. Derived from the
  // statically-known list so the user can pick even for empty ledgers.
  const ALL_LEDGERS = useMemo(() => Object.keys(LEDGER_DEFAULT_TYPE).sort((a, b) => a.localeCompare(b)), []);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && flat[highlight]) {
        e.preventDefault();
        handlePick(flat[highlight]);
      }
    } else if (e.key === 'Tab') {
      // Commit but DEFER the close so the input stays mounted long enough
      // for Tab's default focus-advance. Closing synchronously would unmount
      // the input mid-event, dropping focus to <body>; the browser then
      // walks the whole document from the top and lands on the SMITH logo.
      if (open && flat[highlight]) {
        onChange(flat[highlight]);
        setQuery('');
        setTimeout(() => setOpen(false), 0);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }, [open, flat, highlight, handlePick, query]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const hasValue = Boolean(value && !open);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {hasValue ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0); }}
          onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); setTimeout(() => inputRef.current?.focus(), 0); }}
          onKeyDown={e => {
            // Typeahead-from-button — see LedgerPicker for rationale.
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              setQuery(e.key);
              setHighlight(0);
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault();
              setQuery('');
              setOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
          disabled={disabled}
          className="w-full text-left text-sm px-2.5 py-1.5 rounded border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="truncate text-gray-900">{valueDisplay ?? '—'}</span>
          <ChevronDown size={12} className="text-gray-400 shrink-0 ml-1" />
        </button>
      ) : (
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={placeholder}
            disabled={disabled}
            onChange={e => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKey}
            className="w-full text-sm pl-7 pr-7 py-1.5 rounded border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
          />
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>
      )}

      {open && portalReady && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 288 }}
          className="z-[1500] bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto"
        >
          {loading ? (
            <div className="px-3 py-3 text-xs text-gray-500 flex items-center gap-2">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          ) : flat.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500">
              {accounts.length === 0
                ? (ledgerFilter ? `No ${ledgerFilter} accounts in this book.` : 'No accounts in this book yet.')
                : 'No accounts match.'}
            </div>
          ) : (
            <ul ref={listRef} className="py-1">
              {(() => {
                let runningIndex = -1;
                return grouped.map(([ledger, items]) => (
                  <li key={ledger}>
                    <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide font-semibold text-gray-400 bg-gray-50 sticky top-0">
                      {ledger}
                    </div>
                    <ul>
                      {items.map(a => {
                        runningIndex++;
                        const i = runningIndex;
                        return (
                          <li
                            key={a.id}
                            data-i={i}
                            onMouseEnter={() => setHighlight(i)}
                            onMouseDown={e => { e.preventDefault(); handlePick(a); }}
                            className={`px-3 py-1.5 text-sm cursor-pointer ${
                              i === highlight ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {a.name}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ));
              })()}
            </ul>
          )}

          <div className="border-t border-gray-100 bg-gray-50/60">
            {creating ? (
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500">
                    New account
                  </span>
                  <button
                    type="button"
                    onClick={cancelCreate}
                    aria-label="Cancel"
                    className="text-gray-400 hover:text-gray-700"
                  >
                    <X size={12} />
                  </button>
                </div>
                <input
                  ref={createNameRef}
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
                  }}
                  placeholder="Name (e.g. Acme Ltd)"
                  className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {ledgerFilter ? (
                  <div className="text-xs text-gray-500">
                    Ledger: <span className="font-medium text-gray-700">{ledgerFilter}</span>
                  </div>
                ) : (
                  <select
                    value={createLedger}
                    onChange={e => setCreateLedger(e.target.value)}
                    className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Pick a ledger…</option>
                    {ALL_LEDGERS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
                {createError && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                    {createError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelCreate}
                    className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={createSubmitting}
                    className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-60"
                  >
                    {createSubmitting && <Loader2 size={11} className="animate-spin" />}
                    Create & select
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); openCreate(); }}
                className="text-xs text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 px-3 py-2"
              >
                <Plus size={11} /> Set up a new account
                {ledgerFilter && <span className="text-gray-400"> in {ledgerFilter}</span>}
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
