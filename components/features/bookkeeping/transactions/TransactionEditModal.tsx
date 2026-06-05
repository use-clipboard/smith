'use client';

/**
 * TransactionEditModal — focused edit + duplicate form for a single posted
 * transaction. Two modes:
 *
 *   • 'edit'      — loads the transaction, lets the user change header +
 *                   splits, PATCHes on save. Ref number is preserved.
 *   • 'duplicate' — loads the transaction as a starting point but the date
 *                   defaults to today and POSTs a brand new transaction
 *                   with a freshly-allocated ref on save.
 *
 * The form auto-picks the right shape based on the transaction's type:
 *   • Universal shape (PAY / CHQ / REC / TRF / SIN / SCR / PIN / PCR):
 *     single-row form with primary account, details, total, VAT treatment,
 *     analysis ledger + account, entry details.
 *   • Journal shape (JRN / RJN):
 *     Dr/Cr table with multiple lines, balance check.
 *
 * The pickers (AccountPicker, LedgerPicker, DateInput) and the VAT-routed
 * split-building logic are reused from the input sheets so behaviour stays
 * consistent.
 */

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, X, Pencil, Copy as CopyIcon, Plus, Trash2 } from 'lucide-react';
import AccountPicker from '../input/AccountPicker';
import LedgerPicker from '../input/LedgerPicker';
import DateInput, { parseUkDateStrict, fromIso } from '../input/DateInput';
import { getTypeConfig, TRANSACTION_TYPE_CONFIG } from '@/lib/bookkeeping/transactionTypeConfig';
import { buildSplits } from '@/lib/bookkeeping/buildSplits';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';
import {
  VAT_TREATMENT_OPTIONS,
  type BookAccountRef, type Transaction, type TransactionType, type VatTreatment,
} from '@/types/bookkeeping';

interface Props {
  open: boolean;
  mode: 'edit' | 'duplicate';
  bookId: string;
  /** The transaction id to load. The component fetches the full transaction
   *  with splits on mount; passing the partial transaction in `seed` keeps
   *  the header static while the splits load. */
  txId: string;
  /** Optional partial transaction to render the header instantly. */
  seed?: Partial<Transaction>;
  /** Book-level VAT flags so the form knows whether to show the VAT column
   *  and respect the VAT lock for late-entry prompts. */
  vatRegistered: boolean;
  vatLockDate: string | null;
  onClose: () => void;
  onSaved: (txn: Transaction) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function rateFor(t: VatTreatment): number {
  return VAT_TREATMENT_OPTIONS.find(o => o.id === t)?.rate ?? 0;
}
function splitVatFromGross(total: number, rate: number) {
  if (rate <= 0) return { vat: 0, net: total };
  const net = +(total / (1 + rate / 100)).toFixed(2);
  return { vat: +(total - net).toFixed(2), net };
}
function parseAmount(s: string): number {
  return parseFloat(s.replace(/[,£\s]/g, '')) || 0;
}

interface JournalLine {
  id: string;
  account: BookAccountRef | null;
  ledger: string;
  description: string;
  debitText: string;
  creditText: string;
}

function makeBlankJournalLine(): JournalLine {
  return {
    id: Math.random().toString(36).slice(2),
    account: null,
    ledger: '',
    description: '',
    debitText: '',
    creditText: '',
  };
}

// ── Component ──────────────────────────────────────────────────────────────
export default function TransactionEditModal({
  open, mode, bookId, txId, seed, vatRegistered, vatLockDate, onClose, onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Load full transaction ───────────────────────────────────────────────
  useEffect(() => {
    if (!open || !txId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/bookkeeping/books/${bookId}/transactions/${txId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!cancelled) setTxn(d.transaction as Transaction); })
      .catch(async r => {
        if (cancelled) return;
        const detail = await (r as Response).json?.().catch(() => null);
        setError(detail?.error ?? 'Could not load transaction.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, bookId, txId]);

  const type = (txn?.type ?? seed?.type ?? 'PAY') as TransactionType;
  const isJournal = type === 'JRN' || type === 'RJN';
  const config = getTypeConfig(type);
  const showVatColumn = vatRegistered && (config?.hasVat ?? false);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[1400] bg-slate-900/40" onClick={() => !submitting && onClose()} />
      <div className="fixed inset-0 z-[1450] flex items-center justify-center p-4 pointer-events-none">
        <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden pointer-events-auto flex flex-col" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2 bg-slate-50/40">
            {mode === 'edit'
              ? <Pencil size={14} className="text-indigo-600" />
              : <CopyIcon size={14} className="text-indigo-600" />}
            <h2 className="text-sm font-semibold text-slate-900">
              {mode === 'edit' ? 'Edit transaction' : 'Duplicate transaction'}
            </h2>
            <span className="text-[11px] font-mono text-slate-500">{txn?.ref_no ?? seed?.ref_no ?? ''}</span>
            <span className="text-[11px] text-slate-400">·</span>
            <span className="text-[11px] text-slate-500">{type}</span>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="Close"
              className="ml-auto text-slate-400 hover:text-slate-700"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="p-6 text-sm text-slate-400 flex items-center gap-2">
                <Loader2 size={13} className="animate-spin" /> Loading transaction…
              </div>
            ) : !txn ? (
              <div className="p-6 text-sm text-rose-700">{error || 'Transaction not found.'}</div>
            ) : isJournal ? (
              <JournalEditForm
                mode={mode}
                bookId={bookId}
                txn={txn}
                vatLockDate={vatLockDate}
                onError={setError}
                submitting={submitting}
                setSubmitting={setSubmitting}
                onSaved={onSaved}
              />
            ) : (
              <UniversalEditForm
                mode={mode}
                bookId={bookId}
                txn={txn}
                vatRegistered={vatRegistered}
                vatLockDate={vatLockDate}
                showVatColumn={showVatColumn}
                onError={setError}
                submitting={submitting}
                setSubmitting={setSubmitting}
                onSaved={onSaved}
              />
            )}
          </div>

          {error && (
            <div className="px-4 py-2 border-t border-rose-200 bg-rose-50 text-xs text-rose-700">{error}</div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Universal (header + analysis) form ──────────────────────────────────────
function UniversalEditForm({
  mode, bookId, txn, vatRegistered, vatLockDate, showVatColumn,
  onError, submitting, setSubmitting, onSaved,
}: {
  mode: 'edit' | 'duplicate';
  bookId: string;
  txn: Transaction;
  vatRegistered: boolean;
  vatLockDate: string | null;
  showVatColumn: boolean;
  onError: (s: string) => void;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onSaved: (t: Transaction) => void;
}) {
  const type = txn.type as TransactionType;
  const config = getTypeConfig(type) ?? TRANSACTION_TYPE_CONFIG.PAY;

  // Reconstruct the form state from the loaded transaction.
  //
  // primary_account_id may be NULL on bulk-imported transactions (the
  // legacy import didn't set it). In that case we can't trust the simple
  // "not-equal-to-primary" filter to pick the analysis split — it'd return
  // the first split, which for an imported PAY is usually the bank side.
  //
  // We infer the primary by ledger using the transaction-type config:
  //   • PAY / CHQ / REC → primary lives on the Bank ledger
  //   • SIN / SCR       → primary lives on Customers
  //   • PIN / PCR       → primary lives on Suppliers
  //   • WOF / WBK / TRF → primaryLedger is null in config; fall back to
  //                       "the first non-VAT split", which is the best
  //                       guess we can make.
  const { inferredPrimary, inferredAnalysis } = useMemo(() => {
    const splits = txn.splits ?? [];
    const isVatAcct = (name?: string | null) =>
      /VAT\s*(Input|Output)/i.test(name ?? '');

    // 1. Primary: prefer the persisted column, else infer by ledger.
    let primarySplit = splits.find(s => s.account_id === txn.primary_account_id) ?? null;
    if (!primarySplit && config.primaryLedger) {
      primarySplit = splits.find(s => s.account?.ledger === config.primaryLedger) ?? null;
    }
    if (!primarySplit) {
      // Last resort — drop VAT splits then take the first remaining.
      primarySplit = splits.find(s => !isVatAcct(s.account?.name)) ?? splits[0] ?? null;
    }

    // 2. Analysis: a non-primary, non-VAT split. There's typically only
    //    one such row for PAY/CHQ/REC/etc.
    const analysisSplit = splits.find(s =>
      s.id !== primarySplit?.id &&
      !isVatAcct(s.account?.name),
    ) ?? null;

    return { inferredPrimary: primarySplit, inferredAnalysis: analysisSplit };
  }, [txn, config.primaryLedger]);

  // Kept as `analysisSplit` for the downstream code that already references it.
  const analysisSplit = inferredAnalysis;

  const [date, setDate] = useState(mode === 'duplicate' ? fromIso(todayIso()) : fromIso(txn.date));
  const [primary, setPrimary] = useState<BookAccountRef | null>(
    // Prefer the persisted primary_account when present; otherwise seed
    // from the inferred primary split so the Bank Account picker shows
    // the right account even on the legacy-imported rows.
    txn.primary_account ? {
      id: txn.primary_account.id,
      name: txn.primary_account.name,
      ledger: txn.primary_account.ledger,
      account_type: txn.primary_account.account_type,
    } : inferredPrimary?.account ? {
      id: inferredPrimary.account.id,
      name: inferredPrimary.account.name,
      ledger: inferredPrimary.account.ledger,
      account_type: inferredPrimary.account.account_type,
    } : null,
  );
  const [details, setDetails] = useState(txn.payee_text ?? txn.details ?? '');
  const [totalText, setTotalText] = useState(Number(txn.total).toFixed(2));
  const [vatTreatment, setVatTreatment] = useState<VatTreatment>(
    (txn.vat_treatment ?? (showVatColumn ? 'standard_20' : 'no_vat')) as VatTreatment,
  );
  const [analysisLedger, setAnalysisLedger] = useState<string>(
    analysisSplit?.account?.ledger ?? config.analysisLedger ?? '',
  );
  const [analysis, setAnalysis] = useState<BookAccountRef | null>(
    analysisSplit?.account ? {
      id: analysisSplit.account.id,
      name: analysisSplit.account.name,
      ledger: analysisSplit.account.ledger,
      account_type: analysisSplit.account.account_type,
    } : null,
  );
  const [entryDetails, setEntryDetails] = useState(analysisSplit?.entry_details ?? '');
  const [includeInNextReturn, setIncludeInNextReturn] = useState(true);

  // VAT routing account ids
  const [vatInputId, setVatInputId]   = useState<string | null>(null);
  const [vatOutputId, setVatOutputId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}/vat-accounts`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setVatInputId(d.input_account_id ?? null);
        setVatOutputId(d.output_account_id ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  const [frsCapital, setFrsCapital] = useState(Boolean(txn.frs_capital_reclaim));
  const isPurchase = ['PIN', 'PAY', 'CHQ', 'PCR'].includes(type);

  const total = parseAmount(totalText);
  const rate = showVatColumn ? rateFor(vatTreatment) : 0;
  const { vat, net } = splitVatFromGross(total, rate);

  // Late-entry detection
  const isoDate = parseUkDateStrict(date);
  const isLateEntry = Boolean(
    vatLockDate && isoDate && isoDate <= vatLockDate && showVatColumn && vat > 0,
  );

  async function handleSave() {
    onError('');
    if (!isoDate) { onError('Date is required (dd/mm/yyyy).'); return; }
    if (!primary) { onError(`Pick the ${config.primaryLabel.toLowerCase()}.`); return; }
    if (!analysis) { onError(`Pick the ${config.analysisLabel.toLowerCase()}.`); return; }
    if (primary.id === analysis.id) { onError('Primary and analysis must differ.'); return; }
    if (total <= 0) { onError('Amount must be greater than zero.'); return; }

    setSubmitting(true);
    try {
      const splits = buildSplits({
        config,
        primaryAccountId: primary.id,
        analysisAccountId: analysis.id,
        total, vat, net,
        vatInputAccountId: vatInputId,
        vatOutputAccountId: vatOutputId,
        entryDetails: entryDetails || null,
        notes: null,
      });

      const body = {
        type,
        date: isoDate,
        payee_text: details || null,
        details: details || null,
        total,
        vat_total: showVatColumn ? vat : 0,
        vat_rate: showVatColumn ? rate : null,
        vat_treatment: showVatColumn ? vatTreatment : null,
        primary_account_id: primary.id,
        splits,
        late_entry: isLateEntry && includeInNextReturn,
        frs_capital_reclaim: isPurchase ? frsCapital : false,
      };

      const url = mode === 'edit'
        ? `/api/bookkeeping/books/${bookId}/transactions/${txn.id}`
        : `/api/bookkeeping/books/${bookId}/transactions`;
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (res.status === 409 && d.error === 'late_entry_required') {
          throw new Error(d.message ?? 'Late-entry confirmation required.');
        }
        throw new Error(d.error ?? 'Save failed');
      }
      const out = await res.json();
      onSaved(out.transaction as Transaction);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      {/* Date */}
      <Field label="Date">
        <DateInput value={date} onChange={setDate}
          className="px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </Field>

      {/* Primary */}
      <Field label={config.primaryLabel}>
        <AccountPicker
          bookId={bookId}
          value={primary?.id ?? null}
          valueDisplay={primary?.name}
          onChange={setPrimary}
          ledgerFilter={config.primaryLedger ?? undefined}
          placeholder={`${config.primaryLabel}…`}
        />
      </Field>

      {/* Details */}
      <Field label="Details (payee)">
        <input
          type="text"
          value={details}
          onChange={e => setDetails(e.target.value)}
          placeholder="Payee / description"
          className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Field>

      {/* Total + VAT + Net */}
      <div className="grid grid-cols-3 gap-2">
        <Field label={showVatColumn ? 'Total' : 'Amount'}>
          <input
            type="text"
            inputMode="decimal"
            value={totalText}
            onChange={e => setTotalText(e.target.value)}
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded text-right focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
          />
        </Field>
        {showVatColumn && (
          <Field label="VAT">
            <select
              value={vatTreatment}
              onChange={e => setVatTreatment(e.target.value as VatTreatment)}
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {VAT_TREATMENT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
        )}
        {showVatColumn && (
          <Field label="Net">
            <div className="text-sm px-2 py-1.5 border border-transparent text-right text-slate-600 tabular-nums">
              {total > 0 ? formatMoneyAbs(net) : ''}
            </div>
          </Field>
        )}
      </div>

      {/* Analysis ledger + account */}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Ledger">
          <LedgerPicker
            value={analysisLedger}
            onChange={newLedger => {
              setAnalysisLedger(newLedger);
              if (analysis && analysis.ledger !== newLedger) setAnalysis(null);
            }}
            disabled={Boolean(config.analysisLedger)}
            placeholder="Ledger…"
          />
        </Field>
        <Field label={config.analysisLabel}>
          <AccountPicker
            bookId={bookId}
            value={analysis?.id ?? null}
            valueDisplay={analysis?.name}
            onChange={a => {
              setAnalysis(a);
              if (a?.ledger) setAnalysisLedger(a.ledger);
            }}
            ledgerFilter={analysisLedger || undefined}
            disabled={!analysisLedger}
            placeholder={analysisLedger ? `${config.analysisLabel}…` : 'Pick ledger first'}
          />
        </Field>
      </div>

      <Field label="Entry details">
        <input
          type="text"
          value={entryDetails}
          onChange={e => setEntryDetails(e.target.value)}
          placeholder="Entry note"
          className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </Field>

      {/* Flat Rate Scheme — reclaimable capital asset (purchases only) */}
      {showVatColumn && isPurchase && (
        <label className="flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={frsCapital}
            onChange={e => setFrsCapital(e.target.checked)}
            className="mt-0.5 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
          />
          <div className="text-[11px] text-violet-900">
            <div className="font-medium">Reclaimable capital asset (Flat Rate Scheme)</div>
            <div>Tick if this is a capital asset over £2,000 whose input VAT is recoverable into Box 4 despite FRS. Ignored on non-flat-rate books.</div>
          </div>
        </label>
      )}

      {/* Late entry chip */}
      {isLateEntry && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={includeInNextReturn}
            onChange={e => setIncludeInNextReturn(e.target.checked)}
            className="mt-0.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
          />
          <div className="text-[11px] text-amber-900">
            <div className="font-medium">Late VAT entry</div>
            <div>
              {date} is in a filed VAT period. By default the VAT will be carried into the next return. Untick to keep it out (the save will fail with a period-locked error unless you change the date).
            </div>
          </div>
        </label>
      )}

      {/* Footer actions */}
      <div className="pt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {mode === 'edit' ? 'Save changes' : 'Post copy'}
        </button>
      </div>
    </div>
  );
}

// ── Journal form ────────────────────────────────────────────────────────────
function JournalEditForm({
  mode, bookId, txn, vatLockDate,
  onError, submitting, setSubmitting, onSaved,
}: {
  mode: 'edit' | 'duplicate';
  bookId: string;
  txn: Transaction;
  vatLockDate: string | null;
  onError: (s: string) => void;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onSaved: (t: Transaction) => void;
}) {
  void vatLockDate; // journal entries don't carry VAT directly so no late-entry chip needed
  const type = txn.type as 'JRN' | 'RJN';

  const [date, setDate] = useState(mode === 'duplicate' ? fromIso(todayIso()) : fromIso(txn.date));
  const [headerDetails, setHeaderDetails] = useState(txn.details ?? '');
  const [reversesOn, setReversesOn] = useState(''); // RJN sets this; we don't reconstruct it on edit

  const [lines, setLines] = useState<JournalLine[]>(() => {
    const seed = (txn.splits ?? []).map(s => ({
      id: Math.random().toString(36).slice(2),
      account: s.account ? {
        id: s.account.id,
        name: s.account.name,
        ledger: s.account.ledger,
        account_type: s.account.account_type,
      } : null,
      ledger: s.account?.ledger ?? '',
      description: s.entry_details ?? '',
      debitText: s.debit > 0 ? Number(s.debit).toFixed(2) : '',
      creditText: s.credit > 0 ? Number(s.credit).toFixed(2) : '',
    }));
    return seed.length >= 2 ? seed : [...seed, makeBlankJournalLine(), makeBlankJournalLine()].slice(0, Math.max(2, seed.length));
  });

  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + parseAmount(l.debitText), 0);
    const cr = lines.reduce((s, l) => s + parseAmount(l.creditText), 0);
    return { dr, cr, diff: +(dr - cr).toFixed(2) };
  }, [lines]);
  const isBalanced = Math.abs(totals.diff) < 0.005 && (totals.dr > 0 || totals.cr > 0);

  function updateLine(id: string, patch: Partial<JournalLine>) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }
  function addLine() { setLines(prev => [...prev, makeBlankJournalLine()]); }
  function removeLine(id: string) {
    setLines(prev => prev.length <= 2 ? prev : prev.filter(l => l.id !== id));
  }

  async function handleSave() {
    onError('');
    const isoDate = parseUkDateStrict(date);
    if (!isoDate) { onError('Date is required.'); return; }
    let isoReversesOn: string | null = null;
    if (mode === 'duplicate' && type === 'RJN') {
      isoReversesOn = parseUkDateStrict(reversesOn);
      if (!isoReversesOn) { onError('Reversing journals need a reversal date.'); return; }
      if (isoReversesOn <= isoDate) { onError('Reversal date must be after the journal date.'); return; }
    }

    const nonBlank = lines.filter(l => l.account && (parseAmount(l.debitText) > 0 || parseAmount(l.creditText) > 0));
    if (nonBlank.length < 2) { onError('A journal needs at least two non-blank lines.'); return; }
    for (const l of nonBlank) {
      const dr = parseAmount(l.debitText);
      const cr = parseAmount(l.creditText);
      if (dr > 0 && cr > 0) { onError('A line cannot be both a debit and a credit.'); return; }
      if (dr === 0 && cr === 0) { onError('Every line needs a debit or a credit.'); return; }
    }
    if (!isBalanced) {
      onError(`Out of balance: Dr ${formatMoneyAbs(totals.dr)} vs Cr ${formatMoneyAbs(totals.cr)} (diff ${formatMoneyAbs(totals.diff)}).`);
      return;
    }

    setSubmitting(true);
    try {
      const splits = nonBlank.map(l => ({
        account_id: l.account!.id,
        debit: parseAmount(l.debitText),
        credit: parseAmount(l.creditText),
        entry_details: l.description || headerDetails || null,
      }));
      const total = Math.max(totals.dr, totals.cr);

      const body = {
        type,
        date: isoDate,
        payee_text: null,
        details: headerDetails || null,
        total,
        vat_total: 0,
        vat_rate: null,
        vat_treatment: null,
        primary_account_id: null,
        splits,
        ...(mode === 'duplicate' && type === 'RJN' ? { reverses_on_date: isoReversesOn } : {}),
      };

      const url = mode === 'edit'
        ? `/api/bookkeeping/books/${bookId}/transactions/${txn.id}`
        : `/api/bookkeeping/books/${bookId}/transactions`;
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Save failed');
      }
      const out = await res.json();
      onSaved(out.transaction as Transaction);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4 space-y-3">
      <div className={`grid gap-2 ${mode === 'duplicate' && type === 'RJN' ? 'grid-cols-3' : 'grid-cols-[10rem_1fr]'}`}>
        <Field label="Date">
          <DateInput value={date} onChange={setDate}
            className="px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </Field>
        {mode === 'duplicate' && type === 'RJN' && (
          <Field label="Reverses on">
            <DateInput value={reversesOn} onChange={setReversesOn}
              className="px-2 py-1.5 border border-amber-200 rounded bg-amber-50/30 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </Field>
        )}
        <Field label="Transaction details">
          <input
            type="text"
            value={headerDetails}
            onChange={e => setHeaderDetails(e.target.value)}
            placeholder="e.g. Depreciation March 2026"
            className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </Field>
      </div>

      {/* Inline action toolbar */}
      <div className="flex items-center gap-3 text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entries</span>
        <div className="flex-1" />
        <button type="button" onClick={addLine} className="text-indigo-700 hover:underline">Insert row</button>
      </div>

      {/* Lines table */}
      <div className="border border-slate-300 rounded-md overflow-hidden bg-white">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 text-center w-9 border-r border-slate-300">#</th>
              <th className="px-2 py-1.5 text-right w-24 border-r border-slate-300">Debit</th>
              <th className="px-2 py-1.5 text-right w-24 border-r border-slate-300">Credit</th>
              <th className="px-2 py-1.5 text-left w-40 border-r border-slate-300">Ledger</th>
              <th className="px-2 py-1.5 text-left w-52 border-r border-slate-300">Account</th>
              <th className="px-2 py-1.5 text-left">Description</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.id} className="border-t border-slate-200">
                <td className="px-2 py-0 w-9 border-r border-slate-200 text-center bg-slate-50 group relative">
                  <span className="text-[11px] text-slate-500 tabular-nums group-hover:invisible">{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    disabled={lines.length <= 2}
                    aria-label={`Remove row ${idx + 1}`}
                    className="absolute inset-0 flex items-center justify-center text-rose-500 hover:text-rose-700 opacity-0 group-hover:opacity-100 disabled:hidden"
                  >
                    <Trash2 size={11} />
                  </button>
                </td>
                <td className="px-0 py-0 border-r border-slate-200">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={l.debitText}
                    onChange={e => updateLine(l.id, {
                      debitText: e.target.value,
                      creditText: e.target.value && parseAmount(e.target.value) > 0 ? '' : l.creditText,
                    })}
                    placeholder="0.00"
                    className="w-full text-sm px-2 py-1.5 border-0 bg-transparent text-right focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 tabular-nums"
                  />
                </td>
                <td className="px-0 py-0 border-r border-slate-200">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={l.creditText}
                    onChange={e => updateLine(l.id, {
                      creditText: e.target.value,
                      debitText: e.target.value && parseAmount(e.target.value) > 0 ? '' : l.debitText,
                    })}
                    placeholder="0.00"
                    className="w-full text-sm px-2 py-1.5 border-0 bg-transparent text-right focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 tabular-nums"
                  />
                </td>
                <td className="px-1 py-0 border-r border-slate-200">
                  <LedgerPicker
                    value={l.ledger}
                    onChange={newLedger => {
                      const keep = l.account && l.account.ledger === newLedger;
                      updateLine(l.id, { ledger: newLedger, account: keep ? l.account : null });
                    }}
                    placeholder="Ledger…"
                    className="!border-none"
                  />
                </td>
                <td className="px-1 py-0 border-r border-slate-200">
                  <AccountPicker
                    bookId={bookId}
                    value={l.account?.id ?? null}
                    valueDisplay={l.account?.name}
                    onChange={a => updateLine(l.id, { account: a, ledger: a?.ledger ?? l.ledger })}
                    ledgerFilter={l.ledger || undefined}
                    disabled={!l.ledger}
                    placeholder={l.ledger ? 'Account…' : 'Pick ledger first'}
                    className="!border-none"
                  />
                </td>
                <td className="px-0 py-0">
                  <input
                    type="text"
                    value={l.description}
                    onChange={e => updateLine(l.id, { description: e.target.value })}
                    placeholder={headerDetails || 'Line description'}
                    className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 text-sm">
            <tr className="border-t-2 border-slate-300">
              <td className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wide font-semibold text-slate-600 border-r border-slate-200">Totals</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold border-r border-slate-200">{formatMoneyAbs(totals.dr)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold border-r border-slate-200">{formatMoneyAbs(totals.cr)}</td>
              <td colSpan={3} />
            </tr>
            <tr className="border-t border-slate-200">
              <td className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wide font-semibold text-slate-600 border-r border-slate-200">Diff</td>
              <td colSpan={2} className={`px-2 py-1.5 text-right tabular-nums font-semibold border-r border-slate-200 ${
                isBalanced ? 'text-emerald-700' : totals.diff === 0 ? 'text-slate-400' : 'text-rose-700'
              }`}>
                {formatMoneyAbs(totals.diff)}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="pt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={submitting || !isBalanced}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {mode === 'edit' ? 'Save changes' : 'Post copy'}
        </button>
      </div>
    </div>
  );
}

// ── Small layout primitive ──────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  );
}
