'use client';

/**
 * LedgerPicker — type-to-filter dropdown over the static list of ledgers.
 *
 * Mirrors AccountPicker visually and behaviourally (typeahead, ChevronDown,
 * portaled dropdown, keyboard nav, sticky selected display) so the two cells
 * read as a single design language when they sit side-by-side in a row.
 *
 * Used by:
 *   • JournalInputSheet — Ledger column (Dr/Cr table)
 *   • UniversalInputSheet — Analysis Ledger column (header + analysis table)
 *
 * The list itself is static (the same 22 ledger names used in AccountPicker's
 * LEDGER_DEFAULT_TYPE map) so the picker works even when the book has zero
 * accounts in a given ledger.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export const LEDGER_OPTIONS = [
  'Income',
  'Cost of sales',
  'Expenses',
  'Taxation',
  'FA - intangible',
  'FA - land and buildings',
  'FA - plant and machinery',
  'FA - equipment, fixtures & fittings',
  'FA - vehicles',
  'Investments - fixed',
  'Investments - current',
  'Stocks',
  'Customers',
  'Debtors',
  'Bank',
  'Suppliers',
  'Creditors',
  'Deferred tax',
  'Share capital',
  'Share premium',
  'Revaluation reserve',
  'Profit and loss account',
].sort((a, b) => a.localeCompare(b));

interface Props {
  value: string;
  onChange: (ledger: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function LedgerPicker({
  value, onChange, placeholder = 'Pick ledger…', disabled, className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // ── Position the dropdown relative to the anchor cell ─────────────────────
  const [pos, setPos] = useState<{ top: number; left: number; width: number; placement: 'below' | 'above' } | null>(null);
  const updatePosition = useCallback(() => {
    const anchor = containerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const maxH = 288;
    const margin = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'below' | 'above' =
      spaceBelow < maxH + margin && spaceAbove > spaceBelow ? 'above' : 'below';
    const top = placement === 'below'
      ? rect.bottom + margin
      : rect.top - margin - Math.min(maxH, spaceAbove);
    setPos({ top, left: rect.left, width: Math.max(rect.width, 220), placement });
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

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LEDGER_OPTIONS;
    return LEDGER_OPTIONS.filter(l => l.toLowerCase().includes(q));
  }, [query]);

  // ── Close on outside click (anchor OR portaled dropdown) ──────────────────
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      const inAnchor = containerRef.current?.contains(target);
      const inDropdown = dropdownRef.current?.contains(target);
      if (!inAnchor && !inDropdown) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Keep highlighted row in view as user arrow-keys through
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-i="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const handlePick = useCallback((l: string) => {
    onChange(l);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }, [onChange]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault();
        handlePick(filtered[highlight]);
      }
    } else if (e.key === 'Tab') {
      // Auto-pick when the query has narrowed to a single option — VT/Excel
      // muscle memory: type a few letters, tab to commit and move on. We
      // intentionally don't preventDefault so Tab still advances focus.
      if (open && filtered.length === 1 && query.trim() !== '') {
        handlePick(filtered[0]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }, [open, filtered, highlight, handlePick, query]);

  const hasValue = Boolean(value && !open);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {hasValue ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0); }}
          disabled={disabled}
          className="w-full text-left text-sm px-2.5 py-1.5 rounded border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="truncate text-gray-900">{value}</span>
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
          className="z-[1200] bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500">No ledgers match.</div>
          ) : (
            <ul ref={listRef} className="py-1">
              {filtered.map((l, i) => (
                <li
                  key={l}
                  data-i={i}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={e => { e.preventDefault(); handlePick(l); }}
                  className={`px-3 py-1.5 text-sm cursor-pointer ${
                    i === highlight ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {l}
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
