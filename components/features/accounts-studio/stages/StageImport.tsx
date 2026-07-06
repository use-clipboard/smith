'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, ArrowRight, ShieldCheck, BookCopy, RefreshCw, AlertCircle, ChevronLeft, ClipboardPaste, Table2, PencilLine } from 'lucide-react';
import { IMPORT_SOURCES, ENTITY_LABELS, SIZE_LABELS } from '../data';
import { buildDisclosures } from '@/lib/accounts-studio/disclosures';
import { buildStatements, detectSize, detectFramework } from '@/lib/accounts-studio/statements';
import type { BalanceAccount, BalanceAccountType } from '@/lib/bookkeeping/balances';
import { saveTb, listSavedTbs, getSavedTb, priorPeriodEnd, type SavedTbMeta, type SavedTbRow } from '../trialBalanceStore';
import { StudioCard } from '../primitives';
import StatementsView from '../StatementsView';
import type { Engagement, FinancialStatements, TrialBalanceRow } from '../types';

interface BookRow {
  id: string;
  name: string;
  client_id: string | null;
  base_currency: string;
  client?: { id: string; name: string; client_ref: string | null } | null;
}
interface FyRow { id: string; start_date: string; end_date: string; status: string }

interface ImportResult {
  book: { id: string; name: string };
  statements: FinancialStatements;
  trialBalance: TrialBalanceRow[];
  detected: { size: Engagement['size']; framework: string; turnover: number; totalAssets: number; netProfit: number; accountCount: number };
}

/** yyyy-mm-dd → dd-mm-yyyy. */
function isoToUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
/** yyyy-mm-dd + N months → dd-mm-yyyy (Companies House filing deadline maths). */
function isoPlusMonthsUk(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getUTCDate())}-${p(dt.getUTCMonth() + 1)}-${dt.getUTCFullYear()}`;
}
function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fyLabel(fy: FyRow): string {
  return `Year to ${isoToUk(fy.end_date)}`;
}

/** TrialBalanceRow[] → the library's SavedTbRow[] shape. */
function tbToSavedRows(tb: TrialBalanceRow[]): SavedTbRow[] {
  return tb.map(r => ({ name: r.name, type: r.accountType as BalanceAccountType, ledger: r.ledger, debit: r.debit, credit: r.credit }));
}
/** SavedTbRow[] → BalanceAccount[] (for using a saved TB as prior-year comparatives). */
function savedRowsToBalanceAccounts(rows: SavedTbRow[]): BalanceAccount[] {
  return rows.map((r, i) => ({
    id: `p${i}`, name: r.name, ledger: r.ledger ?? r.name, account_type: r.type, code: null,
    debit_total: +r.debit.toFixed(2), credit_total: +r.credit.toFixed(2), balance: +(r.debit - r.credit).toFixed(2),
  }));
}
function savedNetProfit(accts: BalanceAccount[]): number {
  return +accts.filter(a => a.account_type === 'income' || a.account_type === 'expense')
    .reduce((s, a) => s + (a.credit_total - a.debit_total), 0).toFixed(2);
}

export default function StageImport({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const imported = !!(engagement.statements && engagement.importInfo);
  const [phase, setPhase] = useState<'source' | 'configure' | 'manual' | 'build'>(
    !imported && engagement.source === 'bookkeeping' ? 'configure'
      : !imported && engagement.source === 'clipboard' ? 'manual'
        : !imported && engagement.source === 'manual' ? 'build'
          : 'source',
  );

  // Shared apply for the Paste/CSV and Build-manually modes.
  function applyManual(p: ManualPayload) {
    patch(e => ({
      ...e,
      source: p.source,
      statements: p.statements,
      trialBalance: p.trialBalance,
      size: p.size,
      microEligible: p.size === 'micro',
      framework: p.framework,
      periodStart: isoToUk(p.fromIso),
      periodEnd: isoToUk(p.toIso),
      comparativePeriod: p.comparativePeriodUk,
      accountsDue: e.chLinked ? e.accountsDue : isoPlusMonthsUk(p.toIso, 9),
      chDeadline: e.chLinked ? e.chDeadline : isoPlusMonthsUk(p.toIso, 9),
      disclosures: e.disclosuresSeeded
        ? e.disclosures
        : buildDisclosures({
            entityType: e.entityType,
            size: p.size,
            framework: p.framework,
            statements: p.statements,
            priorYear: p.comparativePeriodUk ? p.comparativePeriodUk.slice(-4) : '',
            directors: e.directors,
          }),
      disclosuresSeeded: true,
      importInfo: {
        bookId: '', bookName: p.sourceLabel,
        from: p.fromIso, to: p.toIso, priorFrom: null, priorTo: null, importedAt: nowStamp(),
      },
    }));
    // Snapshot into the per-client trial balance library (reuse + prior year).
    void saveTb(engagement.clientId, p.toIso, p.source, tbToSavedRows(p.trialBalance));
  }

  // ── Imported summary (real data) ───────────────────────────────────────────
  if (imported && engagement.statements && engagement.importInfo) {
    const info = engagement.importInfo;
    const periodLabel = `For the period ${isoToUk(info.from)} to ${isoToUk(info.to)}`;
    return (
      <div className="space-y-4">
        <StudioCard className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600"><Check size={18} /></span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Trial balance imported</h3>
              <p className="text-[12px] text-[var(--text-muted)]">
                From <span className="font-medium text-[var(--text-secondary)]">{info.bookName}</span> · {periodLabel} · imported {info.importedAt}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1.5">
              <Detected label="Entity" value={ENTITY_LABELS[engagement.entityType]} />
              <Detected label="Size" value={SIZE_LABELS[engagement.size]} />
              <Detected label="Framework" value={engagement.framework} />
              <Detected label="Comparatives" value={engagement.comparativePeriod ? `Year to ${engagement.comparativePeriod}` : 'None'} />
            </div>
          </div>
        </StudioCard>

        <StatementsView statements={engagement.statements} periodLabel={periodLabel} />

        <div className="flex items-center justify-between">
          <button
            onClick={() => { patch(e => ({ ...e, statements: null, importInfo: null, trialBalance: null, source: null })); setPhase('source'); }}
            className="btn-secondary bg-white text-[var(--text-primary)]"
          >
            <RefreshCw size={14} /> Re-import
          </button>
          <button onClick={advance} className="btn-primary">
            Continue to AI Preparation <ArrowRight size={15} />
          </button>
        </div>
      </div>
    );
  }

  // ── Bookkeeping configure (real book + FY picker) ──────────────────────────
  if (phase === 'configure') {
    return (
      <BookkeepingImport
        engagement={engagement}
        onBack={() => { patch(e => ({ ...e, source: null })); setPhase('source'); }}
        onImported={(res, fy, priorFy) => {
          const priorYear = priorFy ? priorFy.end_date.slice(0, 4) : '';
          patch(e => ({
            ...e,
            source: 'bookkeeping',
            statements: res.statements,
            trialBalance: res.trialBalance,
            size: res.detected.size,
            microEligible: res.detected.size === 'micro',
            framework: res.detected.framework,
            periodStart: isoToUk(fy.start_date),
            periodEnd: isoToUk(fy.end_date),
            comparativePeriod: priorFy ? isoToUk(priorFy.end_date) : '',
            // Companies House filing deadline: 9 months after the year end —
            // but keep the CH-sourced date when the engagement is CH-linked.
            accountsDue: e.chLinked ? e.accountsDue : isoPlusMonthsUk(fy.end_date, 9),
            chDeadline: e.chLinked ? e.chDeadline : isoPlusMonthsUk(fy.end_date, 9),
            // Seed real-figure disclosure drafts on the first import only, so a
            // later re-import never clobbers notes the user has edited.
            disclosures: e.disclosuresSeeded
              ? e.disclosures
              : buildDisclosures({
                  entityType: e.entityType,
                  size: res.detected.size,
                  framework: res.detected.framework,
                  statements: res.statements,
                  priorYear,
                  directors: e.directors,
                }),
            disclosuresSeeded: true,
            importInfo: {
              bookId: res.book.id,
              bookName: res.book.name,
              from: fy.start_date,
              to: fy.end_date,
              priorFrom: priorFy?.start_date ?? null,
              priorTo: priorFy?.end_date ?? null,
              importedAt: nowStamp(),
            },
          }));
          // Snapshot the ledger TB into the library so it's available as a
          // future year's comparatives even when this year came from bookkeeping.
          void saveTb(engagement.clientId, fy.end_date, 'bookkeeping', tbToSavedRows(res.trialBalance));
        }}
      />
    );
  }

  // ── Paste / CSV ─────────────────────────────────────────────────────────────
  if (phase === 'manual') {
    return (
      <ManualImport
        engagement={engagement}
        onBack={() => { patch(e => ({ ...e, source: null })); setPhase('source'); }}
        onImported={applyManual}
      />
    );
  }

  // ── Build manually ──────────────────────────────────────────────────────────
  if (phase === 'build') {
    return (
      <ManualBuilder
        engagement={engagement}
        onBack={() => { patch(e => ({ ...e, source: null })); setPhase('source'); }}
        onImported={applyManual}
      />
    );
  }

  // ── Source picker ──────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
        <ShieldCheck size={15} className="text-emerald-500" />
        No manual mapping needed — SMITH reads the trial balance straight from the ledger.
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {IMPORT_SOURCES.map(s => (
          <button
            key={s.id}
            onClick={() => { if (s.enabled) { patch(e => ({ ...e, source: s.id })); if (s.id === 'bookkeeping') setPhase('configure'); else if (s.id === 'clipboard') setPhase('manual'); else if (s.id === 'manual') setPhase('build'); } }}
            disabled={!s.enabled}
            aria-disabled={!s.enabled}
            className={`group flex flex-col items-start gap-3 rounded-[20px] border border-white/60 bg-white/70 p-4 text-left shadow-[0_8px_32px_rgba(31,38,88,0.08)] backdrop-blur-md transition-all ${
              s.enabled
                ? 'hover:-translate-y-0.5 hover:border-[var(--accent)]/30 hover:shadow-[0_12px_40px_rgba(31,38,88,0.14)]'
                : 'cursor-not-allowed opacity-55'
            }`}
          >
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              s.native ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-slate-100 text-slate-500'
            } ${s.enabled ? 'group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]' : ''}`}>
              <s.icon size={19} />
            </div>
            <div>
              <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[var(--text-primary)]">
                {s.name}
                {s.native && <span className="rounded bg-[var(--accent)]/10 px-1.5 py-px text-[9px] font-bold uppercase text-[var(--accent)]">SMITH</span>}
                {!s.enabled && <span className="rounded bg-amber-100 px-1.5 py-px text-[9px] font-bold uppercase text-amber-700">Soon</span>}
              </p>
              <p className="text-[11.5px] text-[var(--text-muted)]">{s.sub}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Bookkeeping import panel ────────────────────────────────────────────────
function BookkeepingImport({
  engagement, onBack, onImported,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (res: ImportResult, fy: FyRow, priorFy: FyRow | null) => void;
}) {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [bookId, setBookId] = useState('');
  const [years, setYears] = useState<FyRow[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);
  const [fyId, setFyId] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  // Load ALL the firm's books. The client's own books are grouped first, but a
  // book that isn't linked to this client can still be chosen (some firms keep a
  // single book, or the allocation just hasn't been set).
  useEffect(() => {
    let cancelled = false;
    setLoadingBooks(true); setError('');
    fetch('/api/bookkeeping/books')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load books')))
      .then((d: { books: BookRow[] }) => {
        if (cancelled) return;
        const all = d.books ?? [];
        setBooks(all);
        const mine = all.filter(b => b.client_id === engagement.clientId);
        if (mine.length === 1) setBookId(mine[0].id); // auto-select the obvious one
      })
      .catch(() => { if (!cancelled) setError('Could not load bookkeeping books.'); })
      .finally(() => { if (!cancelled) setLoadingBooks(false); });
    return () => { cancelled = true; };
  }, [engagement.clientId]);

  // Load financial years for the chosen book (generate=true back-fills missing FYs).
  const loadYears = useCallback((id: string) => {
    setLoadingYears(true); setYears([]); setFyId(''); setError('');
    fetch(`/api/bookkeeping/books/${id}/years?generate=true`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load financial years')))
      .then((d: { years: FyRow[] }) => {
        const ys = (d.years ?? []).slice().sort((a, b) => b.end_date.localeCompare(a.end_date));
        setYears(ys);
        if (ys.length) setFyId(ys[0].id);
      })
      .catch(() => setError('Could not load financial years for this book.'))
      .finally(() => setLoadingYears(false));
  }, []);

  useEffect(() => { if (bookId) loadYears(bookId); }, [bookId, loadYears]);

  const selectedFy = years.find(y => y.id === fyId) ?? null;
  // Prior year = the FY immediately before the selected one (by end date).
  const priorFy = selectedFy
    ? years.filter(y => y.end_date < selectedFy.end_date).sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null
    : null;

  const clientBooks = books.filter(b => b.client_id === engagement.clientId);
  const otherBooks  = books.filter(b => b.client_id !== engagement.clientId);
  const selectedBook = books.find(b => b.id === bookId) ?? null;
  const bookUnlinked = !!selectedBook && selectedBook.client_id !== engagement.clientId;
  const bookLabel = (b: BookRow) => {
    const owner = b.client ? ` — ${b.client.name}` : (b.client_id ? '' : ' — Unallocated');
    return `${b.name}${owner} · ${b.base_currency}`;
  };

  async function runImport() {
    if (!bookId || !selectedFy) return;
    setImporting(true); setError('');
    try {
      const r = await fetch('/api/accounts-studio/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId,
          entityType: engagement.entityType,
          from: selectedFy.start_date,
          to: selectedFy.end_date,
          priorFrom: priorFy?.start_date ?? null,
          priorTo: priorFy?.end_date ?? null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Import failed.');
      onImported(d as ImportResult, selectedFy, priorFy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ChevronLeft size={13} /> Choose a different source
      </button>

      <StudioCard className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><BookCopy size={18} /></span>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Import from SMITH Bookkeeping</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Pick the book and financial year to pull the live trial balance.</p>
          </div>
        </div>

        {loadingBooks ? (
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--text-muted)]"><Loader2 size={15} className="animate-spin" /> Loading books…</div>
        ) : books.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            No bookkeeping books exist in your firm yet. Create one in the Bookkeeping tool first, then come back to import.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Book</label>
              <select value={bookId} onChange={e => setBookId(e.target.value)} className="input-base py-2 text-sm">
                <option value="">Select a book…</option>
                {clientBooks.length > 0 && (
                  <optgroup label="This client's books">
                    {clientBooks.map(b => <option key={b.id} value={b.id}>{bookLabel(b)}</option>)}
                  </optgroup>
                )}
                {otherBooks.length > 0 && (
                  <optgroup label={clientBooks.length > 0 ? 'Other books' : 'All books (not linked to this client)'}>
                    {otherBooks.map(b => <option key={b.id} value={b.id}>{bookLabel(b)}</option>)}
                  </optgroup>
                )}
              </select>
              {clientBooks.length === 0 && (
                <p className="mt-1.5 text-[11.5px] text-amber-700">No book is linked to this client — pick one below, or allocate a book to the client in Bookkeeping.</p>
              )}
              {bookUnlinked && (
                <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">This book isn&apos;t linked to {engagement.companyName} — its trial balance will be used as-is.</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Financial year</label>
              {loadingYears ? (
                <div className="flex items-center gap-2 py-2 text-sm text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading years…</div>
              ) : !bookId ? (
                <p className="py-2 text-[13px] text-[var(--text-muted)]">Select a book first.</p>
              ) : years.length === 0 ? (
                <p className="py-2 text-[13px] text-amber-700">No financial years found — set a year-end on the book in Bookkeeping → Book settings.</p>
              ) : (
                <>
                  <select value={fyId} onChange={e => setFyId(e.target.value)} className="input-base py-2 text-sm">
                    {years.map(y => (
                      <option key={y.id} value={y.id}>{fyLabel(y)}{y.status === 'closed' ? ' · closed' : ''}</option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">
                    {priorFy
                      ? <>Comparatives will use the year to {isoToUk(priorFy.end_date)}.</>
                      : <>No prior year available — comparatives will be blank.</>}
                  </p>
                </>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            <button onClick={runImport} disabled={!selectedFy || importing} className="btn-primary w-full justify-center disabled:opacity-40">
              {importing ? <Loader2 size={15} className="animate-spin" /> : <BookCopy size={15} />}
              {importing ? 'Reading the ledger…' : 'Import trial balance'}
            </button>
          </div>
        )}
      </StudioCard>
    </div>
  );
}

// ─── Manual / CSV import panel ───────────────────────────────────────────────
type BalType = BalanceAccountType;
interface ManualRow { name: string; type: BalType; ledger: string; debit: number; credit: number }
interface ManualPayload {
  source: 'clipboard' | 'manual';
  sourceLabel: string;
  statements: FinancialStatements;
  trialBalance: TrialBalanceRow[];
  size: Engagement['size'];
  framework: string;
  fromIso: string;
  toIso: string;
  /** Prior year end (dd-mm-yyyy) when comparatives were entered; '' otherwise. */
  comparativePeriodUk: string;
}

const TYPE_OPTIONS: { value: BalType; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
];

function parseNum(s: string): number {
  const t = (s ?? '').replace(/[£$,\s]/g, '').trim();
  if (!t || t === '-') return 0;
  if (/^\(.*\)$/.test(t)) return -Math.abs(parseFloat(t.replace(/[()]/g, '')) || 0);
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
function defaultLedger(type: BalType): string {
  switch (type) {
    case 'income': return 'Income';
    case 'expense': return 'Administrative expenses';
    case 'asset': return 'Fixed assets';
    case 'liability': return 'Creditors';
    case 'equity': return 'Capital and reserves';
  }
}
function mapTypeCell(s: string): BalType | null {
  if (!s) return null;
  if (/income|revenue|sales|turnover/.test(s)) return 'income';
  if (/expense|cost|overhead|admin/.test(s)) return 'expense';
  if (/asset/.test(s)) return 'asset';
  if (/liab|creditor|payable/.test(s)) return 'liability';
  if (/equity|capital|reserve/.test(s)) return 'equity';
  return null;
}
/** Heuristic classification of an account name into a statement type + ledger. */
function classify(name: string): { type: BalType; ledger: string } {
  const n = name.toLowerCase();
  if (/(sales|revenue|turnover|fees|takings|grant income|rental income|\bincome\b)/.test(n)) return { type: 'income', ledger: 'Income' };
  if (/(cost of sales|cogs|purchases|materials|direct cost|opening stock|closing stock)/.test(n)) return { type: 'expense', ledger: 'Cost of sales' };
  if (/(debtor|receivable|prepay|accrued income)/.test(n)) return { type: 'asset', ledger: 'Debtors' };
  if (/(bank|cash|petty)/.test(n)) return { type: 'asset', ledger: 'Cash at bank and in hand' };
  if (/(stock|inventory|work in progress|\bwip\b)/.test(n)) return { type: 'asset', ledger: 'Stocks' };
  if (/(fixed asset|equipment|plant|machinery|vehicle|motor|fixtures|fittings|property|land|building|computer|goodwill|intangible|investment)/.test(n)) return { type: 'asset', ledger: 'Fixed assets' };
  if (/(\bvat\b|paye|\bnic\b|corporation tax|\btax\b)/.test(n)) return { type: 'liability', ledger: 'Taxation and social security' };
  if (/(creditor|payable|accrual|loan|overdraft|deferred|hire purchase|\bhp\b)/.test(n)) return { type: 'liability', ledger: 'Creditors' };
  if (/(share capital|called up|ordinary shares|capital account|reserve|retained|p&l reserve|profit and loss account|drawings|equity)/.test(n)) return { type: 'equity', ledger: 'Capital and reserves' };
  return { type: 'expense', ledger: 'Administrative expenses' };
}
/** Parse pasted / CSV trial-balance text into classified rows. */
function parseTrialBalance(raw: string): ManualRow[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitLine = (l: string) => (l.includes('\t') ? l.split('\t') : l.split(',')).map(c => c.trim());

  let startIdx = 0, idxName = 0, idxDebit = -1, idxCredit = -1, idxType = -1, idxAmount = -1;
  const first = splitLine(lines[0]).map(c => c.toLowerCase());
  if (first.some(c => /debit|credit|amount|balance|account|nominal/.test(c))) {
    startIdx = 1;
    first.forEach((c, i) => {
      if (/account|name|nominal|description/.test(c) && idxName === 0) idxName = i;
      if (/debit|\bdr\b/.test(c)) idxDebit = i;
      if (/credit|\bcr\b/.test(c)) idxCredit = i;
      if (/type|category|class/.test(c)) idxType = i;
      if (/amount|balance/.test(c)) idxAmount = i;
    });
  }

  const rows: ManualRow[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length < 2) continue;
    const name = (cells[idxName] ?? cells[0] ?? '').trim();
    if (!name) continue;
    let debit = 0, credit = 0;
    if (idxDebit >= 0 || idxCredit >= 0) {
      debit = parseNum(cells[idxDebit] ?? ''); credit = parseNum(cells[idxCredit] ?? '');
    } else if (idxAmount >= 0) {
      const amt = parseNum(cells[idxAmount] ?? ''); if (amt >= 0) debit = amt; else credit = -amt;
    } else {
      const nums = cells.slice(1);
      if (nums.length >= 2) { debit = parseNum(nums[nums.length - 2]); credit = parseNum(nums[nums.length - 1]); }
      else if (nums.length === 1) { const amt = parseNum(nums[0]); if (amt >= 0) debit = amt; else credit = -amt; }
    }
    if (Math.abs(debit) < 0.005 && Math.abs(credit) < 0.005) continue;
    const typeCell = idxType >= 0 ? (cells[idxType] ?? '').toLowerCase() : '';
    const mapped = mapTypeCell(typeCell);
    const c = mapped ? { type: mapped, ledger: defaultLedger(mapped) } : classify(name);
    rows.push({ name, type: c.type, ledger: c.ledger, debit, credit });
  }
  return rows;
}
/** yyyy-mm-dd one year and a day earlier (default period start from a year end). */
function defaultStart(toIso: string): string {
  const [y, m, d] = toIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y - 1, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
const money0 = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

function ManualImport({
  engagement, onBack, onImported,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (p: ManualPayload) => void;
}) {
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ManualRow[]>([]);
  const [toIso, setToIso] = useState('');
  const [fromIso, setFromIso] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setRows(raw.trim() ? parseTrialBalance(raw) : []); }, [raw]);

  const totalDr = rows.reduce((s, r) => s + r.debit, 0);
  const totalCr = rows.reduce((s, r) => s + r.credit, 0);
  const diff = Math.abs(totalDr - totalCr);
  const balanced = diff < 0.5;

  function setType(i: number, type: BalType) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, type, ledger: defaultLedger(type) } : r));
  }

  async function build() {
    if (!rows.length) { setError('Paste a trial balance first.'); return; }
    if (!toIso) { setError('Enter the year-end date.'); return; }
    setError('');
    const accounts: BalanceAccount[] = rows.map((r, i) => ({
      id: `m${i}`, name: r.name, ledger: r.ledger, account_type: r.type, code: null,
      debit_total: +r.debit.toFixed(2), credit_total: +r.credit.toFixed(2), balance: +(r.debit - r.credit).toFixed(2),
    }));
    const bsNetProfit = +accounts
      .filter(a => a.account_type === 'income' || a.account_type === 'expense')
      .reduce((s, a) => s + (a.credit_total - a.debit_total), 0).toFixed(2);

    // Auto prior-year: pull last year's saved TB from the library as comparatives.
    let prior: { pl: BalanceAccount[]; bs: BalanceAccount[]; bsNetProfit: number } | null = null;
    let comparativePeriodUk = '';
    if (engagement.clientId) {
      const pTb = await getSavedTb(engagement.clientId, priorPeriodEnd(toIso));
      if (pTb && pTb.rows.length) {
        const pa = savedRowsToBalanceAccounts(pTb.rows);
        prior = { pl: pa, bs: pa, bsNetProfit: savedNetProfit(pa) };
        comparativePeriodUk = isoToUk(pTb.periodEnd);
      }
    }

    const statements = buildStatements({ pl: accounts, bs: accounts, bsNetProfit }, prior);
    const size = detectSize(statements.profitLoss.turnoverTotal, statements.balanceSheet.totalAssets);
    const framework = detectFramework(engagement.entityType, size);
    const trialBalance: TrialBalanceRow[] = rows.map(r => ({ name: r.name, ledger: r.ledger, accountType: r.type, debit: r.debit, credit: r.credit }));
    onImported({ source: 'clipboard', sourceLabel: 'Manual / CSV entry', statements, trialBalance, size, framework, fromIso: fromIso || defaultStart(toIso), toIso, comparativePeriodUk });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ChevronLeft size={13} /> Choose a different source
      </button>

      <StudioCard className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ClipboardPaste size={18} /></span>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Paste a trial balance</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Paste from a spreadsheet or CSV — SMITH classifies each line; correct any it gets wrong.</p>
          </div>
        </div>

        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          rows={6}
          placeholder={'Account, Debit, Credit\nSales, 0, 120000\nCost of sales, 40000, 0\nRent, 12000, 0\nBank, 5000, 0\nTrade debtors, 26000, 0\nTrade creditors, 0, 8000\nShare capital, 0, 100'}
          className="input-base w-full font-mono text-[12px] leading-relaxed"
        />

        {rows.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">{rows.length} account{rows.length === 1 ? '' : 's'} detected</p>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {balanced ? <><Check size={11} /> Balanced</> : <><AlertCircle size={11} /> Out by {money0(diff)}</>}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold">Account</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Debit</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-2 py-1 text-[var(--text-primary)]">{r.name}</td>
                      <td className="px-2 py-1">
                        <select value={r.type} onChange={e => setType(i, e.target.value as BalType)}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11.5px]">
                          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-[var(--text-secondary)]">{r.debit ? r.debit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-[var(--text-secondary)]">{r.credit ? r.credit.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Period start</label>
                <input type="date" value={fromIso} onChange={e => setFromIso(e.target.value)} className="input-base py-1.5 text-sm" />
                <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Optional — defaults to a year before the end.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Year end <span className="text-red-500">*</span></label>
                <input type="date" value={toIso} onChange={e => setToIso(e.target.value)} className="input-base py-1.5 text-sm" />
                <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Last year&apos;s saved trial balance (if any) is added as comparatives automatically.</p>
              </div>
            </div>

            {!balanced && (
              <p className="mt-2 text-[11.5px] text-amber-700">Debits and credits don&apos;t agree — check the paste, then continue if it&apos;s expected.</p>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <button onClick={build} disabled={!rows.length || !toIso} className="btn-primary mt-4 w-full justify-center disabled:opacity-40">
          <Table2 size={15} /> Build accounts from {rows.length || 0} row{rows.length === 1 ? '' : 's'}
        </button>
      </StudioCard>
    </div>
  );
}

// ─── Build-manually panel ────────────────────────────────────────────────────
interface BuilderRow { id: number; name: string; type: BalType; debit: string; credit: string; priorDebit: string; priorCredit: string }

const COMMON_ACCOUNTS: { name: string; type: BalType }[] = [
  { name: 'Turnover', type: 'income' },
  { name: 'Cost of sales', type: 'expense' },
  { name: 'Administrative expenses', type: 'expense' },
  { name: 'Wages and salaries', type: 'expense' },
  { name: 'Tangible fixed assets', type: 'asset' },
  { name: 'Debtors', type: 'asset' },
  { name: 'Cash at bank and in hand', type: 'asset' },
  { name: 'Creditors', type: 'liability' },
  { name: 'Taxation', type: 'liability' },
  { name: 'Share capital', type: 'equity' },
  { name: 'Retained earnings', type: 'equity' },
];

function priorEndUk(toIso: string): string {
  const [y, m, d] = toIso.split('-');
  return `${d}-${m}-${Number(y) - 1}`;
}
function toBalanceAccount(i: number, name: string, type: BalType, debit: number, credit: number): BalanceAccount {
  return { id: `b${i}`, name, ledger: name, account_type: type, code: null, debit_total: +debit.toFixed(2), credit_total: +credit.toFixed(2), balance: +(debit - credit).toFixed(2) };
}
function netProfitOf(accts: BalanceAccount[]): number {
  return +accts.filter(a => a.account_type === 'income' || a.account_type === 'expense')
    .reduce((s, a) => s + (a.credit_total - a.debit_total), 0).toFixed(2);
}

function ManualBuilder({
  engagement, onBack, onImported,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (p: ManualPayload) => void;
}) {
  const idRef = useRef(0);
  const blank = useCallback((seed?: Partial<BuilderRow>): BuilderRow => ({
    id: idRef.current++, name: '', type: 'expense', debit: '', credit: '', priorDebit: '', priorCredit: '', ...seed,
  }), []);
  const [rows, setRows] = useState<BuilderRow[]>(() => [blank(), blank(), blank()]);
  const [includePrior, setIncludePrior] = useState(false);
  const [toIso, setToIso] = useState('');
  const [fromIso, setFromIso] = useState('');
  const [error, setError] = useState('');
  const clientId = engagement.clientId;

  // Saved trial balance library for this client.
  const [saved, setSaved] = useState<SavedTbMeta[]>([]);
  const [priorLoaded, setPriorLoaded] = useState(false);
  useEffect(() => { if (clientId) listSavedTbs(clientId).then(setSaved); }, [clientId]);

  // A saved prior-year TB is available when one exists for (year-end − 1 year).
  const priorMeta = toIso ? (saved.find(s => s.periodEnd === priorPeriodEnd(toIso)) ?? null) : null;

  const set = (id: number, patch: Partial<BuilderRow>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const remove = (id: number) => setRows(rs => rs.filter(r => r.id !== id));
  const addCommon = (name: string, type: BalType) => setRows(rs => [...rs, blank({ name, type })]);

  const num = (n: number) => (n ? String(n) : '');

  async function loadSaved(periodEnd: string) {
    if (!clientId) return;
    const tb = await getSavedTb(clientId, periodEnd);
    if (!tb) return;
    setRows(tb.rows.map(r => blank({ name: r.name, type: r.type, debit: num(r.debit), credit: num(r.credit) })));
    setToIso(periodEnd);
    setPriorLoaded(false);
  }

  async function loadPriorYear() {
    if (!clientId || !priorMeta) return;
    const tb = await getSavedTb(clientId, priorMeta.periodEnd);
    if (!tb) return;
    setIncludePrior(true);
    setRows(rs => {
      const next = rs.map(r => ({ ...r }));
      const byName = new Map(next.map((r, i) => [r.name.trim().toLowerCase(), i] as const));
      for (const pr of tb.rows) {
        const idx = byName.get(pr.name.trim().toLowerCase());
        if (idx !== undefined) { next[idx].priorDebit = num(pr.debit); next[idx].priorCredit = num(pr.credit); }
        else next.push(blank({ name: pr.name, type: pr.type, priorDebit: num(pr.debit), priorCredit: num(pr.credit) }));
      }
      return next;
    });
    setPriorLoaded(true);
  }

  const curDr = rows.reduce((s, r) => s + parseNum(r.debit), 0);
  const curCr = rows.reduce((s, r) => s + parseNum(r.credit), 0);
  const priDr = rows.reduce((s, r) => s + parseNum(r.priorDebit), 0);
  const priCr = rows.reduce((s, r) => s + parseNum(r.priorCredit), 0);
  const curBalanced = Math.abs(curDr - curCr) < 0.5;
  const priBalanced = Math.abs(priDr - priCr) < 0.5;

  function build() {
    const clean = rows.filter(r => r.name.trim() && (parseNum(r.debit) || parseNum(r.credit) || (includePrior && (parseNum(r.priorDebit) || parseNum(r.priorCredit)))));
    if (!clean.length) { setError('Add at least one account with an amount.'); return; }
    if (!toIso) { setError('Enter the year-end date.'); return; }
    setError('');
    const cur = clean.map((r, i) => toBalanceAccount(i, r.name.trim(), r.type, parseNum(r.debit), parseNum(r.credit)));
    const prior = includePrior ? clean.map((r, i) => toBalanceAccount(i, r.name.trim(), r.type, parseNum(r.priorDebit), parseNum(r.priorCredit))) : null;
    const statements = buildStatements(
      { pl: cur, bs: cur, bsNetProfit: netProfitOf(cur) },
      prior ? { pl: prior, bs: prior, bsNetProfit: netProfitOf(prior) } : null,
    );
    const size = detectSize(statements.profitLoss.turnoverTotal, statements.balanceSheet.totalAssets);
    const framework = detectFramework(engagement.entityType, size);
    const trialBalance: TrialBalanceRow[] = clean.map(r => ({ name: r.name.trim(), ledger: r.name.trim(), accountType: r.type, debit: parseNum(r.debit), credit: parseNum(r.credit) }));
    onImported({ source: 'manual', sourceLabel: 'Manual entry', statements, trialBalance, size, framework, fromIso: fromIso || defaultStart(toIso), toIso, comparativePeriodUk: includePrior ? priorEndUk(toIso) : '' });
  }

  const amtInput = 'w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-right text-[12px] tabular-nums';

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ChevronLeft size={13} /> Choose a different source
      </button>

      <StudioCard className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><PencilLine size={18} /></span>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Build a trial balance</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Add each account, set its type, and enter the debit or credit.</p>
          </div>
          <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
            <input type="checkbox" checked={includePrior} onChange={e => setIncludePrior(e.target.checked)} className="rounded" />
            Include last year
          </label>
        </div>

        {/* Saved trial balances */}
        {saved.length > 0 && (
          <div className="mb-3">
            <select
              value=""
              onChange={e => { if (e.target.value) void loadSaved(e.target.value); }}
              className="input-base py-1.5 text-sm"
            >
              <option value="">Load a saved trial balance…</option>
              {saved.map(s => (
                <option key={s.id} value={s.periodEnd}>Year to {isoToUk(s.periodEnd)}{s.source ? ` · ${s.source}` : ''} ({s.rowCount} rows)</option>
              ))}
            </select>
          </div>
        )}

        {/* Prior-year available */}
        {priorMeta && !priorLoaded && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            <Check size={14} className="text-[var(--accent)]" />
            A saved trial balance for the year to {isoToUk(priorMeta.periodEnd)} is available.
            <button type="button" onClick={() => void loadPriorYear()} className="ml-auto rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-semibold text-white hover:opacity-90">
              Load as comparatives
            </button>
          </div>
        )}

        {/* Quick add */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {COMMON_ACCOUNTS.map(c => (
            <button key={c.name} onClick={() => addCommon(c.name, c.type)}
              className="rounded-full border border-[var(--border)] bg-white px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5">
              + {c.name}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-2 py-1.5 text-left font-semibold">Account</th>
                <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                <th className="px-2 py-1.5 text-right font-semibold">Debit</th>
                <th className="px-2 py-1.5 text-right font-semibold">Credit</th>
                {includePrior && <th className="px-2 py-1.5 text-right font-semibold">Debit (prior)</th>}
                {includePrior && <th className="px-2 py-1.5 text-right font-semibold">Credit (prior)</th>}
                <th className="px-1 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <input value={r.name} onChange={e => set(r.id, { name: e.target.value })} placeholder="Account name"
                      className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[12px]" />
                  </td>
                  <td className="px-2 py-1">
                    <select value={r.type} onChange={e => set(r.id, { type: e.target.value as BalType })}
                      className="rounded border border-slate-200 bg-white px-1 py-1 text-[11.5px]">
                      {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1"><input value={r.debit} onChange={e => set(r.id, { debit: e.target.value })} inputMode="decimal" className={amtInput} /></td>
                  <td className="px-2 py-1"><input value={r.credit} onChange={e => set(r.id, { credit: e.target.value })} inputMode="decimal" className={amtInput} /></td>
                  {includePrior && <td className="px-2 py-1"><input value={r.priorDebit} onChange={e => set(r.id, { priorDebit: e.target.value })} inputMode="decimal" className={amtInput} /></td>}
                  {includePrior && <td className="px-2 py-1"><input value={r.priorCredit} onChange={e => set(r.id, { priorCredit: e.target.value })} inputMode="decimal" className={amtInput} /></td>}
                  <td className="px-1 py-1 text-center">
                    <button onClick={() => remove(r.id)} aria-label="Remove" className="text-slate-300 hover:text-rose-600">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50/70 text-[11.5px] font-semibold text-[var(--text-secondary)]">
              <tr>
                <td className="px-2 py-1.5" colSpan={2}>Totals</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money0(curDr)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{money0(curCr)}</td>
                {includePrior && <td className="px-2 py-1.5 text-right tabular-nums">{money0(priDr)}</td>}
                {includePrior && <td className="px-2 py-1.5 text-right tabular-nums">{money0(priCr)}</td>}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => setRows(rs => [...rs, blank()])} className="text-[12px] font-medium text-[var(--accent)] hover:underline">+ Add account</button>
          <div className="flex-1" />
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${curBalanced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {curBalanced ? <><Check size={11} /> Balanced</> : <><AlertCircle size={11} /> Out by {money0(Math.abs(curDr - curCr))}</>}
          </span>
          {includePrior && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${priBalanced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              Prior {priBalanced ? '✓' : `out ${money0(Math.abs(priDr - priCr))}`}
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Period start</label>
            <input type="date" value={fromIso} onChange={e => setFromIso(e.target.value)} className="input-base py-1.5 text-sm" />
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Optional — defaults to a year before the end.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Year end <span className="text-red-500">*</span></label>
            <input type="date" value={toIso} onChange={e => { setToIso(e.target.value); setPriorLoaded(false); }} className="input-base py-1.5 text-sm" />
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <button onClick={build} disabled={!toIso} className="btn-primary mt-4 w-full justify-center disabled:opacity-40">
          <Table2 size={15} /> Build accounts
        </button>
      </StudioCard>
    </div>
  );
}

function Detected({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="mt-0.5 flex items-center gap-1 text-[12.5px] font-semibold text-[var(--text-primary)]">
        <Check size={11} className="text-emerald-500" />{value}
      </p>
    </div>
  );
}
