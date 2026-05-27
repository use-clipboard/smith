'use client';

/**
 * BankRecWorkspace — the period-first two-column reconciliation workspace.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ Period · Opening · Cleared · Closing(editable) · Gap             │
 *   ├──────────────────────────────┬───────────────────────────────────┤
 *   │ LEDGER ENTRIES IN PERIOD     │ STATEMENT LINES (optional)        │
 *   │  ☑ 02/11 PAY 000094 ... 9.35 │  02/11 SAINSBURY'S         -9.35  │
 *   │  ☐ 03/11 PAY 000095 ...      │  ...                              │
 *   │  ...                         │  + Import CSV  + Manual  + PDF    │
 *   ├──────────────────────────────┴───────────────────────────────────┤
 *   │ Notes [________]                Abandon · Reconcile period ✓     │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 *   • Ticking a ledger entry calls /clear-splits — that's all clearing is
 *     in the new model.  Statement-line pairing is independent.
 *   • Statement lines render only if a CSV/PDF/Manual contribution has
 *     been brought into the rec — first cut they open the legacy import
 *     modal; step 5 will replace those entry points with workspace-native
 *     panels.
 *   • Reconcile period button is gated on (closing set) AND (gap == 0).
 *
 *   The workspace fetches /bank-imports/[id]/workspace in one shot so it
 *   doesn't churn the network on every tick.  Optimistic UI on clearings
 *   keeps the tick responsive even on slow connections.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, AlertCircle, ChevronLeft, Check, Ban, Upload, Pencil,
  FileScan, Cable, X, MoreVertical, NotebookPen, Sparkles,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import ContributeCsvModal from './ContributeCsvModal';
import ManualBankRecSheet from './ManualBankRecSheet';
import GapHelperModal from './GapHelperModal';
import { useBookNavigation, TxnRefLink } from '../book/BookNavigationContext';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface Props {
  bookId: string;
  importId: string;
  accountId: string;
  accountName: string;
  /** Called when anything changes (clear / unclear / complete / abandon)
   *  so the parent ledger view refreshes balances. */
  onChanged: () => void;
  /** Called to back out to the parent's start card (used after abandon
   *  or once the rec is reconciled). */
  onExit: () => void;
}

// ── Server response shape ──────────────────────────────────────────────────
interface RecHeader {
  id: string;
  account_id: string;
  display_label: string | null;
  file_name: string;
  period_start: string | null;
  period_end:   string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'pending' | 'in_progress' | 'reconciled' | 'abandoned';
  notes: string | null;
  reconciled_at: string | null;
}
interface SplitRow {
  id: string;
  transaction_id: string;
  account_id: string;
  debit: number;
  credit: number;
  entry_details: string | null;
  cleared_in_rec_id: string | null;
  cleared_at: string | null;
  transaction: {
    id: string; type: string; ref_no: string; date: string;
    details: string | null; payee_text: string | null;
    vat_total: number;
  };
  /** Analysis-side account name + ledger, surfaced by the workspace
   *  endpoint by looking up the "other" non-VAT split on the same
   *  transaction. null when the lookup couldn't pick a clear winner
   *  (e.g. multi-leg journals — rare on a bank account). */
  analysis_account_name: string | null;
  analysis_ledger: string | null;
}
interface BankLine {
  id: string;
  line_no: number;
  date: string;
  description: string;
  amount: number;
  statement_balance: number | null;
  matched_split_id: string | null;
  reconciled_at: string | null;
  notes: string | null;
}
interface Workspace {
  import: RecHeader;
  cleared_splits: SplitRow[];
  open_splits:    SplitRow[];
  lines:          BankLine[];
  totals: {
    opening: number;
    cleared_total: number;
    closing: number | null;
    gap: number | null;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatDateUk(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) < 0.005) return '0.00';
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function signed(s: SplitRow): number { return Number(s.debit) - Number(s.credit); }

// ── Component ──────────────────────────────────────────────────────────────
export default function BankRecWorkspace({
  bookId, importId, accountId, accountName, onChanged, onExit,
}: Props) {
  void useBookNavigation; // reserved for future "post missing entry" wiring

  const [ws, setWs]           = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  /** Local override of closing balance — typed by user.  We don't PATCH on
   *  every keystroke; instead we save on blur, and the Reconcile button
   *  flushes it before completing. */
  const [closingDraft, setClosingDraft] = useState<string>('');
  const closingSavedAt = useRef<number>(0);

  /** Notes draft, same save-on-blur pattern. */
  const [notesDraft, setNotesDraft] = useState<string>('');

  /** Selected statement line for legacy line→split pairing. */
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  /** Multi-select on ledger rows. Shift+click extends a range from the
   *  last-clicked row, Ctrl/Cmd+click toggles. Plain click also toggles
   *  selection. The tick button stays as a one-shot clear/unclear action
   *  independent of selection. */
  const [selectedSplitIds, setSelectedSplitIds] = useState<Set<string>>(new Set());
  const lastClickedSplitIdRef = useRef<string | null>(null);

  /** Toggle for CSV import modal + the mode that flow runs in. */
  const [csvOpen,  setCsvOpen]  = useState(false);
  /** 'transactions' (default) drops parsed lines into the Manual sheet as
   *  seed rows for review-and-allocate. 'reference' POSTs straight to
   *  /contribute-lines as legacy bookkeeping_bank_lines rows. */
  const [csvMode, setCsvMode] = useState<'transactions' | 'reference'>('transactions');
  /** Toggle for the multi-row Manual entry sheet. */
  const [postOpen, setPostOpen] = useState(false);
  /** Seed rows fed into the Manual sheet from a parsed CSV — set when the
   *  user finishes the CSV preview in transactions mode. Cleared when
   *  the sheet closes so a subsequent Manual click opens blank. */
  const [csvSeedRows, setCsvSeedRows] = useState<Array<{
    type: 'PAY' | 'REC';
    dateUk: string;
    payee: string;
    totalText: string;
  }> | null>(null);
  /** Toggle for the gap-helper diagnostic modal — opens when the user
   *  clicks the non-zero gap pill in the balance strip. */
  const [gapHelperOpen, setGapHelperOpen] = useState(false);
  /** Book context needed by the Post modal (VAT) and the row actions
   *  hook (late-VAT-entry handling on edits). */
  const [vatRegistered, setVatRegistered] = useState<boolean>(false);
  const [vatLockDate,   setVatLockDate]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        setVatRegistered(!!d?.book?.vat_registered);
        setVatLockDate(d?.book?.vat_lock_date ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  /** Right-click context menu + edit/duplicate/delete/audit/change-type
   *  modals for ledger rows in this workspace. Same hook the dashboard
   *  transaction lists use — so right-click behaviour is identical
   *  across the bookkeeping module. */
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered,
    vatLockDate,
    onChanged: async () => {
      // Any edit/delete on a transaction may move splits in/out of the
      // rec or change their amounts — refetch the workspace so cleared
      // totals + gap recompute.
      await load();
      onChanged();
    },
  });

  // ── Loader ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/workspace`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Failed to load reconciliation');
        return;
      }
      const d = await r.json() as Workspace;
      setWs(d);
      setClosingDraft(d.import.closing_balance != null ? String(d.import.closing_balance) : '');
      setNotesDraft(d.import.notes ?? '');
    } finally { setLoading(false); }
  }, [bookId, importId]);
  useEffect(() => { void load(); }, [load]);

  // ── Derived ────────────────────────────────────────────────────────────
  const editable = ws?.import.status === 'pending' || ws?.import.status === 'in_progress';
  const splitToLine = useMemo(() => {
    const m = new Map<string, BankLine>();
    for (const l of ws?.lines ?? []) if (l.matched_split_id) m.set(l.matched_split_id, l);
    return m;
  }, [ws]);

  /** Auto-suggest the ledger split for the selected line: same-amount,
   *  ±7-day window, not already cleared. Mirrors the legacy modal's
   *  logic so users get the same hint behaviour. */
  const selectedLine = (ws?.lines ?? []).find(l => l.id === selectedLineId) ?? null;
  const suggestions = useMemo(() => {
    if (!selectedLine || !ws) return new Set<string>();
    const target = Number(selectedLine.amount);
    const t = new Date(selectedLine.date).getTime();
    const out = new Set<string>();
    for (const s of ws.open_splits) {
      if (s.cleared_in_rec_id) continue;
      if (Math.abs(signed(s) - target) > 0.005) continue;
      const dDays = Math.abs(new Date(s.transaction.date).getTime() - t) / (1000 * 60 * 60 * 24);
      if (dDays > 7) continue;
      out.add(s.id);
    }
    return out;
  }, [selectedLine, ws]);

  /** Flat list of every selectable split, in display order. Used by the
   *  Shift+click range extender so it knows the "between" sequence. */
  const allSplitsOrdered = useMemo<SplitRow[]>(() => {
    if (!ws) return [];
    const periodStart = ws.import.period_start ?? '';
    const bf  = ws.open_splits.filter(s => s.transaction.date <  periodStart);
    const inP = ws.open_splits.filter(s => s.transaction.date >= periodStart);
    return [...bf, ...ws.cleared_splits, ...inP];
  }, [ws]);

  /** Handle a row body click with modifier-key awareness. */
  function handleRowClick(s: SplitRow, ev: React.MouseEvent) {
    if (!editable) return;
    const id = s.id;

    // Shift+click: extend a range from the anchor to here.
    if (ev.shiftKey && lastClickedSplitIdRef.current) {
      const ids = allSplitsOrdered.map(r => r.id);
      const a = ids.indexOf(lastClickedSplitIdRef.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedSplitIds(prev => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(ids[i]);
          return next;
        });
        return;
      }
    }

    // Ctrl/Cmd+click: toggle just this row, keep anchor.
    if (ev.ctrlKey || ev.metaKey) {
      setSelectedSplitIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      lastClickedSplitIdRef.current = id;
      return;
    }

    // Plain click: toggle and update anchor.
    setSelectedSplitIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    lastClickedSplitIdRef.current = id;
  }

  /** Select everything currently visible. Triggered by Ctrl+A. */
  function selectAllVisible() {
    setSelectedSplitIds(new Set(allSplitsOrdered.map(s => s.id)));
  }
  function clearSelection() {
    setSelectedSplitIds(new Set());
    lastClickedSplitIdRef.current = null;
  }

  // Keyboard: Ctrl+A select all visible, Esc clear selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return; // let inputs use Ctrl+A natively
        e.preventDefault();
        selectAllVisible();
      } else if (e.key === 'Escape' && selectedSplitIds.size > 0) {
        clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSplitsOrdered, selectedSplitIds.size]);

  // Selected split partitioning — used by the bulk action bar.
  const selectedOpen = useMemo(
    () => ws ? ws.open_splits.filter(s => selectedSplitIds.has(s.id)) : [],
    [ws, selectedSplitIds],
  );
  const selectedCleared = useMemo(
    () => ws ? ws.cleared_splits.filter(s => selectedSplitIds.has(s.id)) : [],
    [ws, selectedSplitIds],
  );
  /** Signed sum of every selected split (open + cleared). Shown in the
   *  action bar so the user can sanity-check what they're about to clear
   *  matches the bank statement line(s) they're reconciling against. */
  const selectedTotal = useMemo(() => {
    const all = [...selectedOpen, ...selectedCleared];
    return all.reduce((sum, s) => sum + signed(s), 0);
  }, [selectedOpen, selectedCleared]);

  /** Bulk clear/unclear via the same endpoints toggleClear uses. We refetch
   *  the workspace on completion rather than maintaining optimism across
   *  many rows — for 100+ row operations the brief loading state is fine
   *  and the risk of mismatch on a partial failure is lower. */
  async function bulkClear() {
    if (!editable || selectedOpen.length === 0) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/clear-splits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_ids: selectedOpen.map(s => s.id) }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Bulk clear failed');
        return;
      }
      clearSelection();
      await load();
      onChanged();
    } finally { setBusy(false); }
  }
  async function bulkUnclear() {
    if (!editable || selectedCleared.length === 0) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/unclear-splits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_ids: selectedCleared.map(s => s.id) }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Bulk un-clear failed');
        return;
      }
      clearSelection();
      await load();
      onChanged();
    } finally { setBusy(false); }
  }

  // ── Mutations ──────────────────────────────────────────────────────────
  /** Optimistic toggle: update local state immediately, fire request,
   *  reload on success or revert on failure. Keeps clicks feeling instant
   *  for the common multi-tick workflow. */
  async function toggleClear(split: SplitRow) {
    if (!editable || !ws) return;
    const isCleared = !!split.cleared_in_rec_id;

    // Optimistic local move between open_splits ↔ cleared_splits.
    const nowIso = new Date().toISOString();
    setWs(prev => {
      if (!prev) return prev;
      if (isCleared) {
        return {
          ...prev,
          cleared_splits: prev.cleared_splits.filter(s => s.id !== split.id),
          open_splits:    [...prev.open_splits, { ...split, cleared_in_rec_id: null, cleared_at: null }]
            .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date)),
          totals: {
            ...prev.totals,
            cleared_total: roundCash(prev.totals.cleared_total - signed(split)),
            gap: prev.totals.closing != null
              ? roundCash(prev.totals.closing - (prev.totals.opening + (prev.totals.cleared_total - signed(split))))
              : null,
          },
        };
      } else {
        return {
          ...prev,
          open_splits:    prev.open_splits.filter(s => s.id !== split.id),
          cleared_splits: [...prev.cleared_splits, { ...split, cleared_in_rec_id: importId, cleared_at: nowIso }]
            .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date)),
          totals: {
            ...prev.totals,
            cleared_total: roundCash(prev.totals.cleared_total + signed(split)),
            gap: prev.totals.closing != null
              ? roundCash(prev.totals.closing - (prev.totals.opening + (prev.totals.cleared_total + signed(split))))
              : null,
          },
        };
      }
    });

    setBusy(true);
    try {
      const endpoint = isCleared ? 'unclear-splits' : 'clear-splits';
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_ids: [split.id] }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Failed to update');
        await load();    // re-sync from server
        return;
      }
      onChanged();
    } finally { setBusy(false); }
  }

  /** Save the typed closing balance to the rec via PATCH /bank-imports/[id]. */
  async function saveClosingBalance() {
    if (!editable || !ws) return;
    if (closingDraft.trim() === '' && ws.import.closing_balance == null) return;
    const num = closingDraft.trim() === '' ? null : parseFloat(closingDraft.replace(/[,£\s]/g, ''));
    if (num != null && !Number.isFinite(num)) {
      setError('Closing balance must be a number.');
      return;
    }
    closingSavedAt.current = Date.now();
    const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closing_balance: num }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? 'Failed to save closing balance');
      return;
    }
    // Update local mirror so the gap recalculates without a full reload.
    setWs(prev => prev ? {
      ...prev,
      import: { ...prev.import, closing_balance: num },
      totals: {
        ...prev.totals,
        closing: num,
        gap: num != null ? roundCash(num - (prev.totals.opening + prev.totals.cleared_total)) : null,
      },
    } : prev);
  }

  async function saveNotes() {
    if (!editable || !ws) return;
    if ((notesDraft ?? '') === (ws.import.notes ?? '')) return;
    // The /complete endpoint can also persist notes, but we save on blur
    // so the user doesn't have to remember to hit Reconcile to keep them.
    // PATCH supports notes — we extend the existing body shape here.
    const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesDraft }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      setError(d.error ?? 'Failed to save notes');
      return;
    }
    setWs(prev => prev ? { ...prev, import: { ...prev.import, notes: notesDraft } } : prev);
  }

  async function handleMatchLine(line: BankLine, splitId: string) {
    if (!editable) return;
    setBusy(true);
    try {
      // Use the existing per-line PATCH endpoint — same validations
      // (account match + amount equality) apply.  Once it lands the
      // workspace endpoint /workspace re-fetches the lines so the pair
      // shows up.
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matched_split_id: splitId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Match failed');
        return;
      }
      // Matching a line also clears the split — call clear-splits so the
      // new cleared_in_rec_id column is populated too.  (The old endpoint
      // doesn't touch it; we want both pieces of state in sync.)
      await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/clear-splits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ split_ids: [splitId] }),
      });
      setSelectedLineId(null);
      await load();
      onChanged();
    } finally { setBusy(false); }
  }

  async function handleAbandon() {
    if (!editable) return;
    if (!confirm('Abandon this reconciliation? Cleared items will be un-cleared. You can start fresh after.')) return;
    setBusy(true);
    try {
      // PATCH status → abandoned. Server-side we should also drop the
      // cleared_in_rec_id pointers; for now we do it client-side by calling
      // unclear-splits on everything cleared, then patching status.
      if (ws && ws.cleared_splits.length > 0) {
        await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/unclear-splits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ split_ids: ws.cleared_splits.map(s => s.id) }),
        });
      }
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'abandoned' }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? 'Failed to abandon');
        return;
      }
      onChanged();
      onExit();
    } finally { setBusy(false); }
  }

  async function handleComplete() {
    if (!editable || !ws) return;
    // Flush closing/notes before completing so any unblurred typing lands.
    await saveClosingBalance();
    await saveNotes();
    setBusy(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? 'Failed to complete reconciliation');
        return;
      }
      onChanged();
      onExit();
    } finally { setBusy(false); }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading reconciliation…
      </div>
    );
  }
  if (!ws) {
    // Loader finished but no workspace data came back — surface the error
    // and an obvious way out instead of getting stuck on the spinner.
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <AlertCircle size={20} className="text-rose-500 mb-2" />
        <p className="text-sm font-medium text-slate-800">Couldn’t load this reconciliation.</p>
        {error && <p className="text-xs text-rose-700 mt-1 max-w-md">{error}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={onExit}
            className="text-xs px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const closingSet = ws.totals.closing != null;
  const gapZero    = ws.totals.gap != null && Math.abs(ws.totals.gap) < 0.005;
  const canComplete = editable && closingSet && gapZero;

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50/30">
      {/* ── Top strip — period + back ─────────────────────────────────── */}
      <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft size={12} /> Back
        </button>
        <span className="text-xs text-slate-300">|</span>
        <span className="text-sm font-semibold text-slate-900">
          {ws.import.display_label || ws.import.file_name}
        </span>
        <span className="text-xs text-slate-500">
          {accountName}
          {ws.import.period_start && (
            <> · {formatDateUk(ws.import.period_start)} → {formatDateUk(ws.import.period_end)}</>
          )}
        </span>
        <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
          ws.import.status === 'pending'      ? 'bg-slate-100  text-slate-600' :
          ws.import.status === 'in_progress'  ? 'bg-amber-100  text-amber-800' :
          ws.import.status === 'reconciled'   ? 'bg-emerald-100 text-emerald-800' :
                                                'bg-slate-100  text-slate-500'
        }`}>
          {ws.import.status.replace('_', ' ')}
        </span>
      </div>

      {/* ── Balance strip — opening · cleared · closing · gap ─────────── */}
      <div className="px-4 py-2 border-b border-slate-200 bg-white flex items-center gap-5 text-xs shrink-0">
        <span>
          <span className="text-slate-500">Opening</span>{' '}
          <strong className="tabular-nums text-slate-900">{fmt(ws.totals.opening)}</strong>
        </span>
        <span>
          <span className="text-slate-500">Cleared</span>{' '}
          <strong className={`tabular-nums ${ws.totals.cleared_total < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
            {fmt(ws.totals.cleared_total)}
          </strong>
          <span className="text-slate-400 ml-1">({ws.cleared_splits.length})</span>
        </span>
        {/* Closing + Gap kept together — reading the two side by side
            makes the maths obvious ("statement says X, ledger is Y off").
            The gap pill stays auto-coloured (emerald=zero, amber=non-zero,
            slate-italic when no closing balance has been typed yet). */}
        <span className="flex items-center gap-1.5">
          <label className="text-slate-500">Closing</label>
          <input
            type="text"
            inputMode="decimal"
            value={closingDraft}
            disabled={!editable}
            onChange={e => setClosingDraft(e.target.value)}
            onBlur={() => void saveClosingBalance()}
            placeholder="from statement"
            className="w-28 text-xs text-right tabular-nums rounded border border-slate-200 px-1.5 py-0.5 focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-500"
          />
          <span className="text-slate-500 ml-2">Gap</span>
          {ws.totals.gap == null ? (
            <span className="text-slate-400 italic">type a closing balance</span>
          ) : gapZero ? (
            <span className="px-2 py-0.5 rounded font-semibold tabular-nums bg-emerald-50 text-emerald-700 border border-emerald-200">
              {fmt(ws.totals.gap)}
            </span>
          ) : (
            // Non-zero gap is clickable — opens the diagnostic helper
            // that suggests matching ledger entries or offers a write-off.
            // We always prepend the sign explicitly so the user can read
            // direction at a glance: +X.XX = ledger needs more debits
            // (cleared total below statement); −X.XX = needs more credits.
            <Tooltip label={
              ws.totals.gap > 0
                ? `+${fmt(Math.abs(ws.totals.gap))} below target — cleared total needs to go UP. Click for help.`
                : `−${fmt(Math.abs(ws.totals.gap))} above target — cleared total needs to come DOWN. Click for help.`
            }>
              <button
                type="button"
                onClick={() => setGapHelperOpen(true)}
                className="px-2 py-0.5 rounded font-semibold tabular-nums bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 cursor-pointer"
              >
                {ws.totals.gap > 0 ? '+' : '−'}{fmt(Math.abs(ws.totals.gap))}
              </button>
            </Tooltip>
          )}
        </span>
      </div>

      {error && (
        <div className="px-4 py-1.5 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle size={12} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800"><X size={12} /></button>
        </div>
      )}

      {/* ── Bulk-action bar ────────────────────────────────────────────
          Slides in whenever the user has any ledger row selected. Two
          buttons partition the selection into open-vs-cleared so the
          user can clear and un-clear in one bar without juggling. */}
      {editable && selectedSplitIds.size > 0 && (
        <div className="px-4 py-1.5 border-b border-violet-200 bg-violet-50 text-xs flex items-center gap-2 shrink-0">
          <span className="text-violet-900 font-medium">{selectedSplitIds.size} selected</span>
          <span className="text-violet-500">·</span>
          <span className="text-violet-700">
            {selectedOpen.length} open · {selectedCleared.length} cleared
          </span>
          <button
            type="button"
            onClick={() => void bulkClear()}
            disabled={busy || selectedOpen.length === 0}
            className="ml-3 inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={11} /> Clear {selectedOpen.length || ''}
          </button>
          <button
            type="button"
            onClick={() => void bulkUnclear()}
            disabled={busy || selectedCleared.length === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Un-clear {selectedCleared.length || ''}
          </button>
          {/* Running signed total of the current selection — same convention
              as everywhere else in the workspace (positive = money in,
              negative = money out). Helps the user mentally cross-check
              against a statement line before they pull the trigger. */}
          <span className="ml-3 inline-flex items-center gap-1.5 text-xs">
            <span className="text-violet-700">Total</span>
            <span className={`px-2 py-0.5 rounded font-semibold tabular-nums border ${
              selectedTotal < 0
                ? 'bg-rose-50 text-rose-700 border-rose-200'
                : selectedTotal > 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-white text-slate-600 border-slate-200'
            }`}>
              {fmt(selectedTotal)}
            </span>
          </span>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto text-violet-600 hover:text-violet-900"
          >
            Clear selection
          </button>
          <span className="text-[10px] text-violet-500 ml-2">
            Shift-click for range · Ctrl+click to toggle · Ctrl+A select all · Esc to clear
          </span>
        </div>
      )}

      {/* ── Two columns ──────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-[3fr_2fr]">
        {/* ── Left: ledger entries ────────────────────────────────── */}
        <LedgerColumn
          ws={ws}
          editable={!!editable}
          busy={busy}
          suggestions={suggestions}
          selectedLineId={selectedLineId}
          selectedSplitIds={selectedSplitIds}
          onToggleClear={(s) => void toggleClear(s)}
          onRowClick={handleRowClick}
          onMatchPicked={(s) => {
            if (selectedLine) void handleMatchLine(selectedLine, s.id);
          }}
          rowContextProps={rowActions.rowProps}
        />

        {/* ── Right: statement lines ──────────────────────────────── */}
        <StatementColumn
          ws={ws}
          editable={!!editable}
          selectedLineId={selectedLineId}
          onSelectLine={(id) => setSelectedLineId(prev => prev === id ? null : id)}
          onImportCsv={() => { setCsvMode('transactions'); setCsvOpen(true); }}
          onImportCsvReference={() => { setCsvMode('reference'); setCsvOpen(true); }}
          onPostMissing={() => setPostOpen(true)}
        />
      </div>

      {/* ── Footer — notes + actions ─────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-slate-200 bg-white flex items-center gap-3 shrink-0">
        <NotebookPen size={12} className="text-slate-400" />
        <input
          type="text"
          value={notesDraft}
          disabled={!editable}
          onChange={e => setNotesDraft(e.target.value)}
          onBlur={() => void saveNotes()}
          placeholder="Notes (saved automatically)"
          className="flex-1 text-xs rounded border border-transparent hover:border-slate-200 focus:border-slate-300 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-100 disabled:bg-transparent"
        />

        {editable && (
          <>
            <button
              type="button"
              onClick={() => void handleAbandon()}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-600 disabled:opacity-40"
            >
              <Ban size={11} /> Abandon
            </button>
            <Tooltip label={
              !closingSet ? 'Type the bank statement closing balance first'
              : !gapZero    ? `Gap of ${fmt(ws.totals.gap)} between the cleared ledger total and the statement closing balance`
              : 'Lock cleared entries and finish the reconciliation'
            }>
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={!canComplete || busy}
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold ${
                  canComplete
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Reconcile period
              </button>
            </Tooltip>
          </>
        )}
        {!editable && (
          <span className="text-[11px] text-emerald-700 font-medium inline-flex items-center gap-1">
            <Check size={11} /> Completed {ws.import.reconciled_at && formatDateUk(ws.import.reconciled_at.slice(0, 10))}
          </span>
        )}
      </div>

      {/* ── CSV picker modal — drives two flows ────────────────────────
          • transactions (default): parse + preview, then hand parsed lines
            up via onParsedRows so the Manual sheet can open seeded.
          • reference: parse + preview + POST to /contribute-lines (legacy
            "statement lines as reference" flow). */}
      {csvOpen && (
        <ContributeCsvModal
          bookId={bookId}
          importId={importId}
          accountLabel={accountName}
          mode={csvMode}
          onClose={() => setCsvOpen(false)}
          onContributed={async () => {
            // reference-mode success — workspace reload + close.
            await load();
            onChanged();
          }}
          onParsedRows={(lines) => {
            // transactions-mode success — seed the Manual sheet with the
            // parsed CSV lines and open it. Money-in sign → REC, out → PAY.
            const seeds = lines.map(l => ({
              type: (l.amount < 0 ? 'PAY' : 'REC') as 'PAY' | 'REC',
              dateUk: (() => {
                const [y, m, d] = l.date.split('-');
                return `${d}/${m}/${y}`;
              })(),
              payee:     l.description,
              totalText: Math.abs(l.amount).toFixed(2),
            }));
            setCsvSeedRows(seeds);
            setPostOpen(true);
          }}
        />
      )}

      {/* ── Manual multi-row entry sheet (VT-style grid) ─────────────────
          Opens as a full-screen lightbox over the workspace so the user
          can crack through a long batch of entries without losing their
          place. The sheet is wired with `existingImportId` so every row
          attaches to THIS rec instead of spawning a sibling import. */}
      {postOpen && (
        <div
          className="fixed inset-0 z-[1400] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-6"
          onClick={() => setPostOpen(false)}
        >
          <div
            className="w-full max-w-[1300px] flex flex-col"
            style={{ height: 'calc(100vh - 3rem)' }}
            onClick={e => e.stopPropagation()}
          >
            <ManualBankRecSheet
              bookId={bookId}
              accountId={accountId}
              accountName={accountName}
              vatRegistered={vatRegistered}
              existingImportId={importId}
              defaultDateIso={ws.import.period_end}
              periodStartIso={ws.import.period_start}
              periodEndIso={ws.import.period_end}
              vatLockDate={vatLockDate}
              openingBalance={ws.totals.opening}
              onExistingChanged={async () => {
                // An existing entry was edited / deleted via the sheet's
                // right-click menu — reload the workspace so the merged
                // list inside the sheet refreshes with the new state. The
                // user's drafts (local sheet state) survive unchanged.
                await load();
                onChanged();
              }}
              // Flatten cleared + open splits into the shape the sheet
              // needs. We rely on the existing payee_text/details on the
              // transaction and the signed-amount convention used
              // everywhere else in the workspace.
              existingEntries={[...ws.cleared_splits, ...ws.open_splits].map(s => {
                const t = Array.isArray(s.transaction) ? s.transaction[0] : s.transaction;
                return {
                  split_id:       s.id,
                  transaction_id: s.transaction_id,
                  type:           t?.type ?? '',
                  ref_no:         t?.ref_no ?? '',
                  date_iso:       t?.date ?? '',
                  payee:          t?.payee_text ?? t?.details ?? '',
                  signed_amount:  Number(s.debit) - Number(s.credit),
                  cleared:        s.cleared_in_rec_id != null,
                  analysis_account_name: s.analysis_account_name,
                  analysis_ledger:       s.analysis_ledger,
                  vat_total:             Number(t?.vat_total ?? 0),
                };
              })}
              seedRows={csvSeedRows ?? undefined}
              onClose={() => {
                setPostOpen(false);
                // Clear CSV seed rows so a subsequent "+ Manual" click
                // opens with a blank row, not the previous CSV's rows.
                setCsvSeedRows(null);
              }}
              onPosted={async () => {
                setPostOpen(false);
                setCsvSeedRows(null);
                await load();
                onChanged();
              }}
            />
          </div>
        </div>
      )}

      {/* ── Gap-helper diagnostic modal ─────────────────────────────────
          Renders when the user clicks the non-zero gap pill. Provides
          three exits: tick a matching open entry, un-tick a matching
          cleared entry, or post a write-off. All three close the gap. */}
      {gapHelperOpen && ws.totals.gap != null && Math.abs(ws.totals.gap) >= 0.005 && (
        <GapHelperModal
          bookId={bookId}
          importId={importId}
          accountId={accountId}
          accountName={accountName}
          gap={ws.totals.gap}
          periodEndIso={ws.import.period_end}
          openSplits={ws.open_splits}
          clearedSplits={ws.cleared_splits}
          onClose={() => setGapHelperOpen(false)}
          onClearSplits={async (ids) => {
            const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/clear-splits`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ split_ids: ids }),
            });
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              throw new Error(d.error ?? 'Clear failed');
            }
            await load();
            onChanged();
          }}
          onUnclearSplits={async (ids) => {
            const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/unclear-splits`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ split_ids: ids }),
            });
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              throw new Error(d.error ?? 'Un-clear failed');
            }
            await load();
            onChanged();
          }}
          onWroteOff={async () => {
            await load();
            onChanged();
          }}
          onFlipped={async () => {
            await load();
            onChanged();
          }}
        />
      )}

      {/* ── Row-action menus (right-click context menu + edit / duplicate
            / delete / audit / change-type modals) ─────────────────────
          Same hook the dashboard transaction lists use. Mounted here so
          its modals (which portal to body) don't get clipped by the
          workspace's flex container. */}
      {rowActions.menus}
    </div>
  );
}

function roundCash(n: number): number { return Math.round(n * 100) / 100; }

// ── Left column ───────────────────────────────────────────────────────────
function LedgerColumn({
  ws, editable, busy, suggestions, selectedLineId, selectedSplitIds,
  onToggleClear, onRowClick, onMatchPicked, rowContextProps,
}: {
  ws: Workspace;
  editable: boolean;
  busy: boolean;
  suggestions: Set<string>;
  selectedLineId: string | null;
  selectedSplitIds: Set<string>;
  onToggleClear: (s: SplitRow) => void;
  onRowClick: (s: SplitRow, ev: React.MouseEvent) => void;
  onMatchPicked: (s: SplitRow) => void;
  /** Right-click handler from useTransactionRowActions. Spread onto each
   *  ledger row — opens the same context menu used in the dashboard
   *  transaction lists. Returns { className: 'group', onContextMenu }; we
   *  merge `group` into the row's existing className. */
  rowContextProps: (t: Transaction) => { className: string; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const periodStart = ws.import.period_start ?? '';
  // Split open_splits into "brought forward" (dated before period start)
  // and "in period" so the user can see legacy uncleared items separately.
  const bf  = ws.open_splits.filter(s => s.transaction.date <  periodStart);
  const inP = ws.open_splits.filter(s => s.transaction.date >= periodStart);

  return (
    <div className="border-r border-slate-200 flex flex-col min-h-0 bg-white">
      <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50/50 text-[11px] uppercase tracking-wide text-slate-500 font-semibold shrink-0 flex items-center gap-2">
        Ledger entries
        <span className="text-slate-300">·</span>
        <span className="text-slate-500 normal-case font-normal">
          {ws.cleared_splits.length} cleared · {ws.open_splits.length} open
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {bf.length > 0 && (
          <SplitGroup
            title="Brought forward (uncleared from earlier)"
            tone="amber"
            splits={bf}
            cleared={false}
            editable={editable}
            busy={busy}
            suggestions={suggestions}
            selectedLineId={selectedLineId}
            selectedSplitIds={selectedSplitIds}
            onToggle={onToggleClear}
            onRowClick={onRowClick}
            onMatchPicked={onMatchPicked}
            rowContextProps={rowContextProps}
          />
        )}
        {ws.cleared_splits.length > 0 && (
          <SplitGroup
            title="Cleared in this rec"
            tone="emerald"
            splits={ws.cleared_splits}
            cleared={true}
            editable={editable}
            busy={busy}
            suggestions={suggestions}
            selectedLineId={selectedLineId}
            selectedSplitIds={selectedSplitIds}
            onToggle={onToggleClear}
            onRowClick={onRowClick}
            onMatchPicked={onMatchPicked}
            rowContextProps={rowContextProps}
          />
        )}
        {inP.length > 0 && (
          <SplitGroup
            title="Open entries in period"
            tone="slate"
            splits={inP}
            cleared={false}
            editable={editable}
            busy={busy}
            suggestions={suggestions}
            selectedLineId={selectedLineId}
            selectedSplitIds={selectedSplitIds}
            onToggle={onToggleClear}
            onRowClick={onRowClick}
            onMatchPicked={onMatchPicked}
            rowContextProps={rowContextProps}
          />
        )}
        {bf.length === 0 && inP.length === 0 && ws.cleared_splits.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-slate-400 italic">
            No ledger entries on this account in or before the rec period.
          </div>
        )}
      </div>
    </div>
  );
}

function SplitGroup({
  title, tone, splits, cleared, editable, busy, suggestions, selectedLineId,
  selectedSplitIds, onToggle, onRowClick, onMatchPicked, rowContextProps,
}: {
  title: string;
  tone: 'slate' | 'amber' | 'emerald';
  splits: SplitRow[];
  cleared: boolean;
  editable: boolean;
  busy: boolean;
  suggestions: Set<string>;
  selectedLineId: string | null;
  selectedSplitIds: Set<string>;
  onToggle: (s: SplitRow) => void;
  onRowClick: (s: SplitRow, ev: React.MouseEvent) => void;
  onMatchPicked: (s: SplitRow) => void;
  rowContextProps: (t: Transaction) => { className: string; onContextMenu: (e: React.MouseEvent) => void };
}) {
  const toneCls = tone === 'amber'
    ? 'bg-amber-50/40 text-amber-800'
    : tone === 'emerald'
      ? 'bg-emerald-50/40 text-emerald-800'
      : 'bg-slate-50/60 text-slate-600';
  return (
    <div>
      <div className={`px-3 py-1 text-[10px] uppercase tracking-wide font-semibold border-y border-slate-100 ${toneCls}`}>
        {title} <span className="font-normal opacity-70">({splits.length})</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {splits.map(s => {
            const amt = signed(s);
            const isSuggested = !cleared && suggestions.has(s.id);
            const isSelected  = selectedSplitIds.has(s.id);
            const canPickToMatch = !!selectedLineId && isSuggested && editable;
            // Resolve the embedded transaction defensively — PostgREST
            // returns it as object or array depending on cardinality.
            const t = Array.isArray(s.transaction) ? s.transaction[0] : s.transaction;
            // Minimal Transaction-shaped seed for the row actions hook.
            // The Edit modal fetches the full row by txId on mount, so a
            // partial is enough to drive the menu + open the editor.
            const txnSeed: Transaction = {
              id: t?.id ?? s.transaction_id,
              book_id: '', // hook doesn't read this; modal re-fetches
              type: (t?.type ?? 'PAY') as TransactionType,
              ref_no: t?.ref_no ?? '',
              ref_seq: 0,
              date: t?.date ?? '',
              payee_text: t?.payee_text ?? null,
              details: t?.details ?? null,
              total: 0,
              vat_total: 0,
              vat_rate: null,
              vat_treatment: null,
              vat_period_override: null,
              primary_account_id: null,
              status: 'posted',
              created_by: null,
              created_at: '',
              updated_at: '',
              posted_at: null,
            } as Transaction;
            const ctx = rowContextProps(txnSeed);
            return (
              <tr
                key={s.id}
                className={`${ctx.className} border-b border-slate-50 transition-colors ${
                  isSelected
                    ? 'bg-violet-100 hover:bg-violet-200'
                    : canPickToMatch
                      ? 'bg-amber-50/70 hover:bg-amber-100 cursor-pointer'
                      : isSuggested
                        ? 'bg-amber-50/30'
                        : cleared
                          ? 'bg-emerald-50/20 hover:bg-emerald-50/40'
                          : 'hover:bg-slate-50'
                } ${editable ? 'cursor-pointer' : ''}`}
                onClick={(ev) => {
                  if (canPickToMatch) { onMatchPicked(s); return; }
                  onRowClick(s, ev);
                }}
                onContextMenu={ctx.onContextMenu}
              >
                {/* Tick */}
                <td className="px-2 py-1 w-6 text-center">
                  <button
                    type="button"
                    onClick={ev => { ev.stopPropagation(); if (editable) onToggle(s); }}
                    disabled={!editable || busy}
                    aria-label={cleared ? 'Untick (un-clear)' : 'Tick (clear)'}
                    className={`inline-flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                      cleared
                        ? 'bg-emerald-500 border-emerald-600 text-white'
                        : 'bg-white border-slate-300 hover:border-emerald-400'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {cleared && <Check size={10} strokeWidth={3} />}
                  </button>
                </td>
                <td className="px-2 py-1 text-slate-700 tabular-nums w-16 whitespace-nowrap">
                  {formatDateUk(s.transaction.date)}
                </td>
                <td className="px-2 py-1 w-20 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                  {/* TxnRefLink gives us the T-account hover preview for
                      free (debits-on-top, credits-below) — same component
                      the dashboard ledgers use, so the popover is
                      consistent across the module. Click navigates to the
                      type-list view; we stopPropagation so the row's own
                      onClick (selection toggle) doesn't fire too. */}
                  <TxnRefLink
                    txn={{
                      id: t?.id ?? s.transaction_id,
                      type: (t?.type ?? 'PAY') as TransactionType,
                      ref_no: t?.ref_no ?? '',
                      date: t?.date,
                    }}
                  />
                </td>
                <td className="px-2 py-1 text-slate-900 truncate max-w-[260px]">
                  {s.transaction.payee_text || s.transaction.details || s.entry_details}
                  {isSuggested && (
                    <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-amber-700">
                      <Sparkles size={9} /> match?
                    </span>
                  )}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums w-20 ${amt < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                  {fmt(amt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Right column ──────────────────────────────────────────────────────────
function StatementColumn({
  ws, editable, selectedLineId, onSelectLine, onImportCsv, onImportCsvReference, onPostMissing,
}: {
  ws: Workspace;
  editable: boolean;
  selectedLineId: string | null;
  onSelectLine: (id: string) => void;
  /** Primary CSV path — parses + opens the Manual sheet seeded with rows
   *  for review/allocate/post. */
  onImportCsv: () => void;
  /** Secondary CSV path — POSTs straight to /contribute-lines as
   *  reference statement lines (no ledger transactions). Surfaced as a
   *  small inline link below the chips. */
  onImportCsvReference: () => void;
  onPostMissing: () => void;
}) {
  return (
    <div className="flex flex-col min-h-0 bg-white">
      <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50/50 text-[11px] uppercase tracking-wide text-slate-500 font-semibold shrink-0 flex items-center gap-2">
        Statement lines
        <span className="text-slate-300">·</span>
        <span className="text-slate-500 normal-case font-normal">
          {ws.lines.length === 0 ? 'optional — none added yet' : `${ws.lines.filter(l => l.matched_split_id).length}/${ws.lines.length} paired`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {ws.lines.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-500 text-center">
            <p>Add statement lines, or post a missing entry inline:</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MethodChip icon={Upload}   label="Import CSV"  onClick={editable ? onImportCsv    : undefined} />
              <MethodChip icon={Pencil}   label="Manual"      onClick={editable ? onPostMissing : undefined} />
              <MethodChip icon={FileScan} label="PDF"         disabled comingSoon />
              <MethodChip icon={Cable}    label="Link feed"   disabled comingSoon />
            </div>
            {/* Legacy "statement lines only" flow tucked under the chips
                as an inline link — used only when the user already has
                ledger entries posted and just wants the CSV as a tick-off
                checklist. The chip above is the common case. */}
            {editable && (
              <p className="text-[11px] mt-3">
                <button
                  type="button"
                  onClick={onImportCsvReference}
                  className="text-indigo-600 hover:text-indigo-800 underline decoration-dotted underline-offset-2"
                >
                  Or import CSV as reference lines only →
                </button>
              </p>
            )}
            <p className="text-[10px] text-slate-400 mt-2 italic">
              You can also reconcile without any statement lines — just tick the ledger entries that appear on your bank statement.
            </p>
          </div>
        ) : (
          <>
            <table className="w-full text-xs">
              <tbody>
                {ws.lines.map(l => {
                  const isSelected = l.id === selectedLineId;
                  const isMatched  = l.matched_split_id != null;
                  return (
                    <tr
                      key={l.id}
                      onClick={() => editable && !isMatched && onSelectLine(l.id)}
                      className={`border-b border-slate-50 transition-colors ${
                        isSelected
                          ? 'bg-indigo-50'
                          : isMatched
                            ? 'bg-emerald-50/30'
                            : editable
                              ? 'hover:bg-slate-50 cursor-pointer'
                              : ''
                      }`}
                    >
                      <td className="px-2 py-1 w-6 text-center">
                        {isMatched
                          ? <Check size={11} className="text-emerald-600 inline-block" />
                          : <span className="inline-block w-3 h-3 rounded-sm border border-slate-300" />}
                      </td>
                      <td className="px-2 py-1 text-slate-700 tabular-nums w-16">{formatDateUk(l.date)}</td>
                      <td className="px-2 py-1 text-slate-900 truncate max-w-[200px]">{l.description || <span className="text-slate-400 italic">—</span>}</td>
                      <td className={`px-2 py-1 text-right tabular-nums w-20 ${l.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                        {fmt(l.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-2 bg-slate-50/40 flex-wrap">
              <MethodChip icon={Upload}   label="+ Import more"  onClick={editable ? onImportCsv    : undefined} />
              <MethodChip icon={Pencil}   label="+ Manual"        onClick={editable ? onPostMissing : undefined} />
              <MethodChip icon={FileScan} label="+ PDF"           disabled comingSoon />
              {editable && (
                <button
                  type="button"
                  onClick={onImportCsvReference}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 underline decoration-dotted underline-offset-2 ml-auto"
                >
                  …or import as reference only →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MethodChip({
  icon: Icon, label, onClick, disabled, comingSoon,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  comingSoon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`relative inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${
        disabled
          ? 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed'
          : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 bg-white'
      }`}
    >
      <Icon size={11} />
      <span>{label}</span>
      {comingSoon && (
        <span className="ml-1 text-[9px] uppercase tracking-wide px-1 py-0.5 rounded bg-amber-100 text-amber-700">soon</span>
      )}
    </button>
  );
}

// Silence unused-import warning while MoreVertical is reserved for future
// "rec menu" (rename, delete, etc.).
void MoreVertical;
