'use client';

/**
 * VatReturnTab — quarterly UK VAT return view.
 *
 * Master/detail layout, modelled on VT's VAT screen and on our own
 * AccountsLedgerView:
 *
 *   ┌────────────────┬─────────────────────────────────────────────────┐
 *   │ [Search]       │ (detail of the selected filing OR live compute) │
 *   │                │                                                  │
 *   │ + Compute new  │ [Boxes table + memo row]                        │
 *   │   return       │                                                  │
 *   │ ─────          │ Tab strip:                                       │
 *   │ VAT 000005     │   VAT return · Double entry · Outputs · Inputs   │
 *   │ Jan 26 return  │       · Backup report                            │
 *   │ Filed 06/03    │                                                  │
 *   │ ─────          │ [Active tab content with VAT rate column]        │
 *   │ VAT 000004     │                                                  │
 *   │ Oct 25 return  │                                                  │
 *   └────────────────┴─────────────────────────────────────────────────┘
 *
 * The left list shows every filed return with its ref, friendly period
 * label, and submitted-on indicator. Selecting one populates the right
 * pane (mode = 'view'). Clicking "Compute new return" switches the right
 * pane into compute mode (mode = 'compute') which shows the period
 * selector + live figures + Mark as filed button.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2, Printer, Download, Copy, BadgePoundSterling,
  AlertTriangle, CheckCircle2, Send, X, Lock, Plus, Search, Sparkles, Building2, CalendarClock, PencilLine,
} from 'lucide-react';
import PeriodSelector, { type DateRange } from './PeriodSelector';
import MarkAsFiledModal from './MarkAsFiledModal';
import VatReturnReviewPanel from './VatReturnReviewPanel';
import MtdSubmitModal from './MtdSubmitModal';
import VatObligationsPanel from './VatObligationsPanel';
import { useTransactionRowActions } from '../transactions/useTransactionRowActions';
import { TxnRefLink } from '../book/BookNavigationContext';
import type { Transaction, TransactionType } from '@/types/bookkeeping';

interface BoxFigure { label: string; value: number; }
interface BreakdownRow {
  id: string;
  ref_no: string;
  date: string;
  type: string;
  payee_text: string | null;
  details: string | null;
  total: number;
  vat_total: number;
  vat_rate: number | null;
  net: number;
  sign: 1 | -1;
  is_late_entry: boolean;
  vat_period_override: string | null;
}
interface FiledReturn {
  id: string;
  ref_no: string | null;
  ref_seq: number | null;
  period_from: string;
  period_to: string;
  box1: number; box2: number; box3: number;
  box4: number; box5: number;
  box6: number; box7: number; box8: number; box9: number;
  late_entry_vat: number;
  filed_at: string;
  filed_by: string | null;
  filed_by_name: string | null;
  submitted_at: string | null;
  submission_method: 'manual' | 'mtd_api' | null;
  hmrc_reference: string | null;
  notes: string | null;
  filing_journal_id: string | null;
}
interface JournalSplit {
  id: string;
  account_id: string;
  account?: { id: string; name: string; ledger: string | null } | null;
  debit: number;
  credit: number;
  entry_details: string | null;
}
interface FilingJournal {
  id: string;
  ref_no: string;
  date: string;
  details: string | null;
  total: number;
  splits?: JournalSplit[];
}
interface VatReturnResponse {
  from: string;
  to: string;
  vat_registered: boolean;
  vat_scheme: string | null;
  flat_rate: number | null;
  warnings?: string[];
  vat_lock_date: string | null;
  boxes: {
    box1: BoxFigure; box2: BoxFigure; box3: BoxFigure;
    box4: BoxFigure; box5: BoxFigure;
    box6: BoxFigure; box7: BoxFigure; box8: BoxFigure; box9: BoxFigure;
  };
  late_entry_vat: number;
  breakdown: { outputs: BreakdownRow[]; inputs: BreakdownRow[]; };
  filed_return: FiledReturn | null;
}

interface Props {
  bookId: string;
  isAdmin?: boolean;
  /** The book's currently-selected financial-year period (from the header
   *  year/period bar) — drives a quick "snap to this period" preset. */
  activePeriodLabel?: string;
  activePeriodFromIso?: string | null;
  activePeriodToIso?: string | null;
}

type SubTab = 'summary' | 'journal' | 'outputs' | 'inputs' | 'backup' | 'ai_review';
type Mode = 'compute' | 'view';

// ── Date helpers ────────────────────────────────────────────────────────────
function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function formatDateTimeUk(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function formatJustDateUk(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function shortPeriodLabel(periodTo: string): string {
  // VT-style "Jan 26 VAT return" from a period_to of 2026-01-31.
  if (!periodTo) return 'VAT return';
  const d = new Date(`${periodTo}T00:00:00Z`);
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${mon} ${yy} VAT return`;
}
function fmt(n: number): string {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function rateLabel(row: BreakdownRow): string {
  // Prefer the stored rate; fall back to derived rate from VAT/Net; default 0.0%.
  let rate: number | null = row.vat_rate ?? null;
  if (rate === null && row.net > 0 && row.vat_total > 0) {
    rate = Math.round((row.vat_total / row.net) * 1000) / 10;
  }
  if (rate === null) return '0.0%';
  return `${rate.toFixed(1)}%`;
}

// ── Component ───────────────────────────────────────────────────────────────
export default function VatReturnTab({ bookId, isAdmin, activePeriodLabel, activePeriodFromIso, activePeriodToIso }: Props) {
  // List state
  const [filings, setFilings] = useState<FiledReturn[]>([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilingId, setSelectedFilingId] = useState<string | null>(null);

  // Right-pane mode
  const [mode, setMode] = useState<Mode>('compute');

  // Compute-mode period
  const [period, setPeriod] = useState<DateRange>({ from: null, to: null });

  // Right-pane data
  const [data, setData] = useState<VatReturnResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [subTab, setSubTab] = useState<SubTab>('summary');
  const [copied, setCopied] = useState(false);

  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [mtdOpen, setMtdOpen] = useState(false);
  const [obligationsOpen, setObligationsOpen] = useState(false);

  // Lazy-loaded closing journal (for the Double entry tab)
  const [journal, setJournal] = useState<FilingJournal | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);

  // Bump to refetch after file/unfile.
  const [refreshKey, setRefreshKey] = useState(0);

  // Right-click row actions on the Outputs / Inputs / Backup-report tables.
  // No inline hover-strip in this view — the rows are tight and read-only;
  // right-click delivers all the same actions via context menu.
  const rowActions = useTransactionRowActions({
    bookId,
    vatRegistered: Boolean(data?.vat_registered),
    vatLockDate: data?.vat_lock_date ?? null,
    onChanged: () => setRefreshKey(k => k + 1),
  });
  /** Synthesise the minimal Transaction stub the row-actions hook needs from
   *  a BreakdownRow. The Edit modal does its own full fetch by id, so just
   *  the id + ref_no + type fields are required by the hook itself. */
  function breakdownAsTxnStub(row: BreakdownRow): Transaction {
    return {
      id: row.id,
      book_id: bookId,
      type: row.type as TransactionType,
      ref_no: row.ref_no,
      ref_seq: 0,
      date: row.date,
      payee_text: row.payee_text,
      details: row.details,
      total: row.total,
      vat_total: row.vat_total,
      vat_rate: row.vat_rate,
      vat_treatment: null,
      vat_period_override: row.vat_period_override,
      primary_account_id: null,
      status: 'posted',
      created_by: null,
      created_at: '',
      updated_at: '',
      posted_at: null,
    };
  }

  // ── Fetch filings ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setFilingsLoading(true);
    fetch(`/api/bookkeeping/books/${bookId}/vat-returns`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!cancelled) setFilings((d.vat_returns ?? []) as FiledReturn[]); })
      .catch(() => { if (!cancelled) setFilings([]); })
      .finally(() => { if (!cancelled) setFilingsLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, refreshKey]);

  // ── Fetch right-pane data ─────────────────────────────────────────────────
  // Depends on mode + period (for compute) or selected filing (for view).
  useEffect(() => {
    let from: string | null = null;
    let to: string | null = null;
    if (mode === 'compute') {
      from = period.from;
      to = period.to;
    } else if (mode === 'view' && selectedFilingId) {
      const f = filings.find(x => x.id === selectedFilingId);
      if (f) { from = f.period_from; to = f.period_to; }
    }
    if (!from || !to) { setData(null); return; }

    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/bookkeeping/books/${bookId}/vat-return?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!cancelled) setData(d as VatReturnResponse); })
      .catch(async r => {
        if (cancelled) return;
        const detail = await (r as Response).json?.().catch(() => null);
        setError(detail?.error ?? 'Could not load VAT return.');
        setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, mode, period.from, period.to, selectedFilingId, filings, refreshKey]);

  // ── Lazy-load journal when the Double entry sub-tab opens ─────────────────
  useEffect(() => {
    if (subTab !== 'journal') return;
    const jrnId = data?.filed_return?.filing_journal_id;
    if (!jrnId) { setJournal(null); return; }
    let cancelled = false;
    setJournalLoading(true);
    fetch(`/api/bookkeeping/books/${bookId}/transactions/${jrnId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { if (!cancelled) setJournal((d.transaction ?? null) as FilingJournal | null); })
      .catch(() => { if (!cancelled) setJournal(null); })
      .finally(() => { if (!cancelled) setJournalLoading(false); });
    return () => { cancelled = true; };
  }, [bookId, subTab, data?.filed_return?.filing_journal_id]);

  // ── Auto-select when filings load (first time) ────────────────────────────
  useEffect(() => {
    if (filings.length === 0) return;
    if (mode === 'view' && selectedFilingId && filings.some(f => f.id === selectedFilingId)) return;
    // Pick the most recent filing if nothing's selected — but stay in compute
    // mode by default, so newcomers see the period picker right away.
  }, [filings, mode, selectedFilingId]);

  // ── Filter filings by search query ────────────────────────────────────────
  const filteredFilings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filings;
    return filings.filter(f => {
      const ref = (f.ref_no ?? '').toLowerCase();
      const label = shortPeriodLabel(f.period_to).toLowerCase();
      const hmrc = (f.hmrc_reference ?? '').toLowerCase();
      const periodStr = `${f.period_from} ${f.period_to}`;
      return ref.includes(q) || label.includes(q) || hmrc.includes(q) || periodStr.includes(q);
    });
  }, [filings, searchQuery]);

  // ── Actions ───────────────────────────────────────────────────────────────
  function selectCompute() {
    setMode('compute');
    setSelectedFilingId(null);
    setSubTab('summary');
  }
  function selectFiling(id: string) {
    setMode('view');
    setSelectedFilingId(id);
    setSubTab('summary');
  }

  async function handleUnfile(filing: FiledReturn) {
    if (!isAdmin) return;
    const ok = confirm(
      `Unfile ${filing.ref_no ?? 'this return'} for ${formatDateUk(filing.period_from)} – ${formatDateUk(filing.period_to)}?\n\n` +
      `This will also delete the closing journal that zeroed the VAT control accounts, and reopen the period for editing. Any late entries previously flagged into a later return will keep their override — review them if needed.`,
    );
    if (!ok) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/vat-returns/${filing.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? 'Could not unfile');
      return;
    }
    if (selectedFilingId === filing.id) selectCompute();
    setRefreshKey(k => k + 1);
  }

  function copyFigures() {
    if (!data) return;
    const lines = [
      `VAT return — ${formatDateUk(data.from)} to ${formatDateUk(data.to)}`,
      `Box 1  ${fmt(data.boxes.box1.value)}`,
      `Box 2  ${fmt(data.boxes.box2.value)}`,
      `Box 3  ${fmt(data.boxes.box3.value)}`,
      `Box 4  ${fmt(data.boxes.box4.value)}`,
      `Box 5  ${fmt(data.boxes.box5.value)}`,
      `Box 6  ${fmt(data.boxes.box6.value)}`,
      `Box 7  ${fmt(data.boxes.box7.value)}`,
      `Box 8  ${fmt(data.boxes.box8.value)}`,
      `Box 9  ${fmt(data.boxes.box9.value)}`,
    ];
    if (data.late_entry_vat !== 0) {
      lines.push(`(of which late entries from prior periods: ${fmt(data.late_entry_vat)})`);
    }
    void navigator.clipboard?.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function exportCsv() {
    if (!data) return;
    const rows: string[][] = [
      ['Box', 'Description', 'Value (GBP)'],
      ...(['box1','box2','box3','box4','box5','box6','box7','box8','box9'] as const).map((k, i) =>
        [String(i + 1), data.boxes[k].label, data.boxes[k].value.toFixed(2)]),
      ['', 'Of which late entries from prior periods (VAT)', data.late_entry_vat.toFixed(2)],
      [],
      ['Period', `${data.from} to ${data.to}`, ''],
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vat-return-${data.from}-to-${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderBreakdownTable(rows: BreakdownRow[]) {
    if (rows.length === 0) {
      return <p className="text-sm text-slate-400 px-2 py-3">No transactions in this period.</p>;
    }
    return (
      <div className="border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 text-left w-24 border-r border-slate-200">Date</th>
              <th className="px-2 py-1.5 text-left w-24 border-r border-slate-200">Ref</th>
              <th className="px-2 py-1.5 text-left w-14 border-r border-slate-200">Type</th>
              <th className="px-2 py-1.5 text-left border-r border-slate-200">Payee / description</th>
              <th className="px-2 py-1.5 text-right w-24 border-r border-slate-200">Net</th>
              <th className="px-2 py-1.5 text-right w-24 border-r border-slate-200">VAT</th>
              <th className="px-2 py-1.5 text-right w-16 border-r border-slate-200">Rate</th>
              <th className="px-2 py-1.5 text-right w-24">Gross</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.id}
                onContextMenu={ev => {
                  const t = ev.target as HTMLElement;
                  if (t.closest('input, textarea, select, [contenteditable]')) return;
                  ev.preventDefault();
                  rowActions.rowProps(breakdownAsTxnStub(row)).onContextMenu(ev);
                }}
                className={`border-t border-slate-100 cursor-context-menu ${row.is_late_entry ? 'bg-amber-50/40' : ''}`}
              >
                <td className="px-2 py-1.5 tabular-nums border-r border-slate-100">
                  <span className={row.is_late_entry ? 'text-amber-800' : 'text-slate-700'}>
                    {formatDateUk(row.date)}
                  </span>
                  {row.is_late_entry && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide text-amber-700 font-semibold">late</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs border-r border-slate-100"><TxnRefLink txn={breakdownAsTxnStub(row)} className="text-xs" /></td>
                <td className="px-2 py-1.5 text-slate-600 text-xs border-r border-slate-100">{row.type}</td>
                <td className="px-2 py-1.5 text-slate-900 border-r border-slate-100">
                  {row.payee_text ?? row.details ?? ''}
                  {row.is_late_entry && (
                    <span className="block text-[10px] text-amber-700">
                      Original date {formatDateUk(row.date)} — VAT carried forward
                    </span>
                  )}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums border-r border-slate-100 ${row.sign === -1 ? 'text-rose-700' : 'text-slate-700'}`}>
                  {row.sign === -1 ? '−' : ''}{fmt(row.net)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums border-r border-slate-100 ${row.sign === -1 ? 'text-rose-700' : 'text-slate-700'}`}>
                  {row.sign === -1 ? '−' : ''}{fmt(row.vat_total)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-500 text-xs border-r border-slate-100">
                  {rateLabel(row)}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${row.sign === -1 ? 'text-rose-700' : 'text-slate-900'}`}>
                  {row.sign === -1 ? '−' : ''}{fmt(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const filedReturn = data?.filed_return ?? null;
  const isFiledForThisPeriod = mode === 'compute' && Boolean(filedReturn);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-3 items-start print:block">
      {/* ────────── Left panel: list of filings + Compute new ────────── */}
      <div className="w-72 shrink-0 print:hidden">
        <div
          className="rounded-md border border-slate-200 bg-white overflow-hidden flex flex-col"
          style={{ height: 'calc(100vh - 14rem)' }}
        >
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <BadgePoundSterling size={14} className="text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-900">VAT Returns</h3>
            <span className="ml-auto text-[10px] text-slate-500 tabular-nums">{filings.length}</span>
          </div>

          {/* Search */}
          <div className="px-2 py-2 border-b border-slate-100">
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search returns…"
                className="w-full text-xs pl-7 pr-2 py-1.5 border border-slate-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* New-return area — contextual: a "you are here" indicator while
              drafting, or a clickable "New return" button when viewing a filed
              one (so it never looks like a pre-pressed button on open). */}
          <div className="p-2 border-b border-slate-100">
            {mode === 'compute' ? (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-indigo-50/70 border border-indigo-100">
                <PencilLine size={14} className="text-indigo-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Working on now</p>
                  <p className="text-xs font-medium text-indigo-900 tabular-nums mt-0.5">
                    {period.from && period.to
                      ? `${formatDateUk(period.from)} – ${formatDateUk(period.to)}`
                      : 'Set a period above'}
                  </p>
                  <p className="text-[10px] text-indigo-500/90 mt-0.5">Not filed yet — it’ll appear below once you file it.</p>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={selectCompute}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 font-medium transition-colors"
              >
                <Plus size={13} /> New VAT return
              </button>
            )}
          </div>

          {/* List — fills remaining card height and scrolls internally */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {!filingsLoading && filteredFilings.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Filed returns · {filings.length}
              </p>
            )}
            {filingsLoading ? (
              <div className="p-3 text-xs text-slate-400 flex items-center gap-2">
                <Loader2 size={11} className="animate-spin" /> Loading…
              </div>
            ) : filteredFilings.length === 0 ? (
              <div className="px-3 py-6 text-center">
                {searchQuery ? (
                  <p className="text-xs text-slate-400">No returns match.</p>
                ) : (
                  <>
                    <p className="text-xs font-medium text-slate-500">No returns filed yet</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Your filed VAT returns will appear here once you submit or mark one as filed.</p>
                  </>
                )}
              </div>
            ) : (
              <ul>
                {filteredFilings.map(f => {
                  const active = mode === 'view' && selectedFilingId === f.id;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => selectFiling(f.id)}
                        className={`w-full text-left px-3 py-2 border-b border-slate-100 transition-colors ${
                          active
                            ? 'bg-indigo-50 text-indigo-700 border-l-2 border-l-indigo-600'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {f.ref_no && (
                            <span className={`font-mono text-[11px] font-semibold ${active ? 'text-indigo-700' : 'text-slate-700'}`}>
                              {f.ref_no}
                            </span>
                          )}
                          {isAdmin && active && (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); void handleUnfile(f); }}
                              aria-label="Unfile this return"
                              className="ml-auto p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              title="Unfile this return"
                            >
                              <X size={11} />
                            </button>
                          )}
                        </div>
                        <div className={`text-xs mt-0.5 ${active ? 'text-indigo-900' : 'text-slate-900'}`}>
                          {shortPeriodLabel(f.period_to)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                          {formatDateUk(f.period_from)} – {formatDateUk(f.period_to)}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                          {f.submitted_at ? (
                            <>
                              <CheckCircle2 size={9} className="text-emerald-600" />
                              <span>Submitted {formatJustDateUk(f.submitted_at)}</span>
                            </>
                          ) : (
                            <>
                              <Lock size={9} className="text-slate-400" />
                              <span>Filed {formatJustDateUk(f.filed_at)}</span>
                            </>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ────────── Right panel: card with toolbar / body / tab footer ───── */}
      <div className="flex-1 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col print:border-0 print:shadow-none" style={{ height: 'calc(100vh - 14rem)' }}>
        {/* Toolbar (top header strip) */}
        <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/40 flex items-center gap-2 flex-wrap print:hidden">
          <div className="flex items-center gap-2 mr-auto">
            <h2 className="text-sm font-semibold text-slate-900">
              {mode === 'compute'
                ? 'New VAT Return'
                : (filings.find(f => f.id === selectedFilingId)?.ref_no ?? 'VAT Return')}
            </h2>
            <span className="text-[11px] text-slate-500">
              {mode === 'compute'
                ? (data?.vat_scheme === 'flat_rate'
                    ? `Live recompute · flat rate ${data?.flat_rate ?? 0}% of gross`
                    : 'Live recompute · accrual basis')
                : 'Filed return'}
            </span>
            {data?.vat_scheme === 'flat_rate' && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">Flat Rate {data?.flat_rate ?? 0}%</span>
            )}
          </div>
          <button
            type="button"
            onClick={copyFigures}
            disabled={!data}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            <Copy size={12} /> {copied ? 'Copied' : 'Copy figures'}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!data}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            <Download size={12} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => { setSubTab('backup'); setTimeout(() => window.print(), 100); }}
            disabled={!data}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50"
          >
            <Printer size={12} /> Print backup
          </button>
          {mode === 'compute' && (
            <button
              type="button"
              onClick={() => setFileModalOpen(true)}
              disabled={!data || !data.vat_registered || isFiledForThisPeriod}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={12} />
              {isFiledForThisPeriod ? 'Already filed' : 'Mark as filed'}
            </button>
          )}
          {mode === 'compute' && (
            <button
              type="button"
              onClick={() => setMtdOpen(true)}
              disabled={!data || !data.vat_registered}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-sm shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Building2 size={13} /> Submit to HMRC
            </button>
          )}
        </div>

        {/* Optional sub-header: period selector OR filed banner */}
        {mode === 'compute' && (
          <div className="px-4 py-2 border-b border-slate-100 print:hidden">
            <PeriodSelector
              bookId={bookId}
              value={period}
              onChange={setPeriod}
              presetIds={['custom']}
              rightSlot={
                <>
                  {activePeriodFromIso && activePeriodToIso && (
                    <button
                      type="button"
                      onClick={() => setPeriod({ from: activePeriodFromIso, to: activePeriodToIso })}
                      title={`Snap to the book's selected period (${activePeriodLabel ?? ''})`}
                      className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                        period.from === activePeriodFromIso && period.to === activePeriodToIso
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-200 hover:text-indigo-700'
                      }`}
                    >
                      {activePeriodLabel || 'Selected period'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setObligationsOpen(true)}
                    className="text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1 bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                  >
                    <CalendarClock size={12} /> Obligations
                  </button>
                </>
              }
            />
          </div>
        )}
        {filedReturn && (
          <div className="px-4 py-2 border-b border-slate-100 bg-emerald-50/60 flex items-center gap-2">
            <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
            <div className="text-xs text-emerald-900 flex-1">
              {filedReturn.ref_no && <span className="font-mono font-semibold mr-1.5">{filedReturn.ref_no}</span>}
              <span className="font-semibold">Filed</span>
              {' '}on{' '}{formatDateTimeUk(filedReturn.filed_at)}
              {filedReturn.filed_by_name && <>{' '}by{' '}<span className="font-medium">{filedReturn.filed_by_name}</span></>}
              {filedReturn.submitted_at && (
                <>{' '}· Submitted to HMRC{' '}{formatJustDateUk(filedReturn.submitted_at)}</>
              )}
              {filedReturn.hmrc_reference && (
                <>{' '}· HMRC ref:{' '}<span className="font-mono">{filedReturn.hmrc_reference}</span></>
              )}
            </div>
            <Lock size={11} className="text-emerald-700/70" />
          </div>
        )}

        {/* Body — scrollable; content swaps with the tabs at the bottom.
            min-h-0 is required so the flex child can shrink below its
            intrinsic content size, otherwise overflow-auto never kicks in. */}
        <div className="flex-1 overflow-auto p-4 min-h-0">
          {data?.warnings && data.warnings.length > 0 && (
            <div className="mb-3 space-y-1.5 print:hidden">
              {data.warnings.map((w, i) => (
                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
          {mode === 'compute' && (!period.from || !period.to) ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-sm text-slate-500 text-center print:hidden">
              Pick a period above (try <span className="font-medium text-slate-700">This quarter</span>) to compute a new VAT return.
            </div>
          ) : loading ? (
            <div className="text-sm text-gray-400 flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" /> Computing VAT return…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
              <AlertTriangle size={13} /> {error}
            </div>
          ) : data && !data.vat_registered ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              This book is set to <strong>non-VAT registered</strong>. Switch the book to VAT-registered in Settings to use the VAT Return.
            </div>
          ) : data ? (
            <>
              {/* ── VAT return tab content: 9 boxes + memo + box 5 footnote ── */}
              {subTab === 'summary' && (
                <div className="space-y-3">
                  <div className="border border-slate-300 rounded-md overflow-hidden bg-white">
                    <table className="w-full text-sm border-collapse">
                      <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
                        <tr>
                          <th className="px-3 py-2 text-left w-16 border-r border-slate-300">Box</th>
                          <th className="px-3 py-2 text-left border-r border-slate-300">Description</th>
                          <th className="px-3 py-2 text-right w-40">Value (£)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(['box1','box2','box3','box4','box5','box6','box7','box8','box9'] as const).map((k, i) => {
                          const num = i + 1;
                          const figure = data.boxes[k];
                          const isSubTotal = k === 'box3' || k === 'box5';
                          const isFinalDue = k === 'box5';
                          return (
                            <tr
                              key={k}
                              className={`border-t border-slate-200 ${
                                isFinalDue ? 'bg-indigo-50/40' : isSubTotal ? 'bg-slate-50' : ''
                              }`}
                            >
                              <td className={`px-3 py-2 text-slate-500 border-r border-slate-200 tabular-nums ${isSubTotal ? 'font-semibold text-slate-900' : ''}`}>
                                {num}
                              </td>
                              <td className={`px-3 py-2 text-slate-700 border-r border-slate-200 ${isSubTotal ? 'font-semibold text-slate-900' : ''}`}>
                                {figure.label}
                              </td>
                              <td className={`px-3 py-2 text-right tabular-nums ${
                                isFinalDue ? 'font-bold text-indigo-700 text-base' :
                                isSubTotal ? 'font-semibold text-slate-900' : 'text-slate-700'
                              }`}>
                                {fmt(figure.value)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-t border-slate-200 bg-amber-50/30">
                          <td className="px-3 py-2 text-right text-slate-400 border-r border-slate-200 text-[10px] uppercase tracking-wide">of which</td>
                          <td className="px-3 py-2 text-slate-600 italic border-r border-slate-200">Late entries from prior periods (VAT included in Box 1/Box 4)</td>
                          <td className="px-3 py-2 text-right tabular-nums italic text-slate-700">{fmt(data.late_entry_vat)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Box 5 of <strong>{fmt(data.boxes.box5.value)}</strong>{' '}
                    {data.boxes.box5.value >= 0 ? 'is the amount payable to HMRC for this period.' : 'is the amount HMRC owes back for this period (negative net VAT).'}
                    {data.late_entry_vat !== 0 && (
                      <> Box 1 and Box 4 figures include <span className="font-semibold">{fmt(data.late_entry_vat)}</span> of VAT carried in from earlier filed periods via late entries.</>
                    )}
                  </p>
                </div>
              )}

              {/* ── Double entry tab content ── */}
              {subTab === 'journal' && (
                <div className="space-y-2">
                  {!filedReturn ? (
                    <p className="text-sm text-slate-400">No closing journal yet — this period hasn't been filed. The journal is posted automatically when you mark the return as filed.</p>
                  ) : !filedReturn.filing_journal_id ? (
                    <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                      This filing has no linked closing journal. Likely filed before the closing-journal feature was added, or the journal posting was skipped due to a missing VAT control account.
                    </p>
                  ) : journalLoading ? (
                    <div className="text-sm text-gray-400 flex items-center gap-2">
                      <Loader2 size={13} className="animate-spin" /> Loading journal…
                    </div>
                  ) : !journal ? (
                    <p className="text-sm text-slate-400">Closing journal could not be loaded.</p>
                  ) : (
                    <>
                      <div className="text-[11px] text-slate-500">
                        <span className="font-mono font-semibold text-slate-700">{journal.ref_no}</span>
                        {' '}· dated{' '}{formatDateUk(journal.date)}
                        {journal.details && <>{' '}· {journal.details}</>}
                      </div>
                      <div className="border border-slate-200 rounded overflow-hidden">
                        <table className="w-full text-sm border-collapse">
                          <thead className="bg-slate-50 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                            <tr>
                              <th className="px-2 py-1.5 text-left border-r border-slate-200">Account</th>
                              <th className="px-2 py-1.5 text-left border-r border-slate-200">Entry details</th>
                              <th className="px-2 py-1.5 text-right w-28 border-r border-slate-200">Debit</th>
                              <th className="px-2 py-1.5 text-right w-28">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(journal.splits ?? []).map(s => (
                              <tr key={s.id} className="border-t border-slate-100">
                                <td className="px-2 py-1.5 text-indigo-700 border-r border-slate-100">
                                  {s.account ? `${s.account.ledger ? s.account.ledger + ': ' : ''}${s.account.name}` : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-slate-700 border-r border-slate-100">{s.entry_details ?? ''}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700 border-r border-slate-100">{s.debit > 0 ? fmt(s.debit) : ''}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{s.credit > 0 ? fmt(s.credit) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {subTab === 'outputs' && renderBreakdownTable(data.breakdown.outputs)}
              {subTab === 'inputs'  && renderBreakdownTable(data.breakdown.inputs)}
              {subTab === 'backup'  && <BackupReport data={data} filing={filedReturn} journal={journal} />}
              {subTab === 'ai_review' && (
                <VatReturnReviewPanel
                  bookId={bookId}
                  from={data.from}
                  to={data.to}
                  vatScheme={data.vat_scheme}
                  vatRegistered={data.vat_registered}
                  boxes={{
                    box1: data.boxes.box1.value, box2: data.boxes.box2.value, box3: data.boxes.box3.value,
                    box4: data.boxes.box4.value, box5: data.boxes.box5.value, box6: data.boxes.box6.value,
                    box7: data.boxes.box7.value, box8: data.boxes.box8.value, box9: data.boxes.box9.value,
                  }}
                  lateEntryVat={data.late_entry_vat}
                  outputs={data.breakdown.outputs}
                  inputs={data.breakdown.inputs}
                />
              )}

              {/* Print-only backup view: always render BackupReport when printing. */}
              <div className="hidden print:block">
                <BackupReport data={data} filing={filedReturn} journal={journal} />
              </div>
            </>
          ) : null}
        </div>

        {/* Tab footer — pill-style, matches AccountsLedgerView's pattern */}
        {data && (
          <div className="border-t border-slate-200 px-3 py-2 flex items-center gap-2 bg-slate-50/40 flex-wrap print:hidden">
            {([
              { id: 'summary' as const, label: 'VAT return' },
              { id: 'journal' as const, label: 'Double entry' },
              { id: 'outputs' as const, label: `Outputs (${data.breakdown.outputs.length})` },
              { id: 'inputs'  as const, label: `Inputs (${data.breakdown.inputs.length})` },
              { id: 'backup'  as const, label: 'Backup report' },
              { id: 'ai_review' as const, label: 'AI review' },
            ]).map(t => {
              const active = subTab === t.id;
              const isAi = t.id === 'ai_review';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id)}
                  className={`text-xs px-2.5 py-1 rounded-md border transition-colors inline-flex items-center gap-1 ${
                    isAi
                      ? (active
                          ? 'bg-amber-100 text-amber-800 border-amber-300'
                          : 'text-amber-700 border-amber-200 bg-amber-50/60 hover:bg-amber-50')
                      : (active
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'text-slate-600 border-transparent hover:bg-slate-100 hover:text-slate-800')
                  }`}
                >
                  {isAi && <Sparkles size={11} />}
                  {t.label}
                </button>
              );
            })}
            <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
              {formatDateUk(data.from)} – {formatDateUk(data.to)}
            </span>
          </div>
        )}

        {/* Mark-as-filed modal */}
        {fileModalOpen && data && period.from && period.to && (
          <MarkAsFiledModal
            open
            onClose={() => setFileModalOpen(false)}
            bookId={bookId}
            periodFrom={period.from}
            periodTo={period.to}
            box5={data.boxes.box5.value}
            lateEntryVat={data.late_entry_vat}
            onFiled={() => { setFileModalOpen(false); setRefreshKey(k => k + 1); }}
          />
        )}

        {/* MTD submission */}
        {mtdOpen && data && (
          <MtdSubmitModal
            bookId={bookId}
            fromIso={data.from}
            toIso={data.to}
            boxes={{
              box1: data.boxes.box1.value, box2: data.boxes.box2.value, box3: data.boxes.box3.value,
              box4: data.boxes.box4.value, box5: data.boxes.box5.value, box6: data.boxes.box6.value,
              box7: data.boxes.box7.value, box8: data.boxes.box8.value, box9: data.boxes.box9.value,
            }}
            lateEntryVat={data.late_entry_vat}
            onClose={() => setMtdOpen(false)}
            onSubmitted={() => setRefreshKey(k => k + 1)}
          />
        )}

        {/* Open obligations lightbox — pick a period HMRC has open. */}
        {obligationsOpen && (
          <div className="fixed inset-0 z-[1100] flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto print:hidden" onMouseDown={() => setObligationsOpen(false)}>
            <div className="w-full max-w-2xl my-10 relative rounded-2xl bg-white shadow-2xl p-5" onMouseDown={e => e.stopPropagation()}>
              <button type="button" onClick={() => setObligationsOpen(false)} aria-label="Close" className="absolute top-3 right-3 text-slate-400 hover:text-slate-700"><X size={18} /></button>
              <VatObligationsPanel
                bookId={bookId}
                onUsePeriod={(from, to) => { setMode('compute'); setSelectedFilingId(null); setPeriod({ from, to }); setSubTab('summary'); setObligationsOpen(false); }}
              />
            </div>
          </div>
        )}

        {/* Right-click row actions on the Outputs / Inputs breakdown rows */}
        {rowActions.menus}
      </div>
    </div>
  );
}

// ── Backup report ───────────────────────────────────────────────────────────
function BackupReport({
  data, filing, journal,
}: { data: VatReturnResponse; filing: FiledReturn | null; journal: FilingJournal | null }) {
  return (
    <div className="space-y-3 text-sm">
      <h3 className="text-base font-semibold text-slate-900">
        VAT return backup report
        {filing?.ref_no && <span className="ml-2 font-mono text-slate-600">{filing.ref_no}</span>}
      </h3>
      <div className="text-xs text-slate-600">
        Period {formatDateUk(data.from)} – {formatDateUk(data.to)}
        {filing && (
          <>
            <br />Filed {formatDateTimeUk(filing.filed_at)}
            {filing.filed_by_name && <> by {filing.filed_by_name}</>}
            {filing.submitted_at && <>{' · '}submitted to HMRC {formatJustDateUk(filing.submitted_at)}</>}
            {filing.hmrc_reference && <>{' · '}HMRC ref <span className="font-mono">{filing.hmrc_reference}</span></>}
            {filing.notes && <><br />Notes: {filing.notes}</>}
          </>
        )}
      </div>

      <div className="border border-slate-300">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="px-3 py-1.5 text-left w-16 border-r border-slate-300">Box</th>
              <th className="px-3 py-1.5 text-left border-r border-slate-300">Description</th>
              <th className="px-3 py-1.5 text-right w-32">Value (£)</th>
            </tr>
          </thead>
          <tbody>
            {(['box1','box2','box3','box4','box5','box6','box7','box8','box9'] as const).map((k, i) => (
              <tr key={k} className="border-t border-slate-200">
                <td className="px-3 py-1 text-slate-500 border-r border-slate-200 tabular-nums">{i + 1}</td>
                <td className="px-3 py-1 text-slate-700 border-r border-slate-200">{data.boxes[k].label}</td>
                <td className="px-3 py-1 text-right tabular-nums text-slate-900">{fmt(data.boxes[k].value)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-amber-50/30">
              <td className="px-3 py-1 text-right text-slate-400 border-r border-slate-200 text-[10px]">of which</td>
              <td className="px-3 py-1 text-slate-600 italic border-r border-slate-200">Late entries from prior periods (VAT in Box 1/Box 4)</td>
              <td className="px-3 py-1 text-right tabular-nums italic text-slate-700">{fmt(data.late_entry_vat)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {journal && (
        <div>
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
            Closing journal — {journal.ref_no} dated {formatDateUk(journal.date)}
          </h4>
          <div className="border border-slate-300">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-1 text-left border-r border-slate-300">Account</th>
                  <th className="px-3 py-1 text-left border-r border-slate-300">Entry details</th>
                  <th className="px-3 py-1 text-right w-24 border-r border-slate-300">Debit</th>
                  <th className="px-3 py-1 text-right w-24">Credit</th>
                </tr>
              </thead>
              <tbody>
                {(journal.splits ?? []).map(s => (
                  <tr key={s.id} className="border-t border-slate-200">
                    <td className="px-3 py-1 text-slate-700 border-r border-slate-200">{s.account ? `${s.account.ledger ? s.account.ledger + ': ' : ''}${s.account.name}` : '—'}</td>
                    <td className="px-3 py-1 text-slate-700 border-r border-slate-200">{s.entry_details ?? ''}</td>
                    <td className="px-3 py-1 text-right tabular-nums border-r border-slate-200">{s.debit > 0 ? fmt(s.debit) : ''}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{s.credit > 0 ? fmt(s.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
          Outputs ({data.breakdown.outputs.length}) — contributing to Box 1 + Box 6
        </h4>
        <BackupBreakdown rows={data.breakdown.outputs} />
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-1">
          Inputs ({data.breakdown.inputs.length}) — contributing to Box 4 + Box 7
        </h4>
        <BackupBreakdown rows={data.breakdown.inputs} />
      </div>

      <div className="pt-4 mt-4 border-t border-slate-300 text-[10px] text-slate-500">
        Generated by SMITH bookkeeping · {new Date().toLocaleString('en-GB')}
      </div>
    </div>
  );
}

function BackupBreakdown({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-slate-400">None.</p>;
  return (
    <div className="border border-slate-300">
      <table className="w-full text-xs border-collapse">
        <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
          <tr>
            <th className="px-2 py-1 text-left w-20 border-r border-slate-300">Date</th>
            <th className="px-2 py-1 text-left w-20 border-r border-slate-300">Ref</th>
            <th className="px-2 py-1 text-left w-12 border-r border-slate-300">Type</th>
            <th className="px-2 py-1 text-left border-r border-slate-300">Payee / details</th>
            <th className="px-2 py-1 text-right w-20 border-r border-slate-300">Net</th>
            <th className="px-2 py-1 text-right w-20 border-r border-slate-300">VAT</th>
            <th className="px-2 py-1 text-right w-14 border-r border-slate-300">Rate</th>
            <th className="px-2 py-1 text-right w-20">Gross</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="border-t border-slate-200">
              <td className="px-2 py-1 tabular-nums border-r border-slate-200">
                {formatDateUk(row.date)}{row.is_late_entry && <span className="text-amber-700"> (late)</span>}
              </td>
              <td className="px-2 py-1 border-r border-slate-200">
                <TxnRefLink
                  txn={{ id: row.id, type: row.type as TransactionType, ref_no: row.ref_no }}
                  className="text-xs print:text-slate-700"
                />
              </td>
              <td className="px-2 py-1 border-r border-slate-200">{row.type}</td>
              <td className="px-2 py-1 border-r border-slate-200">{row.payee_text ?? row.details ?? ''}</td>
              <td className="px-2 py-1 text-right tabular-nums border-r border-slate-200">{row.sign === -1 ? '−' : ''}{fmt(row.net)}</td>
              <td className="px-2 py-1 text-right tabular-nums border-r border-slate-200">{row.sign === -1 ? '−' : ''}{fmt(row.vat_total)}</td>
              <td className="px-2 py-1 text-right tabular-nums text-slate-500 border-r border-slate-200">{rateLabel(row)}</td>
              <td className="px-2 py-1 text-right tabular-nums">{row.sign === -1 ? '−' : ''}{fmt(row.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
