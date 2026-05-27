'use client';

/**
 * VatTreatmentPicker — typeahead dropdown over the fixed VAT treatments.
 *
 * Native <select> elements only do partial typeahead and the behaviour is
 * inconsistent across browsers (in particular, when the user tabs in they
 * generally need a click before letter-keys do anything useful). We want a
 * consistent keyboard-driven experience that matches AccountPicker and
 * LedgerPicker, so the manual rec sheet renders this instead.
 *
 *   - Type "s" → filters to "Standard (20%)" (and any other s-prefixed labels)
 *   - Arrow keys + Enter to pick
 *   - Tab auto-picks if the query has narrowed to a single option
 *   - Display reads as a button with the chosen label when one is selected;
 *     focus + typing flips it back to input mode pre-filled with the typed
 *     character
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import { VAT_TREATMENT_OPTIONS, type VatTreatment } from '@/types/bookkeeping';

interface Props {
  value: VatTreatment;
  onChange: (v: VatTreatment) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function VatTreatmentPicker({
  value, onChange, placeholder = 'VAT…', disabled, className = '',
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

  // ── Position the dropdown ─────────────────────────────────────────────────
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const updatePosition = useCallback(() => {
    const anchor = containerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const maxH = 240;
    const margin = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'below' | 'above' =
      spaceBelow < maxH + margin && spaceAbove > spaceBelow ? 'above' : 'below';
    const top = placement === 'below'
      ? rect.bottom + margin
      : rect.top - margin - Math.min(maxH, spaceAbove);
    setPos({ top, left: rect.left, width: Math.max(rect.width, 200) });
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return VAT_TREATMENT_OPTIONS;
    return VAT_TREATMENT_OPTIONS.filter(o => o.label.toLowerCase().includes(q));
  }, [query]);

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

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-i="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  // Pull focus into the typeahead input on the render where it just mounted
  // after a button→input transition. See LedgerPicker for the explanation.
  useEffect(() => {
    if (open && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handlePick = useCallback((v: VatTreatment) => {
    onChange(v);
    setQuery('');
    setOpen(false);
    // Intentionally NOT blurring — when this is called from the Tab key
    // handler, blurring sends focus to <body> before Tab's default action
    // can find the next focusable, breaking the focus-advance for the user
    // and confusing the parent modal's focus trap.
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
        handlePick(filtered[highlight].id);
      }
    } else if (e.key === 'Tab') {
      // Commit the highlighted option, but defer closing the dropdown so the
      // input stays mounted long enough for the browser's default Tab action
      // to advance focus to the next cell. If we close synchronously, React
      // re-renders the picker as a button mid-event, the input unmounts,
      // focus drops to <body>, and the default Tab then walks the whole
      // document and lands on the SMITH logo.
      if (open && filtered[highlight]) {
        onChange(filtered[highlight].id);
        setQuery('');
        setTimeout(() => setOpen(false), 0);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  }, [open, filtered, highlight, handlePick, query]);

  const currentLabel = VAT_TREATMENT_OPTIONS.find(o => o.id === value)?.label ?? '';
  const hasValue = Boolean(value && !open);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {hasValue ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 0); }}
          onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); setTimeout(() => inputRef.current?.focus(), 0); }}
          onKeyDown={e => {
            // Same typeahead-from-button rule as LedgerPicker/AccountPicker.
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
          <span className="truncate text-gray-900">{currentLabel}</span>
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
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 240 }}
          className="z-[1500] bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500">No treatments match.</div>
          ) : (
            <ul ref={listRef} className="py-1">
              {filtered.map((o, i) => (
                <li
                  key={o.id}
                  data-i={i}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={e => { e.preventDefault(); handlePick(o.id); }}
                  className={`px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between ${
                    i === highlight ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>{o.label}</span>
                  {o.rate > 0 && <span className="text-[10px] text-gray-400 tabular-nums">{o.rate}%</span>}
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
