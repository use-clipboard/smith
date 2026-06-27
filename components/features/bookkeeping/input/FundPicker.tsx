'use client';

/**
 * FundPicker — charity fund selector for a transaction line.
 *
 * Self-gating: it fetches the book's funds and renders NOTHING when the book
 * has none (i.e. every non-charity book), so it can be dropped into any input
 * sheet or edit form without conditionals at the call site.
 *
 * Funds rarely change within a session, so results are cached per book.
 */

import { useEffect, useState } from 'react';
import { FUND_TYPE_LABEL, type BookFund } from '@/types/bookkeeping';

const cache = new Map<string, BookFund[]>();
const inflight = new Map<string, Promise<BookFund[]>>();

async function loadFunds(bookId: string): Promise<BookFund[]> {
  if (cache.has(bookId)) return cache.get(bookId)!;
  if (inflight.has(bookId)) return inflight.get(bookId)!;
  const p = fetch(`/api/bookkeeping/books/${bookId}/funds`)
    .then(r => r.ok ? r.json() : { funds: [] })
    .then(d => {
      const funds = ((d.funds ?? []) as BookFund[]).filter(f => !f.archived);
      cache.set(bookId, funds);
      return funds;
    })
    .catch(() => [] as BookFund[])
    .finally(() => { inflight.delete(bookId); });
  inflight.set(bookId, p);
  return p;
}

/** Invalidate the cache when funds are edited elsewhere (Funds settings). */
export function invalidateFundsCache(bookId: string) {
  cache.delete(bookId);
}

export default function FundPicker({
  bookId, value, onChange, className, disabled, placeholder = 'Select fund…',
}: {
  bookId: string;
  value: string | null;
  onChange: (fundId: string | null) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [funds, setFunds] = useState<BookFund[]>(() => cache.get(bookId) ?? []);
  const [loaded, setLoaded] = useState(() => cache.has(bookId));

  useEffect(() => {
    let cancelled = false;
    void loadFunds(bookId).then(f => { if (!cancelled) { setFunds(f); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [bookId]);

  // Non-charity books have no funds — render nothing at all.
  if (loaded && funds.length === 0) return null;

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      disabled={disabled}
      className={className ?? 'w-full text-sm px-2 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500'}
    >
      <option value="">{placeholder}</option>
      {funds.map(f => (
        <option key={f.id} value={f.id}>{f.name} · {FUND_TYPE_LABEL[f.fund_type]}</option>
      ))}
    </select>
  );
}
