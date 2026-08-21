'use client';

/**
 * BookNavigationContext — shared navigation handlers for the bookkeeping
 * workspace. Provided once at BookView level and consumed by ANY descendant
 * via `useBookNavigation()`.
 *
 * ── Coding rule ─────────────────────────────────────────────────────────────
 * Every transaction reference, account name and ledger name shown anywhere
 * in the bookkeeping tool MUST be clickable. Click → open the matching view:
 *
 *   • Transaction reference (e.g. PAY 000001) → opens the type-list tab for
 *     that type, with the transaction pre-selected.
 *   • Account ("Bank: Current account", "Suppliers: Suspense", …) → opens
 *     the ledger drill-down for that specific account.
 *   • Ledger ("Bank", "Suppliers", "Expenses", …) → opens that ledger's
 *     master view (the fixed Customers / Suppliers tabs, or a generic
 *     AccountsLedgerView dynamic tab for other ledgers).
 *
 * Use the helper components below (<TxnRefLink>, <AccountLink>, <LedgerLink>)
 * rather than rolling your own spans — they fall back to a plain span when
 * no nav context is mounted (e.g. unit tests, lone Storybook stories) so
 * they're safe to drop in anywhere.
 */

import { createContext, useContext, useLayoutEffect, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { TransactionType } from '@/types/bookkeeping';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';
import { AccountCodeTag } from '@/lib/bookkeeping/useAccountCodes';

/**
 * Active reporting period — produced by the BookYearPeriodBar in the header
 * and consumed by every report (TB / P&L / BS / CF / VAT).
 *
 *   ready = false → no year-end is set on the book yet. Reports should show
 *   an empty state asking the user to configure a year-end in Settings.
 *   When ready, fromIso/toIso are the inclusive boundaries of the chosen
 *   period (Entire year / a single month / a quarter / a custom range).
 */
export interface ActivePeriod {
  ready: boolean;
  /** Start of the selected period (could be a month or quarter inside the
   *  FY, or the FY's own start if "Entire year" is picked). */
  fromIso: string | null;
  toIso: string | null;
  /** Boundaries of the active financial year regardless of the in-FY
   *  period picked. Ledger views care about FY boundaries (Previous /
   *  Current / Future years filters), not the in-FY period. */
  fyStartIso: string | null;
  fyEndIso: string | null;
  /** Human label for headings, e.g. "Year to 31 Mar 2026" or "Apr 2025". */
  label: string;
}

export interface BookNavigation {
  /** Id of the book we're currently navigating inside. Used by helpers like
   *  TxnRefLink's hover popover to fetch a transaction's splits on demand
   *  when they weren't passed by the caller. */
  bookId: string;
  /** Opens the per-account ledger drill-down. */
  openAccount: (account: { id: string; name: string; ledger: string | null; code?: string | null }) => void;
  /** Opens the transaction-type list view, optionally pre-selecting a row. */
  openTypeList: (type: TransactionType, txnId?: string) => void;
  /** Opens the ledger-level view (Customers / Suppliers / Bank / etc.).
   *  Falls back to opening the first non-empty account in that ledger. */
  openLedger: (ledger: string) => void;
  /** Opens the manual bank-rec entry sheet for a specific bank account as
   *  a dynamic rail tab. Replaces the older "modal" entry point. */
  openManualRec?: (accountId: string, accountName: string) => void;
  /** Reporting period selected in the header. Reports default to this. */
  activePeriod?: ActivePeriod;
  /** Bumped by BookView after ANY post / edit / rollback anywhere in the book
   *  (quick-entry toast, Input tab, imports, year-end, etc.). Mounted report
   *  and ledger tabs include this in their fetch deps so they re-load and the
   *  new entry shows up without the user having to leave and return. */
  dataVersion?: number;
}

const BookNavigationContext = createContext<BookNavigation | null>(null);

export function BookNavigationProvider({
  value, children,
}: { value: BookNavigation; children: React.ReactNode }) {
  return (
    <BookNavigationContext.Provider value={value}>
      {children}
    </BookNavigationContext.Provider>
  );
}

export function useBookNavigation(): BookNavigation | null {
  return useContext(BookNavigationContext);
}

// ── Link primitives ──────────────────────────────────────────────────────────
// Drop-in replacements for the inline `<span class="text-indigo-700">…</span>`
// pattern used historically. If no nav is mounted, they render as plain text
// styled the same way — so behaviour degrades gracefully.

interface TxnLikeSplit {
  debit: number;
  credit: number;
  account?: { name: string; ledger: string | null } | null;
}
interface TxnLike {
  id: string;
  type: TransactionType;
  ref_no: string;
  /** Optional posting date — surfaced in the hover popover header. */
  date?: string;
  /** Optional double-entry breakdown. When provided, hovering the link
   *  reveals a T-account popover with debits on top and credits below. */
  splits?: TxnLikeSplit[];
}

export function TxnRefLink({ txn, className }: { txn: TxnLike; className?: string }) {
  const nav = useBookNavigation();
  const cls = `text-indigo-700 font-mono ${className ?? ''}`;

  // Inert fallback when there's no nav context (print views, standalone
  // embeds, tests). No tooltip either — it'd be misleading to show a
  // T-account on something that can't be clicked through.
  if (!nav) return <span className={cls}>{txn.ref_no}</span>;

  const button = (
    <button
      type="button"
      onClick={() => nav.openTypeList(txn.type, txn.id)}
      className={`${cls} hover:underline hover:text-indigo-900 transition-colors`}
    >
      {txn.ref_no}
    </button>
  );

  // Always wrap in the hover. When the caller already passed real splits we
  // use them directly; when they didn't (most ledger/VAT rows pass a minimal
  // stub) the popover fetches them on first hover via the txn detail API.
  return (
    <TxnTAccountHover txn={txn} initialSplits={txn.splits} bookId={nav.bookId}>
      {button}
    </TxnTAccountHover>
  );
}

// Tiny module-scoped cache so re-hovering the same ref doesn't refetch. Keyed
// by `${bookId}:${txnId}`. Lives for the lifetime of the page; that's fine
// because edits to a transaction invalidate it via realtime/refresh elsewhere
// in the UI before the user is likely to re-hover the same row.
const SPLIT_CACHE = new Map<string, TxnLikeSplit[]>();
const SPLIT_INFLIGHT = new Map<string, Promise<TxnLikeSplit[]>>();

async function loadSplits(bookId: string, txnId: string): Promise<TxnLikeSplit[]> {
  const key = `${bookId}:${txnId}`;
  const cached = SPLIT_CACHE.get(key);
  if (cached) return cached;
  const inflight = SPLIT_INFLIGHT.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${txnId}`);
      if (!r.ok) return [];
      const d = await r.json() as { transaction?: { splits?: TxnLikeSplit[] } };
      const splits = (d.transaction?.splits ?? []).filter(s => Number(s.debit) > 0 || Number(s.credit) > 0);
      SPLIT_CACHE.set(key, splits);
      return splits;
    } catch { return []; }
    finally { SPLIT_INFLIGHT.delete(key); }
  })();
  SPLIT_INFLIGHT.set(key, p);
  return p;
}

// ── T-account hover popover ─────────────────────────────────────────────────
// Renders a small card over the ref link showing debits (top) and credits
// (bottom) for the transaction. Uses createPortal so it isn't clipped by
// any table-cell `overflow-hidden`. Position is computed from the trigger's
// bounding rect and clamped to the viewport.

const POPOVER_GAP = 6;
const POPOVER_EDGE = 8;

function formatDateUk(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function TxnTAccountHover({
  txn, initialSplits, bookId, children,
}: {
  txn: TxnLike;
  initialSplits: TxnLikeSplit[] | undefined;
  bookId: string;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef  = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Splits state — prefilled if the caller passed them, otherwise fetched
  // lazily on first hover via the cache helper above.
  const initialFiltered = (initialSplits ?? []).filter(s => Number(s.debit) > 0 || Number(s.credit) > 0);
  const [splits, setSplits] = useState<TxnLikeSplit[]>(initialFiltered);
  const [loading, setLoading] = useState(false);

  // First hover with no real splits → fetch them. Module cache means re-hovers
  // of the same ref short-circuit instantly.
  useEffect(() => {
    if (!hovered) return;
    if (splits.length > 0) return;
    let cancelled = false;
    setLoading(true);
    loadSplits(bookId, txn.id).then(result => {
      if (cancelled) return;
      setSplits(result);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [hovered, bookId, txn.id, splits.length]);

  useLayoutEffect(() => {
    if (!hovered || !triggerRef.current || !bubbleRef.current) return;
    const trig = triggerRef.current.getBoundingClientRect();
    const bub  = bubbleRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: anchor below the trigger, horizontally centred.
    let top  = trig.bottom + POPOVER_GAP;
    let left = trig.left + trig.width / 2 - bub.width / 2;

    // If the popover would clip the bottom, flip above.
    if (top + bub.height > vh - POPOVER_EDGE) {
      top = trig.top - bub.height - POPOVER_GAP;
    }

    // Clamp horizontally / vertically so the bubble is always fully on-screen.
    left = Math.max(POPOVER_EDGE, Math.min(left, vw - bub.width  - POPOVER_EDGE));
    top  = Math.max(POPOVER_EDGE, Math.min(top,  vh - bub.height - POPOVER_EDGE));

    setPos({ top, left });
  }, [hovered, splits.length, loading]);

  // Dismiss on scroll / resize — the trigger may have moved.
  useEffect(() => {
    if (!hovered) { setPos(null); return; }
    const dismiss = () => setHovered(false);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [hovered]);

  // VT-style flat layout: debit rows first, credit rows second, no section
  // headers. Each row is Ledger | Account | Amount, with credit amounts shown
  // in red so dr/cr is obvious at a glance without an explicit column header.
  const debits  = splits.filter(s => Number(s.debit)  > 0);
  const credits = splits.filter(s => Number(s.credit) > 0);
  const orderedRows: { side: 'dr' | 'cr'; split: TxnLikeSplit; amount: number }[] = [
    ...debits.map(s  => ({ side: 'dr' as const, split: s, amount: Number(s.debit)  })),
    ...credits.map(s => ({ side: 'cr' as const, split: s, amount: Number(s.credit) })),
  ];

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {/* Layout decision: for big YET / year-end transactions with 20+
          splits, a single 360px column would be too tall for the viewport.
          Rather than scroll, we split the rows across multiple side-by-side
          columns and widen the bubble proportionally. Aim for ~14 rows per
          column — keeps the bubble height under ~280px while staying
          horizontally compact for the common 2-row case.
          The expression is computed BEFORE the createPortal so it's
          available in the JSX below. */}
      {hovered && typeof document !== 'undefined' && (() => {
        const ROWS_PER_COL = 14;
        // Widened from 360 → 420 so formatted amounts ("23,114.42",
        // "1,234,567.89") don't get clipped by the bubble's overflow-hidden
        // wrapper. The pre-thousands-separator versions fit in 360 but the
        // commas push the numeric columns wide enough to spill.
        const SINGLE_COL_WIDTH = 420;
        const colCount = Math.max(1, Math.ceil(orderedRows.length / ROWS_PER_COL));
        const rowsPerColEven = Math.ceil(orderedRows.length / colCount);
        const columns: typeof orderedRows[] = [];
        for (let i = 0; i < colCount; i++) {
          columns.push(orderedRows.slice(i * rowsPerColEven, (i + 1) * rowsPerColEven));
        }
        // Cap the total width at viewport minus padding so very long lists
        // (50+ rows) don't spill off-screen sideways.
        const desiredWidth = SINGLE_COL_WIDTH * colCount;
        const maxWidth = typeof window !== 'undefined' ? window.innerWidth - POPOVER_EDGE * 2 : desiredWidth;
        const width = Math.min(desiredWidth, maxWidth);
        return createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? 'visible' : 'hidden',
            pointerEvents: 'none',
            zIndex: 9999,
            width,
          }}
          className="rounded-md border border-purple-300 shadow-xl text-slate-900 bg-purple-50 overflow-hidden"
        >
          {/* Header — ref + date, slightly stronger purple bar. When the
              body is multi-column the right-side Debit/Credit labels would
              be misleading (they only apply to the rightmost column), so
              we drop them once we split. */}
          <div className="px-2.5 py-1 border-b border-purple-200 bg-purple-200/80 flex items-center gap-2">
            <span className="font-mono text-[11px] text-indigo-700">{txn.ref_no}</span>
            {txn.date && (
              <span className="text-[10px] text-slate-500 tabular-nums">{formatDateUk(txn.date)}</span>
            )}
            {colCount === 1 && (
              <span className="ml-auto text-[10px] uppercase tracking-wide text-purple-700/70 font-semibold flex items-center gap-3">
                {/* Widened to match the 86px amount cells below so the
                    header labels line up over their columns. */}
                <span className="w-[78px] text-right">Debit</span>
                <span className="w-[78px] text-right">Credit</span>
              </span>
            )}
            {colCount > 1 && (
              <span className="ml-auto text-[10px] uppercase tracking-wide text-purple-700/70 font-semibold">
                {orderedRows.length} entries · {colCount} columns
              </span>
            )}
          </div>

          {/* T-account body — single table when small, side-by-side
              columns when big. */}
          {loading && orderedRows.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500 italic">
              Loading entries…
            </div>
          ) : orderedRows.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500 italic">
              No breakdown available.
            </div>
          ) : (
            <div className="flex">
              {columns.map((colRows, ci) => (
                <table
                  key={ci}
                  className={`text-[11px] flex-1 ${ci > 0 ? 'border-l border-purple-300' : ''}`}
                >
                  <tbody>
                    {colRows.map((r, i) => (
                      <tr key={i} className="border-t border-purple-200/60 first:border-t-0">
                        <td className="px-2.5 py-0.5 text-slate-700 truncate" style={{ maxWidth: 90 }}>
                          {r.split.account?.ledger ?? ''}
                        </td>
                        <td className="px-1 py-0.5 text-slate-900 truncate">
                          {r.split.account?.name ?? '—'}
                        </td>
                        {/* width bumped to 86px to comfortably fit
                            "1,234,567.89" (~80px at this font) — the old
                            64px clipped anything with thousands separators
                            past the comma. */}
                        <td className="px-2.5 py-0.5 text-right tabular-nums text-slate-900" style={{ width: 86 }}>
                          {r.side === 'dr' ? formatMoneyAbs(r.amount) : ''}
                        </td>
                        <td className="px-2.5 py-0.5 text-right tabular-nums text-red-600" style={{ width: 86 }}>
                          {r.side === 'cr' ? formatMoneyAbs(r.amount) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          )}
        </div>,
        document.body,
        );
      })()}
    </span>
  );
}

interface AccountLike { id: string; name: string; ledger: string | null; code?: string | null; }

/**
 * Renders an account as `Ledger: Name` (or just `Name` when ledger is null),
 * optionally prefixed with its code when the per-user preference is on.
 * Clickable when nav is mounted; plain span otherwise.
 */
export function AccountLink({
  account, className, showLedger = true,
}: { account: AccountLike | null | undefined; className?: string; showLedger?: boolean }) {
  const nav = useBookNavigation();
  if (!account) return <span></span>;
  const label = showLedger && account.ledger ? `${account.ledger}: ${account.name}` : account.name;
  const cls = `text-indigo-700 ${className ?? ''}`;
  const inner = <><AccountCodeTag code={account.code} className="mr-1.5" />{label}</>;
  if (!nav) return <span className={cls}>{inner}</span>;
  return (
    <button
      type="button"
      onClick={() => nav.openAccount(account)}
      className={`${cls} hover:underline hover:text-indigo-900 text-left transition-colors`}
    >
      {inner}
    </button>
  );
}

/**
 * Renders a bare ledger name. Click → opens that ledger's master view.
 * Falls back to a plain span when no nav context is mounted.
 */
export function LedgerLink({
  ledger, className, children,
}: { ledger: string; className?: string; children?: React.ReactNode }) {
  const nav = useBookNavigation();
  const cls = `text-indigo-700 ${className ?? ''}`;
  if (!nav) return <span className={cls}>{children ?? ledger}</span>;
  return (
    <button
      type="button"
      onClick={() => nav.openLedger(ledger)}
      className={`${cls} hover:underline hover:text-indigo-900 text-left transition-colors`}
    >
      {children ?? ledger}
    </button>
  );
}
