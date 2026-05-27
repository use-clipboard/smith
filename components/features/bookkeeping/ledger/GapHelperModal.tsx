'use client';

/**
 * GapHelperModal — diagnostic helper that opens when the user clicks a
 * non-zero gap pill on the bank-rec workspace.
 *
 * Tries to answer "where's my £X.XX coming from?" in order:
 *   1. Open splits on this account with a signed amount matching the gap
 *      → "you probably forgot to tick these" (one-click clear).
 *   2. Already-cleared splits with the OPPOSITE-signed amount of the gap
 *      → "you may have over-ticked these" (one-click un-clear).
 *   3. Nothing matches → propose a write-off entry that posts the gap to
 *      a P&L account and auto-clears it in this rec.
 *
 * For the write-off, we use PAY for a negative gap (money the bank thinks
 * went out but isn't on the ledger) and REC for a positive gap (the
 * opposite). This is the standard bank-rec adjustment treatment used by
 * accountants — analysis side goes to a "Bank reconciliation differences"
 * P&L account (the user picks; we default to the last one used).
 */

import { useMemo, useState } from 'react';
import {
  X, Loader2, AlertCircle, Check, Sparkles, ArrowDown, ArrowUp, Eraser, RefreshCw,
} from 'lucide-react';
import LedgerPicker from '../input/LedgerPicker';
import AccountPicker from '../input/AccountPicker';
import DateInput, { parseUkDateStrict, fromIso } from '../input/DateInput';
import type { BookAccountRef } from '@/types/bookkeeping';

export interface GapSplit {
  id: string;
  transaction_id: string;
  debit: number;
  credit: number;
  cleared_in_rec_id: string | null;
  transaction:
    | { id: string; type: string; ref_no: string; date: string; details: string | null; payee_text: string | null }
    | Array<{ id: string; type: string; ref_no: string; date: string; details: string | null; payee_text: string | null }>;
}

interface Props {
  bookId: string;
  importId: string;
  accountId: string;
  accountName: string;
  /** Signed amount of the current gap. Positive = bank needs more debits
   *  (i.e. an income/REC entry is missing OR a PAY was wrongly cleared).
   *  Negative = bank needs more credits. */
  gap: number;
  /** Active period end — used as the default date on the write-off entry. */
  periodEndIso: string | null;
  /** Splits to scan for matches. */
  openSplits: GapSplit[];
  clearedSplits: GapSplit[];
  onClose: () => void;
  /** Bulk-clear via the workspace's existing handler. */
  onClearSplits: (ids: string[]) => Promise<void> | void;
  /** Bulk-unclear via the workspace's existing handler. */
  onUnclearSplits: (ids: string[]) => Promise<void> | void;
  /** Fires after a successful write-off post so the workspace reloads. */
  onWroteOff: () => void;
  /** Fires after any wrong-direction flip so the workspace reloads. */
  onFlipped: () => void;
}

function formatDateUk(iso?: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
function fmt(n: number): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function signed(s: GapSplit): number { return Number(s.debit) - Number(s.credit); }
function txn(s: GapSplit) {
  return Array.isArray(s.transaction) ? s.transaction[0] : s.transaction;
}

export default function GapHelperModal({
  bookId, importId, accountId, accountName, gap,
  periodEndIso, openSplits, clearedSplits,
  onClose, onClearSplits, onUnclearSplits, onWroteOff, onFlipped,
}: Props) {
  void accountId;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'suggest' | 'writeoff'>('suggest');

  // ── Direct suggestions (exact amount match) ────────────────────────────
  // OPEN splits with amount == gap → ticking them closes the gap directly.
  // CLEARED splits with amount == -gap → un-ticking them also closes it
  // (over-cleared scenario).
  const openMatches = useMemo(
    () => openSplits.filter(s => Math.abs(signed(s) - gap) < 0.005),
    [openSplits, gap],
  );
  const clearedMatches = useMemo(
    () => clearedSplits.filter(s => Math.abs(signed(s) + gap) < 0.005),
    [clearedSplits, gap],
  );

  // ── Wrong-direction suggestions (PAY/REC mix-up) ───────────────────────
  // Only PAY / CHQ / REC transactions are flippable (the helper endpoint
  // enforces this — JRN, SIN, PIN etc. would need a manual edit).
  //
  // Case 1 — open split with signed amount = -gap.
  //   E.g. gap +45, an open PAY for -45 in the period. Flipping it to REC
  //   would make the bank side +45, and ticking it adds +45 to cleared →
  //   gap closes. We surface these as "might be wrong PAY/REC type".
  //
  // Case 2 — already-cleared split with signed amount = -gap/2.
  //   E.g. gap +45, a cleared PAY for -22.50. Flipping it to REC swings
  //   cleared by 2×22.50 = +45 (the delta between -22.50 and +22.50)
  //   → gap closes. The split stays cleared in this rec (the type change
  //   doesn't touch cleared_in_rec_id), so no extra clear/un-clear needed.
  const flippable = (s: GapSplit) => {
    const t = txn(s)?.type;
    return t === 'PAY' || t === 'CHQ' || t === 'REC';
  };
  const flipOpenCandidates = useMemo(
    () => openSplits.filter(s => flippable(s) && Math.abs(signed(s) + gap) < 0.005),
    [openSplits, gap],
  );
  const flipClearedCandidates = useMemo(
    () => clearedSplits.filter(s => flippable(s) && Math.abs(signed(s) * 2 + gap) < 0.005),
    [clearedSplits, gap],
  );

  const noSuggestions =
    openMatches.length === 0 &&
    clearedMatches.length === 0 &&
    flipOpenCandidates.length === 0 &&
    flipClearedCandidates.length === 0;

  // ── Flip a single transaction ──────────────────────────────────────────
  async function flipAndMaybeClear(split: GapSplit, alsoClear: boolean) {
    setBusy(true); setError(null);
    try {
      const t = txn(split);
      if (!t) { setError('Couldn’t resolve the transaction.'); return; }
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${t.id}/flip-direction`, {
        method: 'POST',
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? d.message ?? 'Flip failed');
        return;
      }
      // If this was an open candidate, tick the (now correct-direction)
      // split so it lands in the cleared section of the rec.
      if (alsoClear) {
        await onClearSplits([split.id]);
      } else {
        // Just reload — the cleared total will update once the workspace
        // re-fetches the flipped split.
        onFlipped();
      }
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-[640px] max-w-full shadow-2xl border border-amber-200 flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header — explicit sign + plain-English direction hint so the
            user knows whether they're above or below the bank's target. */}
        <div className="px-5 py-3 border-b border-amber-200 bg-amber-50/60">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-700" />
            <h2 className="text-sm font-semibold text-amber-900">
              Closing the {gap < 0 ? '−' : '+'}{fmt(Math.abs(gap))} gap
            </h2>
            <span className="text-xs text-amber-700/80">on {accountName}</span>
            <button onClick={onClose} aria-label="Close" className="ml-auto text-amber-700 hover:text-amber-900">
              <X size={16} />
            </button>
          </div>
          <p className="text-[11px] text-amber-800/80 mt-1 pl-6">
            {gap > 0
              ? 'Cleared total is below the bank statement closing balance — you need to tick something worth +£' + fmt(Math.abs(gap)) + '.'
              : 'Cleared total is above the bank statement closing balance — you need to untick something worth £' + fmt(Math.abs(gap)) + ' of money out.'}
          </p>
        </div>

        {error && (
          <div className="px-5 py-2 bg-rose-50 border-b border-rose-200 text-rose-800 text-xs flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800"><X size={11} /></button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {mode === 'suggest' && (
            <SuggestPane
              gap={gap}
              openMatches={openMatches}
              clearedMatches={clearedMatches}
              flipOpenCandidates={flipOpenCandidates}
              flipClearedCandidates={flipClearedCandidates}
              noSuggestions={noSuggestions}
              busy={busy}
              onClearOne={async (id) => {
                setBusy(true); setError(null);
                try { await onClearSplits([id]); onClose(); }
                catch (e) { setError(String(e)); }
                finally { setBusy(false); }
              }}
              onUnclearOne={async (id) => {
                setBusy(true); setError(null);
                try { await onUnclearSplits([id]); onClose(); }
                catch (e) { setError(String(e)); }
                finally { setBusy(false); }
              }}
              onFlipOpen={(s) => void flipAndMaybeClear(s, true)}
              onFlipCleared={(s) => void flipAndMaybeClear(s, false)}
              onGotoWriteoff={() => setMode('writeoff')}
            />
          )}
          {mode === 'writeoff' && (
            <WriteOffPane
              bookId={bookId}
              importId={importId}
              gap={gap}
              defaultDateIso={periodEndIso}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onCancel={() => setMode('suggest')}
              onPosted={() => { onWroteOff(); onClose(); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Suggest pane ──────────────────────────────────────────────────────────
function SuggestPane({
  gap, openMatches, clearedMatches, flipOpenCandidates, flipClearedCandidates,
  noSuggestions, busy,
  onClearOne, onUnclearOne, onFlipOpen, onFlipCleared, onGotoWriteoff,
}: {
  gap: number;
  openMatches: GapSplit[];
  clearedMatches: GapSplit[];
  flipOpenCandidates: GapSplit[];
  flipClearedCandidates: GapSplit[];
  noSuggestions: boolean;
  busy: boolean;
  onClearOne: (id: string) => Promise<void>;
  onUnclearOne: (id: string) => Promise<void>;
  onFlipOpen: (s: GapSplit) => void;
  onFlipCleared: (s: GapSplit) => void;
  onGotoWriteoff: () => void;
}) {
  return (
    <>
      <p className="text-xs text-slate-600 mb-3">
        Looking for ledger entries worth <strong className="text-slate-900 tabular-nums">{gap < 0 ? '−' : '+'}{fmt(Math.abs(gap))}</strong> that would close the gap.
      </p>

      {openMatches.length > 0 && (
        <section className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold mb-1.5 flex items-center gap-1">
            <ArrowDown size={11} /> Open entries on this account that match
          </p>
          <p className="text-[11px] text-slate-500 mb-2">
            Ticking one of these closes the gap directly — you probably just forgot to clear it.
          </p>
          <ul className="space-y-1">
            {openMatches.map(s => (
              <SuggestionRow
                key={s.id}
                split={s}
                actionLabel="Tick this"
                actionIcon={<Check size={11} />}
                disabled={busy}
                onAction={() => void onClearOne(s.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {clearedMatches.length > 0 && (
        <section className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-amber-700 font-semibold mb-1.5 flex items-center gap-1">
            <ArrowUp size={11} /> Cleared entries with the opposite amount
          </p>
          <p className="text-[11px] text-slate-500 mb-2">
            Un-ticking one of these would also close the gap — possible if you over-cleared earlier.
          </p>
          <ul className="space-y-1">
            {clearedMatches.map(s => (
              <SuggestionRow
                key={s.id}
                split={s}
                actionLabel="Un-tick"
                actionIcon={<Eraser size={11} />}
                disabled={busy}
                onAction={() => void onUnclearOne(s.id)}
              />
            ))}
          </ul>
        </section>
      )}

      {flipOpenCandidates.length > 0 && (
        <section className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold mb-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Wrong PAY/REC direction? — open entries
          </p>
          <p className="text-[11px] text-slate-500 mb-2">
            These entries match the gap amount but post in the opposite direction.
            If one was entered as a {gap > 0 ? 'PAY when it should be a REC' : 'REC when it should be a PAY'},
            flipping its type and ticking it will close the gap.
          </p>
          <ul className="space-y-1">
            {flipOpenCandidates.map(s => {
              const t = txn(s);
              const target = t?.type === 'REC' ? 'PAY' : 'REC';
              return (
                <SuggestionRow
                  key={s.id}
                  split={s}
                  actionLabel={`Flip to ${target} & tick`}
                  actionIcon={<RefreshCw size={11} />}
                  disabled={busy}
                  onAction={() => onFlipOpen(s)}
                />
              );
            })}
          </ul>
        </section>
      )}

      {flipClearedCandidates.length > 0 && (
        <section className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-violet-700 font-semibold mb-1.5 flex items-center gap-1">
            <RefreshCw size={11} /> Wrong PAY/REC direction? — cleared entries
          </p>
          <p className="text-[11px] text-slate-500 mb-2">
            These cleared entries are worth half the gap with the opposite sign.
            Flipping the type doubles the swing (e.g. −22.50 PAY → +22.50 REC = +45 to cleared),
            which closes the gap.
          </p>
          <ul className="space-y-1">
            {flipClearedCandidates.map(s => {
              const t = txn(s);
              const target = t?.type === 'REC' ? 'PAY' : 'REC';
              return (
                <SuggestionRow
                  key={s.id}
                  split={s}
                  actionLabel={`Flip to ${target}`}
                  actionIcon={<RefreshCw size={11} />}
                  disabled={busy}
                  onAction={() => onFlipCleared(s)}
                />
              );
            })}
          </ul>
        </section>
      )}

      {noSuggestions && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-600">
          <p className="font-medium text-slate-800 mb-1">No matching ledger entries found.</p>
          <p>
            That usually means either a transaction hasn&apos;t been posted yet, or the difference is a small adjustment
            (bank charge, interest, rounding) you&apos;d normally write off.
          </p>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
        <button
          type="button"
          onClick={onGotoWriteoff}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Eraser size={11} />}
          Write off the {gap < 0 ? '−' : '+'}{fmt(Math.abs(gap))} gap
        </button>
        <span className="text-[11px] text-slate-500">
          Posts a {gap < 0 ? 'PAY' : 'REC'} to a P&amp;L account &amp; auto-clears in this rec.
        </span>
      </div>
    </>
  );
}

function SuggestionRow({
  split, actionLabel, actionIcon, disabled, onAction,
}: {
  split: GapSplit;
  actionLabel: string;
  actionIcon: React.ReactNode;
  disabled: boolean;
  onAction: () => void;
}) {
  const t = txn(split);
  const amt = signed(split);
  return (
    <li className="rounded-md border border-slate-200 px-3 py-2 flex items-center gap-3 text-xs bg-white">
      <span className="text-slate-700 tabular-nums w-16 shrink-0">{formatDateUk(t?.date)}</span>
      <span className="text-indigo-700 w-20 shrink-0 truncate">{t?.ref_no}</span>
      <span className="text-slate-900 flex-1 min-w-0 truncate">
        {t?.payee_text || t?.details || '—'}
      </span>
      <span className={`tabular-nums w-20 text-right ${amt < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
        {fmt(amt)}
      </span>
      <button
        type="button"
        onClick={onAction}
        disabled={disabled}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-slate-700 disabled:opacity-40"
      >
        {actionIcon}
        {actionLabel}
      </button>
    </li>
  );
}

// ── Write-off pane ────────────────────────────────────────────────────────
function WriteOffPane({
  bookId, importId, gap, defaultDateIso, busy, setBusy, setError, onCancel, onPosted,
}: {
  bookId: string;
  importId: string;
  gap: number;
  defaultDateIso: string | null;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (s: string | null) => void;
  onCancel: () => void;
  onPosted: () => void;
}) {
  // gap > 0 → bank needs MORE debits → REC (money in)
  // gap < 0 → bank needs MORE credits → PAY (money out)
  const type: 'PAY' | 'REC' = gap > 0 ? 'REC' : 'PAY';
  const total = Math.abs(gap);

  const [date, setDate] = useState<string>(defaultDateIso ? fromIso(defaultDateIso) : fromIso(new Date().toISOString().slice(0, 10)));
  const [details, setDetails] = useState<string>('Bank reconciliation adjustment');
  // For REC the analysis ledger is income; for PAY it's expenses.
  // The user can flip the ledger if they want to post against another P&L code.
  const [analysisLedger, setAnalysisLedger] = useState<string>(type === 'REC' ? 'Income' : 'Expenses');
  const [analysis, setAnalysis] = useState<BookAccountRef | null>(null);

  async function handleSubmit() {
    setError(null);
    const dateIso = parseUkDateStrict(date);
    if (!dateIso) { setError(`${date} isn't a valid date (dd/mm/yyyy).`); return; }
    if (!analysis) { setError('Pick the P&L account to write the adjustment to.'); return; }

    setBusy(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/bank-imports/${importId}/post-and-clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          date: dateIso,
          payee_text: details.trim() || null,
          details: details.trim() || null,
          total,
          vat_total: 0,
          vat_rate: null,
          vat_treatment: 'no_vat',
          analysis_account_id: analysis.id,
          entry_details: `Auto write-off of bank rec gap (${gap < 0 ? '−' : '+'}${total.toFixed(2)}).`,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error ?? 'Failed to post adjustment');
        return;
      }
      onPosted();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-xs text-slate-600 mb-3">
        Posts a <strong className="text-slate-900">{type}</strong> for <strong className="tabular-nums">{fmt(total)}</strong> and ticks it off in this rec.
        The opposite leg goes to the P&amp;L account you pick below — typically a &quot;Bank reconciliation differences&quot; or &quot;Sundry&quot; code.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Date</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Description</label>
          <input
            type="text"
            value={details}
            onChange={e => setDetails(e.target.value)}
            className="w-full text-sm rounded-md border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            placeholder="Bank reconciliation adjustment"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Ledger</label>
          <LedgerPicker
            value={analysisLedger}
            onChange={l => { setAnalysisLedger(l); if (analysis && analysis.ledger !== l) setAnalysis(null); }}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Write-off account</label>
          <AccountPicker
            bookId={bookId}
            value={analysis?.id ?? null}
            valueDisplay={analysis?.name}
            onChange={a => { setAnalysis(a); if (a?.ledger) setAnalysisLedger(a.ledger); }}
            ledgerFilter={analysisLedger || undefined}
            disabled={!analysisLedger}
            placeholder={analysisLedger ? 'Account…' : 'Pick ledger first'}
          />
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
        <button onClick={onCancel} disabled={busy} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">
          ← Back
        </button>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
        >
          {busy ? <><Loader2 size={11} className="animate-spin" /> Posting…</> : <><Check size={11} /> Post &amp; clear</>}
        </button>
      </div>
    </>
  );
}
