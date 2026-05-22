'use client';

/**
 * JournalInputSheet — JRN-only entry, modelled on VT's "Journal (Classic Style)"
 * dialog: a multi-line Dr/Cr table that must balance before posting.
 *
 *   Header: Date + Transaction details + Reference (auto)
 *   Body: rows of (Account, Description, Debit, Credit). Add/remove rows freely.
 *   Footer: total Dr, total Cr, difference. Post button disabled when out of
 *   balance.
 *
 * Posts with type='JRN' and primary_account_id=null — the splits ARE the
 * journal. No VAT routing happens here (journals are manual, no VAT
 * automation).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, X, Loader2, Trash2 } from 'lucide-react';
import AccountPicker from './AccountPicker';
import LedgerPicker from './LedgerPicker';
import DateInput, { parseUkDateStrict } from './DateInput';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import type { BookAccountRef, Transaction, TransactionType } from '@/types/bookkeeping';
import { TRANSACTION_TYPE_CONFIG } from '@/lib/bookkeeping/transactionTypeConfig';

interface Props {
  bookId: string;
  /** Whether the book itself is VAT-registered — unused on JRN/RJN, but kept
   *  symmetric with UniversalInputSheet so the input tab can swap components
   *  without prop changes. */
  vatRegistered: boolean;
  /** 'JRN' for plain journals, 'RJN' for reversing journals. */
  type: 'JRN' | 'RJN';
  /** Type selector — clicking a non-journal button switches to UniversalInputSheet. */
  onTypeChange: (t: TransactionType) => void;
  onPosted?: (txn: Transaction) => void;
}

// Same order as UniversalInputSheet so the muscle memory is preserved.
const TYPE_ORDER: TransactionType[] = ['PAY','CHQ','REC','TRF','SIN','SCR','PIN','PCR','JRN','RJN'];

// Per-family colour tints — match the New transaction popout's icon tiles.
const FAMILY_PILL_CLASSES: Record<'bank'|'sales'|'purchases'|'journals', { active: string; inactive: string }> = {
  bank:      { active: 'bg-emerald-600 text-white', inactive: 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-700' },
  sales:     { active: 'bg-blue-600 text-white',    inactive: 'text-slate-600 hover:bg-blue-50 hover:text-blue-700'      },
  purchases: { active: 'bg-amber-600 text-white',   inactive: 'text-slate-600 hover:bg-amber-50 hover:text-amber-700'    },
  journals:  { active: 'bg-violet-600 text-white',  inactive: 'text-slate-600 hover:bg-violet-50 hover:text-violet-700'  },
};
function familyOf(t: TransactionType): keyof typeof FAMILY_PILL_CLASSES {
  if (t === 'PAY' || t === 'CHQ' || t === 'REC' || t === 'TRF') return 'bank';
  if (t === 'SIN' || t === 'SCR') return 'sales';
  if (t === 'PIN' || t === 'PCR') return 'purchases';
  return 'journals'; // JRN, RJN
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
// Strict parser shared with DateInput — refuses dates that don't exist on the
// real calendar (e.g. 30/02, 20/20). Empty / unparseable → ''.
const parseDate = parseUkDateStrict;
function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// ── Row state ────────────────────────────────────────────────────────────────

interface Line {
  id: string;                  // local-only, for React keys
  ledger: string;              // chosen first; restricts the account picker
  account: BookAccountRef | null;
  description: string;
  debitText: string;
  creditText: string;
}

function makeBlankLine(): Line {
  return {
    id: Math.random().toString(36).slice(2),
    ledger: '',
    account: null,
    description: '',
    debitText: '',
    creditText: '',
  };
}

// Ledger list now lives in LedgerPicker (exported as LEDGER_OPTIONS), so the
// dropdown's typeahead behaviour and the source of names stay in one place.

function parseAmount(s: string): number {
  return parseFloat(s.replace(/[,£\s]/g, '')) || 0;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function JournalInputSheet({ bookId, vatRegistered, type, onTypeChange, onPosted }: Props) {
  const [date, setDate] = useState(formatDateUk(todayIso()));
  const [headerDetails, setHeaderDetails] = useState('');
  const [reversesOn, setReversesOn] = useState(''); // user-typed; only used when type === 'RJN'
  const [lines, setLines] = useState<Line[]>(() => [makeBlankLine(), makeBlankLine()]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  const [recent, setRecent] = useState<Transaction[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Row actions (edit / duplicate / delete / audit) for the Recent table.
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered,
    vatLockDate: null, // journals don't carry VAT, no late-entry handling needed
    onChanged: () => void refreshRecent(),
  });

  // Tracks which row's first input ("Debit") should be focused after a row is
  // appended via Tab — so the cursor lands in the new row automatically.
  const pendingFocusRowId = useRef<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const id = pendingFocusRowId.current;
    if (!id) return;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${id}"][data-cell="debit"]`);
    el?.focus();
    pendingFocusRowId.current = null;
  }, [lines.length]);

  // ── Totals ───────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    const dr = lines.reduce((s, l) => s + parseAmount(l.debitText), 0);
    const cr = lines.reduce((s, l) => s + parseAmount(l.creditText), 0);
    const diff = +(dr - cr).toFixed(2);
    return { dr, cr, diff };
  }, [lines]);
  const isBalanced = Math.abs(totals.diff) < 0.005 && (totals.dr > 0 || totals.cr > 0);

  // ── Load recent journals of the current type ─────────────────────────────
  async function refreshRecent() {
    setLoadingRecent(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions?type=${type}&limit=10`);
      if (r.ok) {
        const d = await r.json();
        setRecent((d.transactions ?? []) as Transaction[]);
      }
    } finally {
      setLoadingRecent(false);
    }
  }
  useEffect(() => { void refreshRecent(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bookId, type]);

  // ── Mutations ────────────────────────────────────────────────────────────
  function updateLine(id: string, patch: Partial<Line>) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }
  function addLine() {
    setLines(prev => [...prev, makeBlankLine()]);
  }
  function removeLine(id: string) {
    setLines(prev => prev.length <= 2 ? prev : prev.filter(l => l.id !== id));
  }
  function reset() {
    setDate(formatDateUk(todayIso()));
    setHeaderDetails('');
    setReversesOn('');
    setLines([makeBlankLine(), makeBlankLine()]);
    setError('');
  }

  // ── Post ─────────────────────────────────────────────────────────────────
  async function handlePost() {
    setError('');
    const isoDate = parseDate(date);
    if (!isoDate) { setError(`"${date}" isn't a valid date — use dd/mm/yyyy (or * for today).`); return; }

    // RJN-specific: reversal date is required and must be after the journal date.
    let isoReversesOn: string | null = null;
    if (type === 'RJN') {
      isoReversesOn = parseDate(reversesOn);
      if (!isoReversesOn) { setError(`"${reversesOn}" isn't a valid reversal date — use dd/mm/yyyy.`); return; }
      if (isoReversesOn <= isoDate) { setError('The reversal date must be after the journal date.'); return; }
    }

    const nonBlankLines = lines.filter(l => l.account && (parseAmount(l.debitText) > 0 || parseAmount(l.creditText) > 0));
    if (nonBlankLines.length < 2) {
      setError('A journal needs at least two non-blank lines.');
      return;
    }
    // Each line must be EITHER a debit OR a credit, not both, not neither.
    for (const l of nonBlankLines) {
      const dr = parseAmount(l.debitText);
      const cr = parseAmount(l.creditText);
      if (dr > 0 && cr > 0) { setError('A line cannot be both a debit and a credit.'); return; }
      if (dr === 0 && cr === 0) { setError('Every line needs a debit or a credit.'); return; }
    }
    if (!isBalanced) {
      setError(`Out of balance: Dr ${totals.dr.toFixed(2)} vs Cr ${totals.cr.toFixed(2)} (diff ${totals.diff.toFixed(2)}).`);
      return;
    }

    setPosting(true);
    try {
      const splits = nonBlankLines.map(l => ({
        account_id: l.account!.id,
        debit:  parseAmount(l.debitText),
        credit: parseAmount(l.creditText),
        entry_details: l.description || headerDetails || null,
      }));

      const total = Math.max(totals.dr, totals.cr);  // for the header
      const res = await fetch(`/api/bookkeeping/books/${bookId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
          reverses_on_date: isoReversesOn,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? 'Post failed');
      }
      const d = await res.json();
      onPosted?.(d.transaction as Transaction);
      reset();
      void refreshRecent();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed');
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(txId: string) {
    if (!confirm('Delete this journal? The reference number will not be reused.')) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions/${txId}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? 'Delete failed');
      return;
    }
    void refreshRecent();
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Type selector — matches UniversalInputSheet so the user can switch freely. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
          {TYPE_ORDER.map((t, i) => {
            const active = t === type;
            const familyClasses = FAMILY_PILL_CLASSES[familyOf(t)];
            const description = t === 'JRN'
              ? 'Journal entry'
              : t === 'RJN'
              ? 'Reversing journal — auto-reverses on a chosen date'
              : TRANSACTION_TYPE_CONFIG[t as keyof typeof TRANSACTION_TYPE_CONFIG]?.description ?? '';
            const showDivider = i > 0 && (t === 'SIN' || t === 'PIN' || t === 'JRN');
            return (
              <span key={t} className="inline-flex items-center">
                {showDivider && <span aria-hidden className="w-px h-5 bg-slate-200" />}
                <button
                  type="button"
                  onClick={() => onTypeChange(t)}
                  title={description}
                  className={`px-3 py-1.5 text-[11px] font-semibold tracking-wide transition-colors ${
                    active ? familyClasses.active : familyClasses.inactive
                  }`}
                >
                  {t}
                </button>
              </span>
            );
          })}
        </div>
        <span className="text-xs text-slate-500">
          {type === 'RJN'
            ? 'Reversing journal — posts the original, then auto-posts a reversal on the chosen date.'
            : 'Journal entry — multi-line Dr/Cr table, must balance.'}
        </span>
      </div>

      {/* Header row */}
      <div className={`grid grid-cols-1 gap-3 ${
        type === 'RJN'
          ? 'md:grid-cols-[10rem_10rem_1fr]'
          : 'md:grid-cols-[10rem_1fr]'
      }`}>
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Date</label>
          <DateInput
            value={date}
            onChange={setDate}
            className="px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {type === 'RJN' && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Reverses on</label>
            <DateInput
              value={reversesOn}
              onChange={setReversesOn}
              className="px-2 py-1 border border-amber-200 rounded bg-amber-50/30 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        )}
        <div>
          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Transaction details</label>
          <input
            type="text"
            value={headerDetails}
            onChange={e => setHeaderDetails(e.target.value)}
            placeholder={type === 'RJN' ? 'e.g. Accrual — March 2026 rent' : 'e.g. Depreciation March 2026'}
            className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Entries header + inline actions (Excel-style toolbar above the grid) */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entries</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={addLine}
          className="text-indigo-700 hover:underline"
        >
          Insert row
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={() => {
            if (lines.length <= 2) return;
            setLines(prev => prev.length <= 2 ? prev : prev.slice(0, -1));
          }}
          disabled={lines.length <= 2}
          className="text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed"
        >
          Delete row
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={() => setLines([makeBlankLine(), makeBlankLine()])}
          className="text-indigo-700 hover:underline"
        >
          Delete all rows
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={() => setLines(prev => prev.map(l => ({ ...l, debitText: '', creditText: '' })))}
          className="text-indigo-700 hover:underline"
        >
          Clear all amounts
        </button>
      </div>

      {/* Lines — Excel-style bordered cell grid, inputs are borderless and fill each cell.
          Column order (concept image): # · Debit · Credit · Ledger · Account · Description.
          Ledger is picked first; the Account cell filters to that ledger. Tab from the
          last (Description) cell of the last row auto-appends a new line and focuses it. */}
      <div className="border border-slate-300 rounded-md overflow-hidden bg-white">
        <table ref={tableRef} className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 text-center w-9 border-r border-slate-300">#</th>
              <th className="px-2 py-1.5 text-right w-28 border-r border-slate-300">Debit</th>
              <th className="px-2 py-1.5 text-right w-28 border-r border-slate-300">Credit</th>
              <th className="px-2 py-1.5 text-left w-44 border-r border-slate-300">Ledger</th>
              <th className="px-2 py-1.5 text-left w-60 border-r border-slate-300">Account</th>
              <th className="px-2 py-1.5 text-left">Description</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const isLastRow = idx === lines.length - 1;
              return (
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
                      data-row-id={l.id}
                      data-cell="debit"
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
                        // Switching ledger invalidates the chosen account — clear it so the
                        // user picks one that actually belongs to the new ledger.
                        const keepAccount = l.account && l.account.ledger === newLedger;
                        updateLine(l.id, { ledger: newLedger, account: keepAccount ? l.account : null });
                      }}
                      placeholder="Ledger…"
                      className="!border-none"
                    />
                  </td>
                  <td className="px-1 py-0 border-r border-slate-200">
                    <AccountPicker
                      bookId={bookId}
                      value={l.account?.id ?? null}
                      valueDisplay={l.account ? l.account.name : undefined}
                      onChange={a => updateLine(l.id, { account: a })}
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
                      onKeyDown={e => {
                        // Tab off the final cell of the final row → append a new line
                        // and move focus into its first cell (Debit). Shift+Tab is left
                        // alone so reverse-tabbing still works.
                        if (e.key === 'Tab' && !e.shiftKey && isLastRow) {
                          e.preventDefault();
                          const newLine = makeBlankLine();
                          pendingFocusRowId.current = newLine.id;
                          setLines(prev => [...prev, newLine]);
                        }
                      }}
                      placeholder={headerDetails || 'Line description'}
                      className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 text-sm">
            <tr className="border-t-2 border-slate-300">
              <td className="px-2 py-2 text-right text-[10px] uppercase tracking-wide font-semibold text-slate-600 border-r border-slate-200">
                Totals
              </td>
              <td className="px-2 py-2 text-right tabular-nums font-semibold border-r border-slate-200">{totals.dr.toFixed(2)}</td>
              <td className="px-2 py-2 text-right tabular-nums font-semibold border-r border-slate-200">{totals.cr.toFixed(2)}</td>
              <td colSpan={3} />
            </tr>
            <tr className="border-t border-slate-200">
              <td className="px-2 py-1.5 text-right text-[10px] uppercase tracking-wide font-semibold text-slate-600 border-r border-slate-200">
                Difference
              </td>
              <td colSpan={2} className={`px-2 py-1.5 text-right tabular-nums font-semibold border-r border-slate-200 ${
                isBalanced
                  ? 'text-emerald-700'
                  : totals.diff === 0
                  ? 'text-slate-400'
                  : 'text-rose-700'
              }`}>
                {totals.diff.toFixed(2)}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Actions — Add line / Clear journal live in the toolbar above the grid;
          only Post remains down here as the primary commit action. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void handlePost()}
          disabled={posting || !isBalanced}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-60"
        >
          {posting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Post {type === 'RJN' ? 'reversing journal' : 'journal'}
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Recent journals */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Recent {type === 'RJN' ? 'reversing journals' : 'journals'} ({recent.length})
        </h3>
        {loadingRecent ? (
          <div className="text-sm text-gray-400 flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-gray-400">No {type === 'RJN' ? 'reversing journals' : 'journals'} yet — post your first one above.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-1.5 text-left w-24">Date</th>
                  <th className="px-2 py-1.5 text-left w-28">Ref</th>
                  <th className="px-2 py-1.5 text-left">Details</th>
                  <th className="px-2 py-1.5 text-right w-24">Total</th>
                  <th className="px-2 py-1.5 text-left w-16">Lines</th>
                  <th className="px-2 py-1.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {recent.map(t => {
                  const rp = rowActions.rowProps(t);
                  return (
                    <tr key={t.id} {...rp} className={`border-t border-gray-100 ${rp.className}`}>
                      <td className="px-2 py-1.5 text-gray-700 tabular-nums">{formatDateUk(t.date)}</td>
                      <td className="px-2 py-1.5 text-indigo-700 text-xs">{t.ref_no}</td>
                      <td className="px-2 py-1.5 text-gray-900">{t.details ?? ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{Number(t.total).toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-gray-500">{t.splits?.length ?? 0}</td>
                      <td className="px-2 py-1.5 text-right">
                        {rowActions.renderActions(t)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rowActions.menus}
    </div>
  );
}
