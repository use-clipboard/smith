'use client';

/**
 * PayeeAutocomplete — Details-field input with a dropdown of memorised
 * past payees for the current transaction type.
 *
 * On select, the parent receives the full payee record so it can pre-fill
 * the analysis account, VAT treatment, and entry details from the stored
 * template — VT's classic "type Tesco → analysis line fills itself" trick.
 *
 * Renders the dropdown via React Portal so it escapes the table cell's
 * overflow constraints (same pattern as AccountPicker).
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import type { TransactionType, VatTreatment } from '@/types/bookkeeping';

export interface PayeeSuggestion {
  id: string;
  payee_display: string;
  use_count: number;
  last_used_at: string;
  analysis_account: { id: string; name: string; ledger: string | null } | null;
  vat_treatment: VatTreatment | null;
  vat_rate: number | null;
  entry_details: string | null;
}

interface Props {
  bookId: string;
  type: TransactionType;
  value: string;
  onChange: (v: string) => void;
  /** Fired when the user picks a memorised payee — parent uses this to
   *  populate the analysis account, VAT treatment, entry details, etc. */
  onSelectPayee: (p: PayeeSuggestion) => void;
  placeholder?: string;
  className?: string;
  /** Forwarded to the input — set by parent's data-cell attribute for focus management. */
  inputAttrs?: React.InputHTMLAttributes<HTMLInputElement>;
}

export default function PayeeAutocomplete({
  bookId, type, value, onChange, onSelectPayee,
  placeholder, className, inputAttrs,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PayeeSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Portal anchor
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // ── Fetch suggestions (debounced) ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ type });
        if (value.trim()) params.set('q', value.trim());
        const r = await fetch(`/api/bookkeeping/books/${bookId}/payees?${params}`);
        if (r.ok) {
          const d = await r.json();
          if (!cancelled) {
            setSuggestions((d.payees ?? []) as PayeeSuggestion[]);
            setHighlight(0);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, bookId, type, value]);

  // ── Position the portal'd dropdown under the input ────────────────────────
  const [pos, setPos] = useState<{ top: number; left: number; width: number; placement: 'below' | 'above' } | null>(null);
  const updatePosition = useCallback(() => {
    const anchor = containerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const dropdownMaxHeight = 280;
    const margin = 4;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'below' | 'above' =
      spaceBelow < dropdownMaxHeight + margin && spaceAbove > spaceBelow ? 'above' : 'below';
    const top = placement === 'below'
      ? rect.bottom + margin
      : rect.top - margin - Math.min(dropdownMaxHeight, spaceAbove);
    setPos({ top, left: rect.left, width: Math.max(rect.width, 320), placement });
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

  // ── Close on outside click ────────────────────────────────────────────────
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

  // ── Pick handler ─────────────────────────────────────────────────────────
  const handlePick = useCallback((p: PayeeSuggestion) => {
    onChange(p.payee_display);
    onSelectPayee(p);
    setOpen(false);
    inputRef.current?.blur();
  }, [onChange, onSelectPayee]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') { setOpen(true); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (suggestions[highlight]) {
        e.preventDefault();
        e.stopPropagation();
        handlePick(suggestions[highlight]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  function vatLabel(t: VatTreatment | null): string {
    if (!t || t === 'no_vat') return 'No VAT';
    if (t === 'standard_20') return 'Std 20%';
    if (t === 'reduced_5') return 'Red 5%';
    if (t === 'zero') return 'Zero';
    if (t === 'exempt') return 'Exempt';
    if (t === 'outside_scope') return 'Outside';
    return t;
  }

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <input
        {...inputAttrs}
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {open && portalReady && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, maxHeight: 280 }}
          className="z-[1200] bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto"
        >
          {loading ? (
            <div className="px-3 py-3 text-xs text-gray-500 flex items-center gap-2">
              <Loader2 size={11} className="animate-spin" /> Loading…
            </div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500">
              {value.trim()
                ? `No past ${type} payees match — keep typing and post to memorise this one.`
                : `No past ${type} payees yet.`}
            </div>
          ) : (
            <ul className="py-1">
              {suggestions.map((p, i) => (
                <li
                  key={p.id}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={e => { e.preventDefault(); handlePick(p); }}
                  className={`px-3 py-1.5 cursor-pointer ${
                    i === highlight ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{p.payee_display}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">×{p.use_count}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {p.analysis_account
                      ? `${p.analysis_account.ledger ? p.analysis_account.ledger + ': ' : ''}${p.analysis_account.name}`
                      : <span className="italic">no analysis stored</span>}
                    <span className="mx-1.5 text-gray-300">·</span>
                    {vatLabel(p.vat_treatment)}
                  </div>
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
