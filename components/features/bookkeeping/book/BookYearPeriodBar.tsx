'use client';

/**
 * BookYearPeriodBar — the three VT-style header controls that drive what
 * the trial balance, P&L, balance sheet, etc. show:
 *
 *   ┌──────────────────────┐ ┌─────────────────┐ ┌──────────────────────────┐
 *   │ Year to 31 Mar 2026 ▼│ │ Entire year   ▼ │ │ 🔓 No periods are locked │
 *   └──────────────────────┘ └─────────────────┘ └──────────────────────────┘
 *
 *   • Year dropdown — every FY on the book, current first. Bottom of the
 *     list links to a "Year ends…" management dialog.
 *   • Period dropdown — within the selected year: Entire year / one month /
 *     one quarter / a custom range.
 *
 * For now the bar maintains its own selection state. Once Stage D wires the
 * reports up to consume it, the selection will live in BookNavigation so
 * the TB / P&L / BS / CF tabs all switch together.
 */

import { useEffect, useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Calendar } from 'lucide-react';
import type { FinancialYear } from '@/types/bookkeeping';
import type { ActivePeriod } from './BookNavigationContext';

interface Props {
  bookId: string;
  /** Optional book period-lock date so the third panel reflects it without
   *  re-fetching. Passed by the BookView header which already loads the book. */
  periodLockDate: string | null;
  /** Year-end pattern — when missing, the bar collapses to a "Set a year-end
   *  in Settings" prompt. */
  yearEndMd: string | null;
  /** Currently-selected FY from the book row (persisted on the server so the
   *  whole team sees the same default until someone changes it). NULL falls
   *  back to "FY containing today" on first render. */
  currentFyId: string | null;
  /** Called when the user clicks the lock chip — typically opens Book Settings. */
  onOpenSettings?: () => void;
  /** Called when the user picks "Year ends…" from the year dropdown. */
  onOpenYearEnds?: () => void;
  /** Bump to force the bar to re-fetch its financial years — e.g. after the
   *  Year Ends dialog closes/reopens/changes a year, or prunes placeholders. */
  refreshKey?: number;
  /** Pushes the resolved ActivePeriod up to the parent so it can broadcast
   *  via BookNavigation. Reports listen to that context. */
  onPeriodChange?: (active: ActivePeriod) => void;
}

export type PeriodKey =
  | { kind: 'entire' }
  | { kind: 'month'; iso: string }     // first day of the month, ISO
  | { kind: 'quarter'; endIso: string } // last day of the quarter, ISO
  | { kind: 'custom'; startIso: string; endIso: string };

function formatDateUk(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function monthLabel(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
function yearLabel(fy: FinancialYear): string {
  // Mimic VT's labelling — "Year to 31 Mar 2026" for a full year, "To <end>"
  // for the very first (potentially short) year, "Year ending <end>" doesn't
  // exist in VT so we don't use it.
  const isShortFirst = false; // we'd compare to the expected pattern but it's not material here
  const end = new Date(`${fy.end_date}T00:00:00Z`);
  const endLabel = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return isShortFirst ? `To ${endLabel}` : `Year to ${endLabel}`;
}

export default function BookYearPeriodBar({
  bookId, periodLockDate, yearEndMd, currentFyId, onOpenSettings, onOpenYearEnds, onPeriodChange, refreshKey,
}: Props) {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFyId, setActiveFyId] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>({ kind: 'entire' });

  // ── Load FYs ────────────────────────────────────────────────────────────
  // Refetches whenever the book's year-end pattern changes (typically right
  // after the user sets it in Book Settings). Without the yearEndMd
  // dependency the bar would stay on its initial empty list and the
  // "No years yet" chip would never refresh.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // ?generate=true so the bar always has something to show even if the
    // user hasn't visited any other surface that triggers FY generation yet.
    fetch(`/api/bookkeeping/books/${bookId}/years?generate=true`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { years?: FinancialYear[] } | null) => {
        if (cancelled) return;
        const list = d?.years ?? [];
        setYears(list);
        // Default-selection priority:
        //   1. Whatever the user explicitly picked this session (prev)
        //   2. The FY persisted on the book row (currentFyId from the server —
        //      survives reloads + shared across all users on this book)
        //   3. The FY containing today
        //   4. The latest FY available
        const today = new Date().toISOString().slice(0, 10);
        const containingToday = list.find(y => y.start_date <= today && y.end_date >= today);
        setActiveFyId(prev => {
          if (prev && list.some(y => y.id === prev)) return prev;
          if (currentFyId && list.some(y => y.id === currentFyId)) return currentFyId;
          return (containingToday ?? list[list.length - 1])?.id ?? null;
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, yearEndMd, currentFyId, refreshKey]);

  // Persist year-end selection to the book whenever the user picks one. We
  // only PATCH when the choice actually differs from currentFyId — otherwise
  // every render of the bar would fire a no-op write. Fire-and-forget; the
  // server is the source of truth so transient failures self-heal on next
  // page load.
  const lastPersistedRef = useRef<string | null>(currentFyId);
  useEffect(() => {
    if (!activeFyId) return;
    if (activeFyId === lastPersistedRef.current) return;
    lastPersistedRef.current = activeFyId;
    fetch(`/api/bookkeeping/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_fy_id: activeFyId }),
    }).catch(() => { /* non-fatal */ });
  }, [activeFyId, bookId]);

  const activeFy = useMemo(() => years.find(y => y.id === activeFyId) ?? null, [years, activeFyId]);

  // Reset period when year changes — Entire year is the safe default.
  const lastFyIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeFy) return;
    if (lastFyIdRef.current !== activeFy.id) {
      setPeriod({ kind: 'entire' });
      lastFyIdRef.current = activeFy.id;
    }
  }, [activeFy]);

  // ── Resolve the active period and broadcast upward ─────────────────────
  // Every report consumes ActivePeriod via BookNavigation. Compute the
  // ISO boundaries from the FY + period selection here so the bar is the
  // single source of truth.
  useEffect(() => {
    if (!onPeriodChange) return;
    if (!yearEndMd || !activeFy) {
      onPeriodChange({ ready: false, fromIso: null, toIso: null, fyStartIso: null, fyEndIso: null, label: 'No year set' });
      return;
    }
    let fromIso: string;
    let toIso: string;
    let label: string;
    if (period.kind === 'entire') {
      fromIso = activeFy.start_date;
      toIso   = activeFy.end_date;
      label   = yearLabel(activeFy);
    } else if (period.kind === 'month') {
      fromIso = period.iso;
      const [yy, mm] = period.iso.split('-').map(Number);
      const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      toIso = `${yy}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      label = monthLabel(period.iso);
    } else if (period.kind === 'quarter') {
      toIso = period.endIso;
      const [yy, mm] = period.endIso.split('-').map(Number);
      // Start of quarter = first day of (mm-2). Clamp to FY start so a short
      // first year doesn't cause the report to look further back than data exists.
      const qStartMonth = Math.max(1, mm - 2);
      const qStartYear  = yy;
      const candidateStart = `${qStartYear}-${String(qStartMonth).padStart(2, '0')}-01`;
      fromIso = candidateStart < activeFy.start_date ? activeFy.start_date : candidateStart;
      label = `Quarter to ${new Date(`${period.endIso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
    } else {
      fromIso = period.startIso;
      toIso   = period.endIso;
      label   = `${formatDateUk(period.startIso)} → ${formatDateUk(period.endIso)}`;
    }
    onPeriodChange({
      ready: true,
      fromIso,
      toIso,
      fyStartIso: activeFy.start_date,
      fyEndIso:   activeFy.end_date,
      label,
    });
  }, [activeFy, period, yearEndMd, onPeriodChange]);

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!yearEndMd) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
      >
        <Calendar size={11} />
        Set a year-end to enable period reports →
      </button>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px]">
      <YearDropdown
        years={years}
        activeFyId={activeFyId}
        onPick={setActiveFyId}
        onOpenYearEnds={onOpenYearEnds}
        loading={loading}
      />
      <PeriodDropdown
        fy={activeFy}
        value={period}
        onChange={setPeriod}
      />
    </div>
  );
}

// ── Year dropdown ──────────────────────────────────────────────────────────
function YearDropdown({
  years, activeFyId, onPick, onOpenYearEnds, loading,
}: {
  years: FinancialYear[];
  activeFyId: string | null;
  onPick: (id: string) => void;
  onOpenYearEnds?: () => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 220) });
  }, []);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const active = years.find(y => y.id === activeFyId);
  const label = loading ? 'Loading…' : active ? yearLabel(active) : 'No years yet';

  // Sort with most recent first so the current/active year is near the top
  // of the dropdown — matches VT.
  const sorted = useMemo(() => [...years].sort((a, b) => b.start_date.localeCompare(a.start_date)), [years]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      >
        <Calendar size={10} className="text-slate-400" />
        <span className="font-medium">{label}</span>
        <ChevronDown size={10} className="text-slate-400" />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
          className="z-[1300] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
        >
          <ul className="max-h-[320px] overflow-y-auto py-1">
            {sorted.map(fy => {
              const isActive = fy.id === activeFyId;
              return (
                <li key={fy.id}>
                  <button
                    type="button"
                    onClick={() => { onPick(fy.id); setOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-50 ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}
                  >
                    <span className="flex-1 truncate">{yearLabel(fy)}</span>
                    {fy.status === 'closed' && <span className="text-[9px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.5 rounded">Closed</span>}
                    {fy.status === 'reopened' && <span className="text-[9px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.5 rounded">Reopened</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {onOpenYearEnds && (
            <button
              type="button"
              onClick={() => { onOpenYearEnds(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 border-t border-slate-100 text-indigo-700 hover:bg-indigo-50"
            >
              Year ends…
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Period dropdown ────────────────────────────────────────────────────────
function PeriodDropdown({
  fy, value, onChange,
}: {
  fy: FinancialYear | null;
  value: PeriodKey;
  onChange: (next: PeriodKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updatePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 200) });
  }, []);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [open, updatePos]);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Build the list of months + quarters inside this FY.
  const { months, quarters } = useMemo(() => {
    if (!fy) return { months: [] as { iso: string; label: string }[], quarters: [] as { endIso: string; label: string }[] };
    const months: { iso: string; label: string }[] = [];
    const start = new Date(`${fy.start_date}T00:00:00Z`);
    const end   = new Date(`${fy.end_date}T00:00:00Z`);
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end) {
      const iso = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-01`;
      months.push({ iso, label: monthLabel(iso) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    // Quarters — VT does "Quarter to Jun 2025" etc., grouped by quarter end.
    // We bucket months into chunks of 3, starting from the first month of
    // the FY (so a short first year produces fewer quarters).
    const quarters: { endIso: string; label: string }[] = [];
    for (let i = 0; i < months.length; i += 3) {
      const lastInQ = months[Math.min(i + 2, months.length - 1)];
      const lastIso = lastInQ.iso;
      // Last day of that month
      const [yy, mm] = lastIso.split('-').map(Number);
      const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const endIso = `${yy}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      quarters.push({ endIso, label: `Quarter to ${monthLabel(lastIso)}` });
    }
    return { months, quarters };
  }, [fy]);

  function labelFor(v: PeriodKey): string {
    if (v.kind === 'entire')  return 'Entire year';
    if (v.kind === 'month')   return monthLabel(v.iso);
    if (v.kind === 'quarter') return `Quarter to ${new Date(`${v.endIso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
    return `${formatDateUk(v.startIso)} → ${formatDateUk(v.endIso)}`;
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={!fy}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className="font-medium">{labelFor(value)}</span>
        <ChevronDown size={10} className="text-slate-400" />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.width }}
          className="z-[1300] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden"
        >
          <ul className="max-h-[360px] overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => { onChange({ kind: 'entire' }); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 ${value.kind === 'entire' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-700'}`}
              >
                Entire year
              </button>
            </li>
            {months.length > 0 && <li className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Months</li>}
            {months.map(m => {
              const isActive = value.kind === 'month' && value.iso === m.iso;
              return (
                <li key={m.iso}>
                  <button
                    type="button"
                    onClick={() => { onChange({ kind: 'month', iso: m.iso }); setOpen(false); }}
                    className={`w-full text-left px-3 py-1 hover:bg-slate-50 ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}
                  >
                    {m.label}
                  </button>
                </li>
              );
            })}
            {quarters.length > 0 && <li className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Quarters</li>}
            {quarters.map(q => {
              const isActive = value.kind === 'quarter' && value.endIso === q.endIso;
              return (
                <li key={q.endIso}>
                  <button
                    type="button"
                    onClick={() => { onChange({ kind: 'quarter', endIso: q.endIso }); setOpen(false); }}
                    className={`w-full text-left px-3 py-1 hover:bg-slate-50 ${isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'}`}
                  >
                    {q.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}

