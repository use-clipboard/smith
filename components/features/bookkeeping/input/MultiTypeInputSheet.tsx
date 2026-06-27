'use client';

/**
 * MultiTypeInputSheet — VT Transaction+ "Universal Input Sheet" equivalent.
 *
 * A single Excel-style grid for entering MANY transactions of DIFFERENT types
 * and dates in one batch. Unlike the single-type UniversalInputSheet (which the
 * quick-entry toast uses), every row here carries its own Type column, so a PAY,
 * a REC and a SIN can sit on consecutive rows and post together — each becomes
 * its own transaction with its own reference.
 *
 * Scope (v1): the ten single-line transaction types
 *   PAY · CHQ · REC · TRF · SIN · SCR · PIN · PCR · WOF · WBK
 * Multi-leg journals (JRN/RJN/YET/DVT) are NOT entered here — they stay in the
 * dedicated journal sheet / quick-entry toast, because a balancing multi-leg
 * journal doesn't map onto a single flat row.
 *
 * Per row the Type drives everything (via transactionTypeConfig): which ledger
 * the primary-account picker filters to, whether VAT applies and in which
 * direction, and the Dr/Cr layout (through the shared buildSplits). All the
 * accounting logic is reused from the same primitives the single-type sheet
 * uses, so the two stay consistent.
 *
 * Import: paste from the clipboard or load a CSV / text file to populate the
 * grid for review before posting (see parseImport).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Trash2, ClipboardPaste, FileUp, Info } from 'lucide-react';
import AccountPicker from './AccountPicker';
import LedgerPicker from './LedgerPicker';
import FundPicker from './FundPicker';
import DateInput, { parseUkDateStrict } from './DateInput';
import PayeeAutocomplete, { type PayeeSuggestion } from './PayeeAutocomplete';
import Tooltip from '@/components/ui/Tooltip';
import { formatMoneyAbs } from '@/lib/bookkeeping/formatMoney';
import {
  VAT_TREATMENT_OPTIONS,
  type BookAccountRef, type Transaction, type VatTreatment,
} from '@/types/bookkeeping';
import { TRANSACTION_TYPE_CONFIG } from '@/lib/bookkeeping/transactionTypeConfig';
import { buildSplits } from '@/lib/bookkeeping/buildSplits';
import { checkRecLock, type RecLockHit, type RecLockProbe } from '@/lib/bookkeeping/checkRecLock';
import RecLockWarningModal from '../ledger/RecLockWarningModal';

// The ten single-line types this grid handles — exactly the keys of the config.
type SingleType = keyof typeof TRANSACTION_TYPE_CONFIG;
const TYPE_GROUPS: { label: string; types: SingleType[] }[] = [
  { label: 'Bank',        types: ['PAY', 'CHQ', 'REC', 'TRF'] },
  { label: 'Sales',       types: ['SIN', 'SCR'] },
  { label: 'Purchases',   types: ['PIN', 'PCR'] },
  { label: 'Adjustments', types: ['WOF', 'WBK'] },
];

interface Props {
  bookId: string;
  vatRegistered: boolean;
  /** Book VAT scheme — when 'flat_rate', purchase rows get a capital-reclaim toggle. */
  vatScheme?: string | null;
  vatLockDate?: string | null;
  /** End of the currently-selected period — new rows default their date here. */
  defaultDateIso?: string | null;
  /** Type the first blank row starts on (e.g. from a "+ Add transaction"). */
  initialType?: SingleType;
  onPosted?: (txn: Transaction) => void;
}

// ── Helpers (shared shape with UniversalInputSheet) ────────────────────────────
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}
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
function cfgFor(t: SingleType) { return TRANSACTION_TYPE_CONFIG[t]; }

// ── Row state ──────────────────────────────────────────────────────────────────
interface Row {
  id: string;
  type: SingleType;
  date: string;
  primary: BookAccountRef | null;
  details: string;
  totalText: string;
  vatTreatment: VatTreatment;
  analysisLedger: string;
  analysis: BookAccountRef | null;
  entryDetails: string;
  notes: string;
  includeInNextReturn: boolean;
  /** FRS — purchase flagged as a reclaimable capital asset. */
  frsCapital: boolean;
  /** Charity fund (NULL on non-charity books — the Fund column is hidden). */
  fund: string | null;
}

function makeBlankRow(vatRegistered: boolean, type: SingleType, defaultDateUk: string, seed: Partial<Row> = {}): Row {
  const cfg = cfgFor(type);
  return {
    id: Math.random().toString(36).slice(2),
    type,
    date: seed.date ?? defaultDateUk,
    primary: seed.primary ?? null,
    details: '',
    totalText: '',
    vatTreatment: seed.vatTreatment ?? (vatRegistered && cfg.hasVat ? 'standard_20' : 'no_vat'),
    analysisLedger: seed.analysisLedger ?? cfg.analysisLedger ?? '',
    analysis: seed.analysis ?? null,
    entryDetails: seed.entryDetails ?? '',
    notes: '',
    includeInNextReturn: true,
    frsCapital: seed.frsCapital ?? false,
    fund: seed.fund ?? null,
  };
}

function isLateEntry(row: Row, vatLockDate: string | null | undefined, rate: number): boolean {
  if (!vatLockDate || rate <= 0) return false;
  const iso = parseUkDateStrict(row.date);
  return iso ? iso <= vatLockDate : false;
}

// ── Import parsing ─────────────────────────────────────────────────────────────
/** A single account, as returned by the accounts endpoint. */
interface AccountLite { id: string; name: string; ledger: string | null; account_type: BookAccountRef['account_type'] }

function normName(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Resolve a free-text account name to a book account. Accepts "Ledger: Name"
 *  or a bare name; optionally constrained to a ledger. Exact (normalised) match
 *  wins, then a substring match. Returns null when nothing's close enough. */
function matchAccount(raw: string, accounts: AccountLite[], ledger?: string | null): BookAccountRef | null {
  const cleaned = raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
  const target = normName(cleaned);
  if (!target) return null;
  const pool = ledger ? accounts.filter(a => a.ledger === ledger) : accounts;
  const exact = pool.find(a => normName(a.name) === target)
    ?? accounts.find(a => normName(a.name) === target);
  const hit = exact
    ?? pool.find(a => normName(a.name).includes(target) || target.includes(normName(a.name)))
    ?? accounts.find(a => normName(a.name).includes(target) || target.includes(normName(a.name)));
  return hit ? { id: hit.id, name: hit.name, ledger: hit.ledger, account_type: hit.account_type } : null;
}

function toUkDate(s: string): string {
  const t = s.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : parseUkDateStrict(t);
  return iso ? formatDateUk(iso) : t; // leave as-typed if unparseable — user fixes
}

/** Split one delimited line, honouring double-quoted fields for CSV. */
function splitLine(line: string, delim: string): string[] {
  if (delim === '\t') return line.split('\t');
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

type ColKey = 'type' | 'date' | 'primary' | 'details' | 'total' | 'vat' | 'analysis' | 'entry' | 'notes';
const HEADER_ALIASES: Record<ColKey, string[]> = {
  type:    ['type'],
  date:    ['date'],
  primary: ['primary', 'primaryaccount', 'bank', 'bankaccount', 'supplier', 'customer'],
  details: ['details', 'payee', 'description', 'narrative'],
  total:   ['total', 'amount', 'gross'],
  vat:     ['vat', 'vattreatment', 'vatrate'],
  analysis:['analysis', 'analysisaccount', 'nominal', 'category', 'incomeaccount', 'expenseaccount'],
  entry:   ['entrydetails', 'entrynote'],
  notes:   ['notes', 'transactionnotes', 'note'],
};
// Positional fallback order when there's no header row.
const POSITIONAL: ColKey[] = ['type', 'date', 'primary', 'details', 'total', 'analysis', 'entry', 'notes'];

interface ParsedImport { rows: Row[]; matched: number; unmatched: number; skipped: number }

function parseImport(
  text: string,
  accounts: AccountLite[],
  vatRegistered: boolean,
  defaultDateUk: string,
): ParsedImport {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], matched: 0, unmatched: 0, skipped: 0 };
  const delim = lines[0].includes('\t') ? '\t' : ',';

  // Header detection: a first row mentioning "type" and a total/amount column.
  const firstCells = splitLine(lines[0], delim).map(c => normName(c));
  const looksLikeHeader = firstCells.includes('type') && firstCells.some(c => c === 'total' || c === 'amount' || c === 'gross');
  let colMap: Partial<Record<ColKey, number>> = {};
  let dataLines = lines;
  if (looksLikeHeader) {
    (Object.keys(HEADER_ALIASES) as ColKey[]).forEach(key => {
      const idx = firstCells.findIndex(c => HEADER_ALIASES[key].includes(c));
      if (idx >= 0) colMap[key] = idx;
    });
    dataLines = lines.slice(1);
  } else {
    POSITIONAL.forEach((key, i) => { colMap[key] = i; });
  }

  const validTypes = new Set(Object.keys(TRANSACTION_TYPE_CONFIG));
  const rows: Row[] = [];
  let matched = 0, unmatched = 0, skipped = 0;

  for (const line of dataLines) {
    const cells = splitLine(line, delim).map(c => c.trim().replace(/^"|"$/g, ''));
    const get = (k: ColKey) => (colMap[k] != null ? (cells[colMap[k] as number] ?? '') : '');

    const typeRaw = get('type').toUpperCase();
    if (!validTypes.has(typeRaw)) { skipped++; continue; } // unknown/journal type — skip
    const type = typeRaw as SingleType;
    const cfg = cfgFor(type);

    const row = makeBlankRow(vatRegistered, type, defaultDateUk);
    const dateRaw = get('date');
    if (dateRaw) row.date = toUkDate(dateRaw);
    row.details = get('details');
    const totalRaw = get('total');
    if (totalRaw) row.totalText = totalRaw.replace(/[,£\s]/g, '');
    row.entryDetails = get('entry');
    row.notes = get('notes');

    const primaryRaw = get('primary');
    if (primaryRaw) {
      const a = matchAccount(primaryRaw, accounts, cfg.primaryLedger);
      if (a) { row.primary = a; matched++; } else unmatched++;
    }
    const analysisRaw = get('analysis');
    if (analysisRaw) {
      const a = matchAccount(analysisRaw, accounts, cfg.analysisLedger);
      if (a) { row.analysis = a; row.analysisLedger = a.ledger ?? row.analysisLedger; matched++; }
      else unmatched++;
    }
    rows.push(row);
  }
  return { rows, matched, unmatched, skipped };
}

// ── Component ────────────────────────────────────────────────────────────────
export default function MultiTypeInputSheet({
  bookId, vatRegistered, vatScheme, vatLockDate, defaultDateIso, initialType = 'PAY', onPosted,
}: Props) {
  const defaultDateUk = defaultDateIso ? formatDateUk(defaultDateIso) : formatDateUk(todayIso());
  // Book-level: show the VAT/Net columns at all. Per row, the cell is only
  // editable when that row's type carries VAT.
  const showVatColumns = vatRegistered;
  // Flat Rate Scheme books get a capital-reclaim column on purchase rows.
  const isFrs = vatScheme === 'flat_rate';
  const PURCHASE_TYPES = new Set(['PIN', 'PAY', 'CHQ', 'PCR']);

  const [rows, setRows] = useState<Row[]>(() => [makeBlankRow(vatRegistered, initialType, defaultDateUk)]);
  const [postingProgress, setPostingProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [importNote, setImportNote] = useState('');
  const [vatInputId, setVatInputId] = useState<string | null>(null);
  const [vatOutputId, setVatOutputId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [recLockHits, setRecLockHits] = useState<RecLockHit[] | null>(null);
  const [pendingLive, setPendingLive] = useState<Array<{ r: Row; idx: number }> | null>(null);
  const [hasFunds, setHasFunds] = useState(false);

  const tableRef = useRef<HTMLTableElement>(null);
  const pendingFocusRowId = useRef<string | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  // Focus a freshly-appended row's first cell.
  useEffect(() => {
    if (!pendingFocusRowId.current) return;
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${pendingFocusRowId.current}"][data-cell="total"]`);
    el?.focus();
    pendingFocusRowId.current = null;
  }, [rows.length]);

  // VAT control-account ids + the full COA (for import matching).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}/vat-accounts`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) { setVatInputId(d.input_account_id ?? null); setVatOutputId(d.output_account_id ?? null); } })
      .catch(() => {});
    fetch(`/api/bookkeeping/books/${bookId}/accounts?pickable_only=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setAccounts((d.accounts ?? []) as AccountLite[]); })
      .catch(() => {});
    fetch(`/api/bookkeeping/books/${bookId}/funds`)
      .then(r => r.ok ? r.json() : { funds: [] })
      .then(d => { if (!cancelled) setHasFunds(((d.funds ?? []) as unknown[]).length > 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  // Keep blank starter rows in step with the selected period's end date. The
  // grid mounts before the year/period bar has emitted activePeriod, so the
  // initial row would otherwise be stuck on today's date. We only retouch rows
  // the user hasn't started filling, so a typed-in date is never clobbered.
  useEffect(() => {
    setRows(prev => prev.map(r => {
      const untouched = !r.primary && !r.analysis && !r.totalText && !r.details && !r.entryDetails;
      return untouched && r.date !== defaultDateUk ? { ...r, date: defaultDateUk } : r;
    }));
  }, [defaultDateUk]);

  // ── Row mutations ──────────────────────────────────────────────────────────
  function updateRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function changeType(id: string, type: SingleType) {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const cfg = cfgFor(type);
      // Primary ledger filter changes with type, so the old picks may be
      // invalid — clear them. Reset analysis ledger to the type's default.
      return {
        ...r,
        type,
        primary: null,
        analysis: null,
        analysisLedger: cfg.analysisLedger ?? '',
        vatTreatment: vatRegistered && cfg.hasVat
          ? (r.vatTreatment === 'no_vat' ? 'standard_20' : r.vatTreatment)
          : 'no_vat',
      };
    }));
  }
  function inheritSeed(): Partial<Row> {
    const last = rows[rows.length - 1];
    return last ? { date: last.date, vatTreatment: last.vatTreatment, fund: last.fund } : {};
  }
  function appendRow() {
    const last = rows[rows.length - 1];
    const type = last?.type ?? 'PAY';
    setRows(prev => [...prev, makeBlankRow(vatRegistered, type, defaultDateUk, inheritSeed())]);
  }
  function removeRow(id: string) {
    setRows(prev => prev.length <= 1 ? prev : prev.filter(r => r.id !== id));
  }
  function resetToBlanks() {
    setRows([makeBlankRow(vatRegistered, initialType, defaultDateUk)]);
    setImportNote('');
  }

  function handlePayeePicked(rowId: string, p: PayeeSuggestion) {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const cfg = cfgFor(r.type);
      return {
        ...r,
        details: p.payee_display,
        analysis: p.analysis_account
          ? { id: p.analysis_account.id, name: p.analysis_account.name, ledger: p.analysis_account.ledger, account_type: r.analysis?.account_type ?? 'asset' }
          : r.analysis,
        analysisLedger: p.analysis_account?.ledger ?? r.analysisLedger,
        vatTreatment: vatRegistered && cfg.hasVat && p.vat_treatment ? p.vat_treatment : r.vatTreatment,
        entryDetails: !r.entryDetails && p.entry_details ? p.entry_details : r.entryDetails,
      };
    }));
    setTimeout(() => {
      tableRef.current?.querySelector<HTMLInputElement>(`input[data-row-id="${rowId}"][data-cell="total"]`)?.focus();
    }, 0);
  }

  // ── Per-row VAT calc ─────────────────────────────────────────────────────────
  const rowCalcs = useMemo(() => rows.map(r => {
    const cfg = cfgFor(r.type);
    const total = parseAmount(r.totalText);
    const rate = vatRegistered && cfg.hasVat ? rateFor(r.vatTreatment) : 0;
    const { vat, net } = splitVatFromGross(total, rate);
    return { total, rate, vat, net, cfg, hasVat: vatRegistered && cfg.hasVat };
  }), [rows, vatRegistered]);

  const lateRows = useMemo(
    () => rows.map((r, i) => isLateEntry(r, vatLockDate, rowCalcs[i].rate)),
    [rows, rowCalcs, vatLockDate],
  );
  const hasLateRows = lateRows.some(Boolean);

  // ── Import ───────────────────────────────────────────────────────────────────
  function applyImport(text: string) {
    setError(''); setImportNote('');
    const { rows: parsed, matched, unmatched, skipped } = parseImport(text, accounts, vatRegistered, defaultDateUk);
    if (parsed.length === 0) {
      setError(skipped > 0
        ? `Nothing imported — ${skipped} row(s) had an unrecognised type. Use one of: ${TYPE_GROUPS.flatMap(g => g.types).join(', ')}.`
        : 'Nothing to import — the clipboard/file was empty or unreadable.');
      return;
    }
    // Replace a lone blank starter row; otherwise append.
    setRows(prev => {
      const onlyBlankStarter = prev.length === 1 && !prev[0].primary && !prev[0].analysis && !prev[0].totalText && !prev[0].details;
      return onlyBlankStarter ? parsed : [...prev, ...parsed];
    });
    const bits = [`Imported ${parsed.length} row${parsed.length === 1 ? '' : 's'}`];
    if (unmatched > 0) bits.push(`${unmatched} account${unmatched === 1 ? '' : 's'} couldn't be matched — pick them manually (highlighted empty)`);
    if (skipped > 0) bits.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped (unknown type)`);
    setImportNote(bits.join(' · '));
  }
  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      applyImport(text);
    } catch {
      setError('Could not read the clipboard. Your browser may need permission — or paste into a text file and use "Text file" instead.');
    }
  }
  function importFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => applyImport(String(reader.result ?? ''));
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  }

  // ── Post ───────────────────────────────────────────────────────────────────
  async function handlePost() {
    setError('');
    const live = rows
      .map((r, idx) => ({ r, idx, c: rowCalcs[idx] }))
      .filter(({ r, c }) => r.primary && r.analysis && c.total >= 0);

    if (live.length === 0) {
      setError('Add at least one row with a primary account and an analysis account. Total can be 0 for placeholder entries.');
      return;
    }
    for (const { r, idx } of live) {
      const lineNo = idx + 1;
      const iso = parseUkDateStrict(r.date);
      if (!iso) { setError(`Row ${lineNo}: "${r.date}" isn't a valid date — use dd/mm/yyyy.`); return; }
      if (r.primary!.id === r.analysis!.id) { setError(`Row ${lineNo}: Primary and analysis must be different accounts.`); return; }
      if (hasFunds && !r.fund) { setError(`Row ${lineNo}: pick a fund.`); return; }
    }

    const probes: RecLockProbe[] = [];
    for (const { r } of live) {
      const iso = parseUkDateStrict(r.date);
      if (!iso) continue;
      if (r.primary?.ledger === 'Bank') probes.push({ accountId: r.primary.id, date: iso, accountName: `${r.primary.ledger}: ${r.primary.name}` });
      if (r.analysis?.ledger === 'Bank') probes.push({ accountId: r.analysis.id, date: iso, accountName: `${r.analysis.ledger}: ${r.analysis.name}` });
    }
    if (probes.length > 0) {
      const hits = await checkRecLock(bookId, probes);
      if (hits.length > 0) { setRecLockHits(hits); setPendingLive(live.map(({ r, idx }) => ({ r, idx }))); return; }
    }
    await doPost(live.map(({ r, idx }) => ({ r, idx })));
  }

  async function doPost(live: Array<{ r: Row; idx: number }>) {
    setPostingProgress({ done: 0, total: live.length });
    try {
      for (let i = 0; i < live.length; i++) {
        const { r, idx } = live[i];
        const c = rowCalcs[idx];
        const cfg = cfgFor(r.type);
        const iso = parseUkDateStrict(r.date)!;
        const splits = buildSplits({
          config: cfg,
          primaryAccountId: r.primary!.id,
          analysisAccountId: r.analysis!.id,
          total: c.total, vat: c.vat, net: c.net,
          vatInputAccountId: vatInputId,
          vatOutputAccountId: vatOutputId,
          entryDetails: r.entryDetails || null,
          notes: r.notes || null,
          fundId: r.fund,
        });
        const lateEntry = lateRows[idx] && r.includeInNextReturn;
        const res = await fetch(`/api/bookkeeping/books/${bookId}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: r.type,
            date: iso,
            payee_text: r.details || null,
            details: r.details || null,
            total: c.total,
            vat_total: c.hasVat ? c.vat : 0,
            vat_rate: c.hasVat ? c.rate : null,
            vat_treatment: c.hasVat ? r.vatTreatment : null,
            primary_account_id: r.primary!.id,
            splits,
            late_entry: lateEntry,
            frs_capital_reclaim: isFrs && PURCHASE_TYPES.has(r.type) ? r.frsCapital : false,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          if (res.status === 409 && d.error === 'late_entry_required') {
            throw new Error(`Row ${idx + 1}: ${d.message ?? 'Date falls in a filed VAT period — tick "Include in next return" or change the date.'}`);
          }
          throw new Error(`Row ${idx + 1}: ${d.error ?? 'Post failed'}`);
        }
        const d = await res.json();
        onPosted?.(d.transaction as Transaction);
        setPostingProgress({ done: i + 1, total: live.length });
      }
      resetToBlanks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed');
    } finally {
      setPostingProgress(null);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    const posting = postingProgress !== null;
    if (e.key === 'Enter' && !e.shiftKey && !posting) {
      const target = e.target as HTMLElement;
      if (target.closest('[role="listbox"]')) return;
      if (target.tagName === 'SELECT') return;
      e.preventDefault();
      void handlePost();
    } else if (e.key === 'Escape') {
      setError('');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const posting = postingProgress !== null;
  const colSpanBase = (showVatColumns ? 11 : 9) + (isFrs ? 1 : 0) + (hasFunds ? 1 : 0);

  return (
    <div onKeyDown={handleKey} className="space-y-3">
      {/* Toolbar: import + row actions */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Import from</span>
        <button type="button" onClick={importFromClipboard} className="inline-flex items-center gap-1 text-indigo-700 hover:underline">
          <ClipboardPaste size={13} /> Clipboard
        </button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={() => csvInputRef.current?.click()} className="inline-flex items-center gap-1 text-indigo-700 hover:underline">
          <FileUp size={13} /> CSV file
        </button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={() => textInputRef.current?.click()} className="inline-flex items-center gap-1 text-indigo-700 hover:underline">
          <FileUp size={13} /> Text file
        </button>
        <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importFromFile(f); e.target.value = ''; }} />
        <input ref={textInputRef} type="file" accept=".txt,.tsv,text/plain" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importFromFile(f); e.target.value = ''; }} />

        <div className="flex-1" />

        <button type="button" onClick={appendRow} className="text-indigo-700 hover:underline">Insert row</button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={() => setRows(prev => prev.length <= 1 ? prev : prev.slice(0, -1))}
          disabled={rows.length <= 1}
          className="text-indigo-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-not-allowed">Delete row</button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={resetToBlanks} className="text-indigo-700 hover:underline">Delete all rows</button>
        <span className="text-slate-300">·</span>
        <button type="button" onClick={() => setRows(prev => prev.map(r => ({ ...r, totalText: '' })))} className="text-indigo-700 hover:underline">Clear all amounts</button>
      </div>

      {/* What can be entered here — journals live in the + quick-entry menu. */}
      <div className="flex items-start gap-1.5 rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
        <Info size={13} className="mt-px shrink-0 text-slate-400" />
        <span>
          This sheet takes bank, sales, purchase &amp; adjustment transactions —{' '}
          <span className="font-mono text-slate-600">PAY · CHQ · REC · TRF · SIN · SCR · PIN · PCR · WOF · WBK</span>.
          {' '}Multi-leg journals (<span className="font-mono text-slate-600">JRN · RJN · YET · DVT</span>) are entered from the{' '}
          <span className="font-semibold text-slate-600">+</span> quick-entry menu in the side rail.
        </span>
      </div>

      {importNote && (
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5">{importNote}</div>
      )}

      {/* Entry grid */}
      <div className="border border-slate-300 rounded-md overflow-x-auto bg-white">
        <table ref={tableRef} className="w-full text-sm border-collapse">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase tracking-wide">
            <tr>
              <th className="px-2 py-1.5 text-center w-9 border-r border-slate-300">#</th>
              <th className="px-2 py-1.5 text-left w-20 border-r border-slate-300">Type</th>
              <th className="px-2 py-1.5 text-left w-32 border-r border-slate-300">Date</th>
              <th className="px-2 py-1.5 text-left w-44 border-r border-slate-300">Primary a/c</th>
              <th className="px-2 py-1.5 text-left border-r border-slate-300">Details (payee)</th>
              <th className="px-2 py-1.5 text-right w-24 border-r border-slate-300">{showVatColumns ? 'Total' : 'Amount'}</th>
              {showVatColumns && <th className="px-2 py-1.5 text-left w-36 border-r border-slate-300">VAT</th>}
              {showVatColumns && <th className="px-2 py-1.5 text-right w-24 border-r border-slate-300">Net</th>}
              <th className="px-2 py-1.5 text-left w-40 border-r border-slate-300">Analysis ledger</th>
              <th className="px-2 py-1.5 text-left w-52 border-r border-slate-300">Analysis account</th>
              {hasFunds && <th className="px-2 py-1.5 text-left w-44 border-r border-slate-300">Fund</th>}
              {isFrs && <th className="px-2 py-1.5 text-center w-16 border-r border-slate-300" title="Reclaimable capital asset (Flat Rate Scheme)">Capital</th>}
              <th className="px-2 py-1.5 text-left">Entry details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isLastRow = idx === rows.length - 1;
              const c = rowCalcs[idx];
              const cfg = c.cfg;
              return (
                <tr key={r.id} className="border-t border-slate-200 align-top">
                  {/* # / hover-trash */}
                  <td className="px-2 py-0 w-9 border-r border-slate-200 text-center bg-slate-50 group relative">
                    <span className="text-[11px] text-slate-500 tabular-nums group-hover:invisible">{idx + 1}</span>
                    <button type="button" onClick={() => removeRow(r.id)} disabled={rows.length <= 1}
                      aria-label={`Remove row ${idx + 1}`}
                      className="absolute inset-0 flex items-center justify-center text-rose-500 hover:text-rose-700 opacity-0 group-hover:opacity-100 disabled:hidden">
                      <Trash2 size={11} />
                    </button>
                  </td>

                  {/* Type */}
                  <td className="px-0 py-0 border-r border-slate-200">
                    <select
                      data-row-id={r.id}
                      data-cell="type"
                      value={r.type}
                      onChange={e => changeType(r.id, e.target.value as SingleType)}
                      className="w-full text-sm px-2 py-1.5 border-0 bg-transparent font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                    >
                      {TYPE_GROUPS.map(g => (
                        <optgroup key={g.label} label={g.label}>
                          {g.types.map(t => <option key={t} value={t}>{t}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>

                  {/* Date */}
                  <td className={`px-0 py-0 border-r border-slate-200 ${lateRows[idx] ? 'bg-amber-50/40' : ''}`}>
                    <DateInput
                      value={r.date}
                      onChange={v => updateRow(r.id, { date: v })}
                      data-row-id={r.id}
                      data-cell="date"
                      className={`px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset ${lateRows[idx] ? 'focus:ring-amber-500' : 'focus:ring-indigo-500'}`}
                    />
                  </td>

                  {/* Primary */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <AccountPicker
                      bookId={bookId}
                      value={r.primary?.id ?? null}
                      valueDisplay={r.primary ? r.primary.name : undefined}
                      onChange={a => updateRow(r.id, { primary: a })}
                      ledgerFilter={cfg.primaryLedger ?? undefined}
                      placeholder={`${cfg.primaryLabel}…`}
                      className="!border-none"
                    />
                  </td>

                  {/* Details */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <PayeeAutocomplete
                      bookId={bookId}
                      type={r.type}
                      value={r.details}
                      onChange={v => updateRow(r.id, { details: v })}
                      onSelectPayee={p => handlePayeePicked(r.id, p)}
                      placeholder={cfg.family === 'sales' || cfg.family === 'purchases' ? 'Invoice description / reference' : 'Payee / description'}
                      inputAttrs={{ 'data-row-id': r.id, 'data-cell': 'details' } as React.InputHTMLAttributes<HTMLInputElement>}
                    />
                  </td>

                  {/* Total */}
                  <td className="px-0 py-0 border-r border-slate-200">
                    <input
                      data-row-id={r.id} data-cell="total" type="text" inputMode="decimal"
                      value={r.totalText}
                      onChange={e => updateRow(r.id, { totalText: e.target.value })}
                      placeholder="0.00"
                      className="w-full text-sm px-2 py-1.5 border-0 bg-transparent text-right focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 tabular-nums"
                    />
                  </td>

                  {/* VAT */}
                  {showVatColumns && (
                    <td className="px-0 py-0 border-r border-slate-200">
                      {c.hasVat ? (
                        <select
                          data-row-id={r.id} data-cell="vat"
                          value={r.vatTreatment}
                          onChange={e => updateRow(r.id, { vatTreatment: e.target.value as VatTreatment })}
                          className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                        >
                          {VAT_TREATMENT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                      ) : (
                        <div className="text-sm px-2 py-1.5 text-slate-300">—</div>
                      )}
                    </td>
                  )}

                  {/* Net */}
                  {showVatColumns && (
                    <td className="px-0 py-0 border-r border-slate-200">
                      <div className="text-sm px-2 py-1.5 text-right text-slate-600 tabular-nums">
                        {c.total > 0 ? formatMoneyAbs(c.net) : ''}
                      </div>
                    </td>
                  )}

                  {/* Analysis ledger */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <LedgerPicker
                      value={r.analysisLedger}
                      onChange={newLedger => updateRow(r.id, { analysisLedger: newLedger, analysis: r.analysis && r.analysis.ledger === newLedger ? r.analysis : null })}
                      disabled={Boolean(cfg.analysisLedger)}
                      placeholder="Ledger…"
                      className="!border-none"
                    />
                  </td>

                  {/* Analysis account */}
                  <td className="px-1 py-0 border-r border-slate-200">
                    <AccountPicker
                      bookId={bookId}
                      value={r.analysis?.id ?? null}
                      valueDisplay={r.analysis ? r.analysis.name : undefined}
                      onChange={a => updateRow(r.id, { analysis: a, analysisLedger: a?.ledger ?? r.analysisLedger })}
                      ledgerFilter={r.analysisLedger || undefined}
                      disabled={!r.analysisLedger}
                      placeholder={r.analysisLedger ? `${cfg.analysisLabel}…` : 'Pick ledger first'}
                      className="!border-none"
                    />
                  </td>

                  {/* Fund (charity books only) */}
                  {hasFunds && (
                    <td className="px-1 py-0 border-r border-slate-200">
                      <FundPicker
                        bookId={bookId}
                        value={r.fund}
                        onChange={f => updateRow(r.id, { fund: f })}
                        className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                        placeholder="Fund…"
                      />
                    </td>
                  )}

                  {/* FRS capital-reclaim toggle (purchase rows only) */}
                  {isFrs && (
                    <td className="px-2 py-0 border-r border-slate-200 align-middle">
                      <div className="flex items-center justify-center">
                        {PURCHASE_TYPES.has(r.type) ? (
                          <Tooltip label="Reclaimable capital asset (>£2,000) — input VAT recoverable into Box 4 despite FRS">
                            <input
                              type="checkbox"
                              checked={r.frsCapital}
                              onChange={e => updateRow(r.id, { frsCapital: e.target.checked })}
                              aria-label="Reclaimable capital asset"
                              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                            />
                          </Tooltip>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                  )}

                  {/* Entry details — Tab off last row appends a line */}
                  <td className="px-0 py-0">
                    <input
                      data-row-id={r.id} data-cell="entryDetails" type="text"
                      value={r.entryDetails}
                      onChange={e => updateRow(r.id, { entryDetails: e.target.value })}
                      onKeyDown={e => {
                        if (e.key === 'Tab' && !e.shiftKey && isLastRow) {
                          e.preventDefault();
                          const last = rows[rows.length - 1];
                          const next = makeBlankRow(vatRegistered, last?.type ?? 'PAY', defaultDateUk, inheritSeed());
                          pendingFocusRowId.current = next.id;
                          setRows(prev => [...prev, next]);
                        }
                      }}
                      placeholder="Entry note"
                      className="w-full text-sm px-2 py-1.5 border-0 bg-transparent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Late-entry summary */}
      {hasLateRows && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-amber-600" aria-hidden>⚠</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-amber-900">
                Late VAT entries — {lateRows.filter(Boolean).length} {lateRows.filter(Boolean).length === 1 ? 'row' : 'rows'} fall in a filed VAT period
              </div>
              <div className="text-[11px] text-amber-800/90 mt-0.5">
                The VAT period is locked through <span className="font-mono">{vatLockDate}</span>. By default these are
                flagged to be carried into the next VAT return. Untick any you'd rather not include.
              </div>
              <ul className="mt-2 space-y-1">
                {rows.map((r, i) => {
                  if (!lateRows[i]) return null;
                  const c = rowCalcs[i];
                  return (
                    <li key={r.id}>
                      <label className="inline-flex items-center gap-2 text-xs text-amber-900 cursor-pointer">
                        <input type="checkbox" checked={r.includeInNextReturn}
                          onChange={e => updateRow(r.id, { includeInNextReturn: e.target.checked })}
                          className="rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
                        <span>
                          <span className="font-medium">Row {i + 1}</span> · {r.type} · {r.date}
                          {' · '}<span className="tabular-nums">£{formatMoneyAbs(c.total)}</span>
                          {' '}(VAT <span className="tabular-nums">£{formatMoneyAbs(c.vat)}</span>)
                          {r.includeInNextReturn
                            ? <span className="ml-1 text-amber-700">— will be included in next return</span>
                            : <span className="ml-1 text-rose-700">— will fail to post (period locked)</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Post bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-500">
          {rows.filter(r => r.primary && r.analysis).length} of {rows.length} row{rows.length === 1 ? '' : 's'} ready
        </span>
        <div className="flex-1" />
        {posting && postingProgress && (
          <span className="text-xs text-slate-500 tabular-nums">Posting {postingProgress.done} of {postingProgress.total}…</span>
        )}
        <button type="button" onClick={() => void handlePost()} disabled={posting}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
          {posting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Post all
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {recLockHits && (
        <RecLockWarningModal
          hits={recLockHits}
          onCancel={() => { setRecLockHits(null); setPendingLive(null); }}
          onConfirm={() => {
            const live = pendingLive;
            setRecLockHits(null); setPendingLive(null);
            if (live) void doPost(live);
          }}
        />
      )}
    </div>
  );
}
