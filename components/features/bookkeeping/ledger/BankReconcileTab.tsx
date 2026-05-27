'use client';

/**
 * BankReconcileTab — the period-first Reconcile sub-tab on a Bank account
 * ledger.
 *
 * Decides between three views:
 *
 *   1. EMPTY STATE (no active rec for this account):
 *      Big "Start a reconciliation for <period>" card. Period defaults to
 *      the active period from BookNavigationContext (header bar). Opening
 *      balance is pre-fetched (carried forward from the previous reconciled
 *      rec; user-editable on the first ever rec). Closing balance is typed
 *      by the user. Hitting Start posts to /bank-imports/start-period.
 *
 *   2. ACTIVE STATE (one rec in pending or in_progress):
 *      A summary card with a CTA to open the workspace. The full two-column
 *      workspace lands in step 4 of the rework — until then we fall back to
 *      the legacy BankRecDetailModal so the user can keep clearing entries.
 *
 *   3. (No "completed" state here — those live in the History tab.)
 *
 * One active rec per (account) is enforced server-side. We render whichever
 * the most recent pending|in_progress is.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, CalendarRange, AlertCircle, Pencil } from 'lucide-react';
import { useBookNavigation } from '../book/BookNavigationContext';
import BankRecWorkspace from './BankRecWorkspace';

interface Props {
  bookId: string;
  accountId: string;
  accountName: string;
  /** Pre-loaded ledger entries from the parent — no longer consumed by
   *  this component (workspace loads its own scoped data) but kept for
   *  forward-compat with how the parent currently wires the prop. */
  entries: LedgerEntry[];
  onReconciliationChanged: () => void;
}

interface LedgerEntry {
  split_id: string;
  transaction_id: string;
  ref_no: string;
  date: string;
  details: string | null;
  entry_details: string | null;
  debit: number;
  credit: number;
}

interface BankImport {
  id: string;
  account_id: string;
  file_name: string;
  display_label: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned';
  uploaded_at: string;
  reconciled_at: string | null;
}

export default function BankReconcileTab({
  bookId, accountId, accountName, entries, onReconciliationChanged,
}: Props) {
  void entries; // workspace fetches its own data; prop kept for parent compat
  const nav = useBookNavigation();
  const activePeriod = nav?.activePeriod;

  const [imports, setImports] = useState<BankImport[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch imports for this account ───────────────────────────────────────
  const loadImports = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports?account_id=${accountId}`);
      if (!r.ok) return;
      const d = await r.json() as { imports: BankImport[] };
      setImports(d.imports);
    } finally {
      setLoading(false);
    }
  }, [bookId, accountId]);
  useEffect(() => { void loadImports(); }, [loadImports]);

  // The single active rec (if any) — server enforces at most one.
  const activeRec = useMemo(
    () => imports.find(i => i.status === 'pending' || i.status === 'in_progress') ?? null,
    [imports],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (activeRec) {
    return (
      <BankRecWorkspace
        bookId={bookId}
        importId={activeRec.id}
        accountId={accountId}
        accountName={accountName}
        onChanged={() => {
          void loadImports();
          onReconciliationChanged();
        }}
        onExit={() => {
          // Re-fetch the list so a freshly-completed rec drops off the
          // active list and the user lands back on the Start card.
          void loadImports();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <StartRecCard
        bookId={bookId}
        accountId={accountId}
        accountName={accountName}
        activeFromIso={activePeriod?.fromIso ?? null}
        activeToIso={activePeriod?.toIso ?? null}
        activeLabel={activePeriod?.label ?? null}
        onStarted={() => {
          // loadImports re-fetches and the next render flips to the workspace.
          void loadImports();
        }}
      />
    </div>
  );
}

// ── Start-rec card (empty state) ───────────────────────────────────────────
interface BroughtForwardSplit {
  id: string;
  debit: number;
  credit: number;
  transaction: { id: string; ref_no: string; date: string; details: string | null; type: string };
}
interface StartResponse {
  import: BankImport;
  opening_balance: number;
  opening_source: 'carried_forward' | 'first_rec';
  carried_from_rec_id: string | null;
  brought_forward_splits: BroughtForwardSplit[];
}

function StartRecCard({
  bookId, accountId, accountName,
  activeFromIso, activeToIso, activeLabel, onStarted,
}: {
  bookId: string;
  accountId: string;
  accountName: string;
  activeFromIso: string | null;
  activeToIso: string | null;
  activeLabel: string | null;
  onStarted: (id: string) => void;
}) {
  // Default the date range to the active period from the header bar. If no
  // period is active (year-end not set yet) we fall back to "today's month".
  const fallbackPeriod = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { fromIso: iso(start), toIso: iso(end) };
  }, []);

  const [periodStart, setPeriodStart] = useState<string>(activeFromIso ?? fallbackPeriod.fromIso);
  const [periodEnd,   setPeriodEnd]   = useState<string>(activeToIso ?? fallbackPeriod.toIso);
  const [openingBalance,       setOpeningBalance] = useState<string>('');
  const [openingSource, setOpeningSource] = useState<'carried_forward' | 'first_rec' | null>(null);
  const [openingPreviewLoading, setOpeningPreviewLoading] = useState(false);
  const [closingBalance, setClosingBalance] = useState<string>('');
  const [submitting, setSubmitting]   = useState(false);
  const [error,        setError]       = useState<string | null>(null);

  // Sync local state when the active period changes (header bar moves).
  useEffect(() => {
    if (activeFromIso) setPeriodStart(activeFromIso);
    if (activeToIso)   setPeriodEnd(activeToIso);
  }, [activeFromIso, activeToIso]);

  // ── Opening-balance preview ─────────────────────────────────────────────
  // We hit start-period in a "what would the opening be?" sense by doing a
  // dry GET of the most recent reconciled rec ending strictly before our
  // period_start. Simpler than adding another endpoint — fetch /bank-imports
  // filtered by status, sort, take the closing_balance.
  useEffect(() => {
    let cancelled = false;
    setOpeningPreviewLoading(true);
    fetch(`/api/bookkeeping/books/${bookId}/bank-imports?account_id=${accountId}&status=reconciled`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { imports?: BankImport[] } | null) => {
        if (cancelled) return;
        const prior = (d?.imports ?? [])
          .filter(r => r.period_end && r.period_end < periodStart)
          .sort((a, b) => (b.period_end ?? '').localeCompare(a.period_end ?? ''))[0];
        if (prior?.closing_balance != null) {
          setOpeningBalance(String(prior.closing_balance));
          setOpeningSource('carried_forward');
        } else {
          setOpeningBalance(prev => prev || '0.00');
          setOpeningSource('first_rec');
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOpeningPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, accountId, periodStart]);

  async function handleStart() {
    setError(null);
    if (!periodStart || !periodEnd) {
      setError('Pick a start and end date for the period.');
      return;
    }
    if (periodEnd < periodStart) {
      setError('End date is before the start date.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        account_id: accountId,
        period_start: periodStart,
        period_end:   periodEnd,
      };
      // For the first ever rec we honour the user's typed opening balance.
      if (openingSource === 'first_rec') {
        const n = parseFloat(openingBalance.replace(/[,£\s]/g, ''));
        if (!Number.isFinite(n)) {
          setError('Opening balance must be a number.');
          setSubmitting(false);
          return;
        }
        body.opening_balance_override = n;
      }
      const res = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/start-period`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.existing_rec) {
          setError('An active reconciliation already exists for this account.');
          onStarted(data.existing_rec.id);
          return;
        }
        setError(data.error ?? 'Failed to start reconciliation');
        return;
      }
      const d = data as StartResponse;

      // If the user supplied a closing-balance estimate up-front, patch it
      // straight onto the new rec via the existing PATCH endpoint so the
      // workspace doesn't open with a blank target.
      const closingNum = parseFloat((closingBalance ?? '').replace(/[,£\s]/g, ''));
      if (Number.isFinite(closingNum)) {
        await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${d.import.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ closing_balance: closingNum }),
        });
      }
      onStarted(d.import.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <CalendarRange size={14} className="text-indigo-600" />
          <h3 className="text-sm font-semibold text-slate-900">Start a reconciliation</h3>
          <span className="text-xs text-slate-500">— {accountName}</span>
        </div>
        <p className="text-xs text-slate-500">
          Reconcile the ledger for this account against the bank statement for a period.
          {activeLabel && <> Defaulted to <strong className="text-slate-700">{activeLabel}</strong> from the header.</>}
        </p>

        {/* ── Period inputs ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 mt-5">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Period start</label>
            <input
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              className="w-full text-sm rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Period end</label>
            <input
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              className="w-full text-sm rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        {/* ── Opening balance ────────────────────────────────────────── */}
        <div className="mt-4">
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Opening balance
            {openingSource === 'carried_forward' && (
              <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                Carried forward
              </span>
            )}
            {openingSource === 'first_rec' && (
              <span className="ml-2 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-100">
                First rec — please verify
              </span>
            )}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={openingBalance}
              disabled={openingSource === 'carried_forward'}
              onChange={e => setOpeningBalance(e.target.value)}
              placeholder="0.00"
              className="w-48 text-sm rounded-md border border-slate-200 px-2.5 py-1.5 text-right tabular-nums focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-600"
            />
            {openingPreviewLoading && <Loader2 size={11} className="animate-spin text-slate-400" />}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {openingSource === 'carried_forward'
              ? 'Taken from the closing balance of the previous reconciled period. Reopen that rec to change it.'
              : "There's no prior reconciled rec for this account — type the opening balance from your bank statement."}
          </p>
        </div>

        {/* ── Closing balance ────────────────────────────────────────── */}
        <div className="mt-4">
          <label className="block text-[11px] font-medium text-slate-600 mb-1">
            Closing balance (target) <span className="text-slate-400">— optional, can be set later</span>
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={closingBalance}
            onChange={e => setClosingBalance(e.target.value)}
            placeholder="0.00"
            className="w-48 text-sm rounded-md border border-slate-200 px-2.5 py-1.5 text-right tabular-nums focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Type the bank-statement closing balance for the period end. If you import a CSV/PDF later it'll auto-fill from there.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 flex items-start gap-2 text-xs text-rose-800">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={submitting || !periodStart || !periodEnd}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            {submitting
              ? <><Loader2 size={11} className="animate-spin" /> Starting…</>
              : <><Pencil size={11} /> Start reconciliation</>}
          </button>
          <span className="text-[11px] text-slate-500">
            You can add CSV imports, PDF lifts and manual entries inside the workspace.
          </span>
        </div>
      </div>
    </div>
  );
}
