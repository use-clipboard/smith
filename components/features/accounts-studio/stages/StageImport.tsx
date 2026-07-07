'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, ArrowRight, ShieldCheck, BookCopy, RefreshCw, AlertCircle, ChevronLeft, ClipboardPaste, Table2, PencilLine, FileSpreadsheet, Upload, Download, ScanLine, Sparkles, type LucideIcon } from 'lucide-react';
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

export default function StageImport({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const imported = !!(engagement.statements && engagement.importInfo);
  const [phase, setPhase] = useState<'source' | 'configure' | 'manual' | 'build' | 'csv' | 'scan'>(
    !imported && engagement.source === 'bookkeeping' ? 'configure'
      : !imported && engagement.source === 'clipboard' ? 'manual'
        : !imported && engagement.source === 'manual' ? 'build'
          : !imported && engagement.source === 'csv' ? 'csv'
            : !imported && engagement.source === 'scan' ? 'scan'
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

  const backToSource = () => { patch(e => ({ ...e, source: null })); setPhase('source'); };

  // ── Clipboard (paste) ────────────────────────────────────────────────────────
  if (phase === 'manual') {
    return <ClipboardImport engagement={engagement} onBack={backToSource} onImported={applyManual} />;
  }

  // ── Build manually ──────────────────────────────────────────────────────────
  if (phase === 'build') {
    return (
      <TbEditor
        engagement={engagement}
        onBack={backToSource}
        onImported={applyManual}
        source="manual"
        sourceLabel="Manual entry"
        heading={{ icon: PencilLine, title: 'Build a trial balance', sub: 'Add each account, set its type, and enter the debit or credit.' }}
      />
    );
  }

  // ── CSV upload ────────────────────────────────────────────────────────────────
  if (phase === 'csv') {
    return <CsvImport engagement={engagement} onBack={backToSource} onImported={applyManual} />;
  }

  // ── PDF / image scan (AI extraction) ──────────────────────────────────────────
  if (phase === 'scan') {
    return <ScanImport engagement={engagement} onBack={backToSource} onImported={applyManual} />;
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
            onClick={() => { if (s.enabled) { patch(e => ({ ...e, source: s.id })); if (s.id === 'bookkeeping') setPhase('configure'); else if (s.id === 'clipboard') setPhase('manual'); else if (s.id === 'manual') setPhase('build'); else if (s.id === 'csv') setPhase('csv'); else if (s.id === 'scan') setPhase('scan'); } }}
            disabled={!s.enabled}
            aria-disabled={!s.enabled}
            className={`group flex flex-col items-start gap-3 rounded-[20px] border border-white/60 bg-white/70 p-4 text-left shadow-[0_8px_32px_rgba(31,38,88,0.08)] backdrop-blur-md transition-all ${
              s.enabled
                ? 'hover:-translate-y-0.5 hover:border-[var(--accent)]/30 hover:shadow-[0_12px_40px_rgba(31,38,88,0.14)]'
                : 'cursor-not-allowed opacity-55'
            }`}
          >
            {s.logo ? (
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.logo} alt={`${s.name} logo`} className="h-7 w-7 object-contain" />
              </div>
            ) : (
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
                s.native ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-slate-100 text-slate-500'
              } ${s.enabled ? 'group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]' : ''}`}>
                <s.icon size={19} />
              </div>
            )}
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
  source: 'clipboard' | 'manual' | 'csv' | 'scan';
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

function ClipboardImport({
  engagement, onBack, onImported,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (p: ManualPayload) => void;
}) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<SeedRow[] | null>(null);
  const [seedKey, setSeedKey] = useState(0);
  const [error, setError] = useState('');

  // Live feedback on the paste before continuing.
  const detected = raw.trim() ? parseTrialBalance(raw) : [];
  const dr = detected.reduce((s, r) => s + r.debit, 0);
  const cr = detected.reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(dr - cr) < 0.5;

  function review() {
    if (!detected.length) { setError('Nothing detected — paste rows like "Account, Debit, Credit".'); return; }
    setError('');
    setParsed(detected.map(r => ({ name: r.name, type: r.type, debit: r.debit, credit: r.credit })));
    setSeedKey(k => k + 1);
  }

  // Once parsed, drop into the shared editor (same as CSV / Build manually).
  if (parsed) {
    return (
      <TbEditor
        key={seedKey}
        engagement={engagement}
        onBack={() => setParsed(null)}
        backLabel="Paste again"
        onImported={onImported}
        source="clipboard"
        sourceLabel="Clipboard entry"
        seed={parsed}
        heading={{ icon: ClipboardPaste, title: 'Review the pasted trial balance', sub: `${parsed.length} row${parsed.length === 1 ? '' : 's'} detected — check the types and balance, then edit if needed.` }}
      />
    );
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
            <p className="text-[12px] text-[var(--text-muted)]">Paste from a spreadsheet — Account, Debit, Credit (an optional Type column is used if present).</p>
          </div>
        </div>

        <textarea
          value={raw}
          onChange={e => setRaw(e.target.value)}
          rows={8}
          placeholder={'Account, Debit, Credit\nSales, 0, 120000\nCost of sales, 40000, 0\nRent, 12000, 0\nBank, 5000, 0\nTrade debtors, 26000, 0\nTrade creditors, 0, 8000\nShare capital, 0, 100'}
          className="input-base w-full font-mono text-[12px] leading-relaxed"
        />

        {detected.length > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
            <span className="font-semibold">{detected.length} account{detected.length === 1 ? '' : 's'} detected</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${balanced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {balanced ? <><Check size={11} /> Balanced</> : <><AlertCircle size={11} /> Out by {money0(Math.abs(dr - cr))}</>}
            </span>
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <button onClick={review} disabled={!detected.length} className="btn-primary mt-4 w-full justify-center disabled:opacity-40">
          <Table2 size={15} /> Review &amp; edit {detected.length || ''} row{detected.length === 1 ? '' : 's'}
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

interface SeedRow { name: string; type: BalType; debit: number; credit: number }

/** The shared trial-balance editor — used by "Build manually" (empty) and the
 *  CSV import (seeded from an uploaded file). Rows, saved-TB loader, prior-year
 *  comparatives, balance check and build all live here. */
function TbEditor({
  engagement, onBack, onImported, source, sourceLabel, heading, seed, backLabel, topSlot,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (p: ManualPayload) => void;
  source: 'manual' | 'csv' | 'clipboard' | 'scan';
  sourceLabel: string;
  heading: { icon: LucideIcon; title: string; sub: string };
  seed?: SeedRow[];
  backLabel?: string;
  topSlot?: React.ReactNode;
}) {
  const idRef = useRef(0);
  const blank = useCallback((over?: Partial<BuilderRow>): BuilderRow => ({
    id: idRef.current++, name: '', type: 'expense', debit: '', credit: '', priorDebit: '', priorCredit: '', ...over,
  }), []);
  const [rows, setRows] = useState<BuilderRow[]>(() =>
    seed && seed.length
      ? seed.map(s => blank({ name: s.name, type: s.type, debit: s.debit ? String(s.debit) : '', credit: s.credit ? String(s.credit) : '' }))
      : [blank(), blank(), blank()]);
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
    onImported({ source, sourceLabel, statements, trialBalance, size, framework, fromIso: fromIso || defaultStart(toIso), toIso, comparativePeriodUk: includePrior ? priorEndUk(toIso) : '' });
  }

  const amtInput = 'w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-right text-[12px] tabular-nums';

  const HeadingIcon = heading.icon;
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ChevronLeft size={13} /> {backLabel ?? 'Choose a different source'}
      </button>

      <StudioCard className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><HeadingIcon size={18} /></span>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">{heading.title}</h3>
            <p className="text-[12px] text-[var(--text-muted)]">{heading.sub}</p>
          </div>
          <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
            <input type="checkbox" checked={includePrior} onChange={e => setIncludePrior(e.target.checked)} className="rounded" />
            Include last year
          </label>
        </div>

        {topSlot}

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

// ─── CSV upload panel ────────────────────────────────────────────────────────
const CSV_TEMPLATE =
  'Account,Type,Debit,Credit\n'
  + 'Turnover,income,0,120000\n'
  + 'Cost of sales,expense,40000,0\n'
  + 'Administrative expenses,expense,30000,0\n'
  + 'Tangible fixed assets,asset,48000,0\n'
  + 'Debtors,asset,26000,0\n'
  + 'Cash at bank and in hand,asset,5000,0\n'
  + 'Creditors,liability,0,15000\n'
  + 'Taxation,liability,0,4000\n'
  + 'Share capital,equity,0,100\n'
  + 'Retained earnings,equity,0,63900\n';

function CsvImport({
  engagement, onBack, onImported,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (p: ManualPayload) => void;
}) {
  const [parsed, setParsed] = useState<SeedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState('');

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'trial-balance-template.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-selected
    if (!f) return;
    setError('');
    try {
      const text = await f.text();
      const rows = parseTrialBalance(text);
      if (!rows.length) { setError('Could not read any rows — download the template to see the expected columns.'); return; }
      setParsed(rows.map(r => ({ name: r.name, type: r.type, debit: r.debit, credit: r.credit })));
      setFileName(f.name);
      setFileKey(k => k + 1);
    } catch {
      setError('Could not read that file. Make sure it is a .csv.');
    }
  }

  // Once a file is parsed, drop into the shared editor seeded with its rows.
  if (parsed) {
    return (
      <TbEditor
        key={fileKey}
        engagement={engagement}
        onBack={() => setParsed(null)}
        backLabel="Upload a different file"
        onImported={onImported}
        source="csv"
        sourceLabel="CSV import"
        seed={parsed}
        heading={{ icon: FileSpreadsheet, title: 'Review the imported trial balance', sub: `${parsed.length} row${parsed.length === 1 ? '' : 's'} from ${fileName} — check the types and balance, then edit if needed.` }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ChevronLeft size={13} /> Choose a different source
      </button>

      <StudioCard className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><FileSpreadsheet size={18} /></span>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Import from CSV</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Upload a trial balance CSV. Columns: Account, Type, Debit, Credit.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={downloadTemplate} className="btn-secondary">
            <Download size={14} /> Download template
          </button>
          <label className="btn-primary cursor-pointer">
            <Upload size={14} /> Upload CSV
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
          </label>
        </div>

        <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
          <strong>Type</strong> is one of income, expense, asset, liability or equity. A header row is optional — SMITH also reads Account / Debit / Credit columns in any order. You can edit everything after uploading.
        </p>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </StudioCard>
    </div>
  );
}

// ─── PDF / image scan panel (AI extraction) ──────────────────────────────────
function readBase64(file: File): Promise<{ name: string; mimeType: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve({ name: file.name, mimeType: file.type || 'application/octet-stream', base64: res.includes(',') ? res.split(',')[1] : res });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** dd-mm-yyyy from a yyyy-mm-dd, for the detected-date hint. */
function ukFromIso(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function ScanImport({
  engagement, onBack, onImported,
}: {
  engagement: Engagement;
  onBack: () => void;
  onImported: (p: ManualPayload) => void;
}) {
  const [parsed, setParsed] = useState<SeedRow[] | null>(null);
  const [note, setNote] = useState('');
  const [detectedYearEnd, setDetectedYearEnd] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState('');
  const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file
    if (!files.length) return;
    setLoading(true); setError('');
    try {
      const payload = await Promise.all(files.map(readBase64));
      const res = await fetch('/api/accounts-studio/extract-tb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: payload }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Could not read the trial balance.');
      const rows = (d.rows ?? []) as { name: string; type: BalType; debit: number; credit: number }[];
      if (!rows.length) throw new Error('No account lines were found — try a clearer scan.');
      setParsed(rows.map(r => ({ name: r.name, type: r.type, debit: r.debit, credit: r.credit })));
      setNote(typeof d.note === 'string' ? d.note : '');
      setDetectedYearEnd(typeof d.detectedYearEnd === 'string' ? d.detectedYearEnd : null);
      setFileLabel(files.length === 1 ? files[0].name : `${files.length} files`);
      setFileKey(k => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the trial balance.');
    } finally {
      setLoading(false);
    }
  }

  // Once extracted, drop into the shared editor seeded with the read rows.
  if (parsed) {
    return (
      <TbEditor
        key={fileKey}
        engagement={engagement}
        onBack={() => setParsed(null)}
        backLabel="Scan a different file"
        onImported={onImported}
        source="scan"
        sourceLabel="PDF / image scan"
        seed={parsed}
        heading={{ icon: ScanLine, title: 'Review the scanned trial balance', sub: `${parsed.length} row${parsed.length === 1 ? '' : 's'} read from ${fileLabel} — check the types and balance, then edit anything SMITH misread.` }}
        topSlot={(note || detectedYearEnd) ? (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/5 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <span>
              {note}
              {detectedYearEnd && <> {note ? ' ' : ''}Detected year end: <strong>{ukFromIso(detectedYearEnd)}</strong> — set it below.</>}
            </span>
          </div>
        ) : undefined}
      />
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <ChevronLeft size={13} /> Choose a different source
      </button>

      <StudioCard className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ScanLine size={18} /></span>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Scan a trial balance</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Upload a PDF or photo/scan of the trial balance — SMITH reads it and you check it.</p>
          </div>
        </div>

        <label className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] bg-white/50 px-4 py-8 text-center transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/5 ${loading ? 'pointer-events-none opacity-60' : ''}`}>
          {loading ? <Loader2 size={22} className="animate-spin text-[var(--accent)]" /> : <Upload size={22} className="text-[var(--text-muted)]" />}
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">{loading ? 'SMITH is reading the trial balance…' : 'Upload PDF, JPG or PNG'}</span>
          <span className="text-[11.5px] text-[var(--text-muted)]">{loading ? 'This can take a few seconds.' : 'Click to choose a file (multiple pages allowed).'}</span>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/gif,image/webp" multiple onChange={onFile} disabled={loading} className="hidden" />
        </label>

        <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
          SMITH extracts each account, its type and its debit/credit. It&apos;s not always perfect on a scan — you&apos;ll review and can edit every row before building the accounts.
        </p>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
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
