'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, ArrowRight, ShieldCheck, BookCopy, RefreshCw, AlertCircle, ChevronLeft } from 'lucide-react';
import { IMPORT_SOURCES, ENTITY_LABELS, SIZE_LABELS } from '../data';
import { StudioCard } from '../primitives';
import StatementsView from '../StatementsView';
import type { Engagement, FinancialStatements, TrialBalanceRow } from '../types';

interface BookRow {
  id: string;
  name: string;
  client_id: string | null;
  base_currency: string;
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
function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fyLabel(fy: FyRow): string {
  return `Year to ${isoToUk(fy.end_date)}`;
}

export default function StageImport({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const imported = !!(engagement.statements && engagement.importInfo);
  const [phase, setPhase] = useState<'source' | 'configure'>(
    engagement.source === 'bookkeeping' && !imported ? 'configure' : 'source',
  );

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
            onClick={() => { patch(e => ({ ...e, statements: null, importInfo: null, trialBalance: null })); setPhase('configure'); }}
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
        }}
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
            onClick={() => { if (s.enabled) { patch(e => ({ ...e, source: s.id })); if (s.id === 'bookkeeping') setPhase('configure'); } }}
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

  // Load the client's books.
  useEffect(() => {
    let cancelled = false;
    setLoadingBooks(true); setError('');
    fetch('/api/bookkeeping/books')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Could not load books')))
      .then((d: { books: BookRow[] }) => {
        if (cancelled) return;
        const mine = (d.books ?? []).filter(b => b.client_id === engagement.clientId);
        setBooks(mine);
        if (mine.length === 1) setBookId(mine[0].id);
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
            No bookkeeping books are linked to this client yet. Create one in the Bookkeeping tool (and allocate it to this client) first.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">Book</label>
              <select value={bookId} onChange={e => setBookId(e.target.value)} className="input-base py-2 text-sm">
                <option value="">Select a book…</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.name} · {b.base_currency}</option>)}
              </select>
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
