'use client';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { consumePendingClient } from '@/lib/pendingClient';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import TransactionEditModal from '@/components/features/full-analysis/TransactionEditModal';
import SaveAnalysisModal from '@/components/features/full-analysis/SaveAnalysisModal';
import FullAnalysisHistory, { type SeedAnalysis } from '@/components/features/full-analysis/FullAnalysisHistory';
import { FileSearch, Download, Undo2, Redo2, AlertTriangle, Pencil, ChevronUp, ChevronDown, ChevronsUpDown, CheckCheck, ChevronRight, ArrowLeft, Sparkles, Check, ArrowRight, UploadCloud, Users, FileOutput, SlidersHorizontal, Zap, Trash2, BookCopy } from 'lucide-react';
import type { Transaction, FlaggedEntry, TargetSoftware, LedgerAccount, VTTransaction, CapiumTransaction, XeroTransaction, QuickBooksTransaction, FreeAgentTransaction, SageTransaction, GeneralTransaction, SmithTransaction, DocumentScanResult } from '@/types';
import { fileToBase64, readFileAsText, parseLedgerCsv, findBestMatch } from '@/utils/fileUtils';
import { spreadsheetToText, isSpreadsheetFile } from '@/utils/spreadsheetText';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';
type View = 'valid' | 'flagged';
type EditTarget = { type: 'valid'; index: number } | { type: 'flagged'; index: number };
type SortState = { key: string; dir: 'asc' | 'desc' };

const TOLERANCE = 0.01;

// Vercel serverless functions reject request bodies larger than ~4.5 MB. Files
// are sent as base64 (≈1.37× their raw bytes) inside a JSON envelope, so we cap
// the encoded payload at ~4.4 MB and auto-split any PDF that would exceed it
// (see splitPdfIfNeeded). Keep in step with the Vercel body limit if it changes.
const UPLOAD_LIMIT = 4_400_000; // max base64 length per request

// How many document/chunk scans to run against the AI at once. Scanning was
// sequential, so a PDF split into N chunks took N calls back-to-back. Running a
// few in parallel cuts wall-clock roughly N-fold, capped low enough to stay well
// under Anthropic rate limits (failed parts degrade gracefully to a rescan).
const SCAN_CONCURRENCY = 4;

// Run async tasks with a bounded number in flight at once. Preserves each task's
// own error handling (tasks are expected not to throw — they resolve to results).
async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const idx = next++;
      await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

// A document to scan: either the whole original file, or one page-range slice of
// it. `originalName` and `pageOffset` let us map the AI's chunk-relative results
// (fileName + pageNumber) back to the real source document, so the document
// preview, Drive/Gmail links and uploads all keep resolving to the original file
// and the correct page. For an unsplit file pageOffset is 0 (identity mapping).
interface DocChunk { file: File; originalName: string; pageOffset: number }

// Split an oversized PDF into page-chunks that each fit under the upload limit.
// Non-PDFs, small files and single-page PDFs pass straight through. Page ranges
// are halved recursively until each saved chunk is small enough — this copes
// with pdf-lib duplicating shared resources (fonts/images) into each chunk.
// Mirrors the proven helper in the Bank-to-CSV tool. Emitted ranges are always
// contiguous and in order, so indices[0] is the chunk's original page offset.
async function splitPdfIfNeeded(file: File): Promise<DocChunk[]> {
  const whole: DocChunk[] = [{ file, originalName: file.name, pageOffset: 0 }];
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf || (file.size * 4) / 3 <= UPLOAD_LIMIT) return whole;
  try {
    const { PDFDocument } = await import('pdf-lib');
    const srcBytes = new Uint8Array(await file.arrayBuffer());
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    if (pageCount <= 1) return whole;
    const base = file.name.replace(/\.pdf$/i, '');
    const out: DocChunk[] = [];
    const emit = async (indices: number[]): Promise<void> => {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, indices);
      pages.forEach(p => doc.addPage(p));
      const bytes = await doc.save();
      if ((bytes.length * 4) / 3 <= UPLOAD_LIMIT || indices.length === 1) {
        out.push({
          file: new File([bytes], `${base} — part ${out.length + 1}.pdf`, { type: 'application/pdf' }),
          originalName: file.name,
          pageOffset: indices[0],
        });
        return;
      }
      const mid = Math.ceil(indices.length / 2);
      await emit(indices.slice(0, mid));
      await emit(indices.slice(mid));
    };
    await emit(Array.from({ length: pageCount }, (_, i) => i));
    return out.length > 0 ? out : whole;
  } catch {
    return whole;
  }
}

function buildMinimalTx(entry: FlaggedEntry, software: TargetSoftware): Transaction {
  if (entry.transactionData) return entry.transactionData;
  const base = { fileName: entry.fileName, pageNumber: entry.pageNumber ?? 1 };
  if (software === 'vt') return { ...base, type: 'PIN', refNo: '', date: entry.date ?? '', primaryAccount: '', details: entry.description ?? '', total: entry.amount ?? 0, vat: 0, analysis: entry.amount ?? 0, analysisAccount: '', entryDetails: '', transactionNotes: '' } as VTTransaction;
  if (software === 'capium') return { ...base, contactname: entry.supplier ?? '', contacttype: 'Supplier', reference: '', description: entry.description ?? '', accountname: '', accountcode: '', invoicedate: entry.date ?? '', vatname: 'No VAT', vatamount: 0, isvatincluded: 'false', amount: entry.amount ?? 0, netAmount: entry.amount ?? 0 } as CapiumTransaction;
  if (software === 'xero') return { ...base, contactName: entry.supplier ?? '', invoiceNumber: '', invoiceDate: entry.date ?? '', dueDate: entry.date ?? '', description: entry.description ?? '', quantity: 1, unitAmount: entry.amount ?? 0, grossAmount: entry.amount ?? 0, accountCode: '', accountName: '', taxType: 'No VAT' } as XeroTransaction;
  if (software === 'quickbooks') return { ...base, invoiceNo: '', supplier: entry.supplier ?? '', invoiceDate: entry.date ?? '', dueDate: entry.date ?? '', description: entry.description ?? '', quantity: 1, unitAmount: entry.amount ?? 0, vatAmount: 0, grossAmount: entry.amount ?? 0, taxCode: 'No VAT', accountCode: '', accountName: '' } as QuickBooksTransaction;
  if (software === 'freeagent') return { ...base, date: entry.date ?? '', amount: entry.amount ?? 0, description: entry.description ?? '' } as FreeAgentTransaction;
  if (software === 'sage') return { ...base, TYPE: 'PI', ACCOUNT_REF: entry.supplier ?? '', NOMINAL_CODE: '', DATE: entry.date ?? '', REFERENCE: '', DETAILS: entry.description ?? '', NET_AMOUNT: entry.amount ?? 0, TAX_CODE: 'T9', TAX_AMOUNT: 0, EXCHANGE_RATE: 1 } as SageTransaction;
  return { ...base, date: entry.date ?? '', supplier: entry.supplier ?? '', invoiceNumber: '', description: entry.description ?? '', netAmount: entry.amount ?? 0, vatAmount: 0, grossAmount: entry.amount ?? 0, currency: 'GBP', documentType: 'Purchase', category: '', notes: '' } as GeneralTransaction;
}

// ─── Setup wizard helpers ───────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { n: 1, label: 'Select Client' },
  { n: 2, label: 'Choose Output' },
  { n: 3, label: 'Upload Documents' },
  { n: 4, label: 'Review' },
] as const;

function WizardStepper({ current, onStep }: { current: number; onStep: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap">
      {WIZARD_STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const clickable = s.n <= current;
        return (
          <div key={s.n} className="flex items-center gap-1.5 sm:gap-2.5">
            <button type="button" disabled={!clickable} onClick={() => clickable && onStep(s.n)}
              className={`flex items-center gap-2 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors
                ${active ? 'bg-[var(--accent)] text-white' : done ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                {done ? <Check size={13} /> : s.n}
              </span>
              <span className={`text-xs font-semibold whitespace-nowrap ${active ? 'text-[var(--text-primary)]' : done ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{s.label}</span>
            </button>
            {i < WIZARD_STEPS.length - 1 && <div className={`w-5 sm:w-10 h-px ${done ? 'bg-[var(--accent)]/40' : 'bg-[var(--border)]'}`} />}
          </div>
        );
      })}
    </div>
  );
}

// Package-upload categories
type DocCat = 'documents' | 'past_transactions' | 'chart_of_accounts';
interface DocItem { id: string; file: File; cat: DocCat; }

const DOC_CATS: { id: DocCat; label: string; hint: string; required?: boolean }[] = [
  { id: 'documents',         label: 'Documents',         hint: 'Invoices, receipts & bank statements (PDF, JPG, PNG)', required: true },
  { id: 'past_transactions', label: 'Past transactions', hint: 'CSV of prior entries — used to spot duplicates' },
  { id: 'chart_of_accounts', label: 'Chart of accounts', hint: 'CSV of ledger accounts — improves coding accuracy' },
];

function detectDocCat(file: File): DocCat {
  const name = file.name.toLowerCase();
  const isCsv = /\.(csv|xlsx?|tsv)$/.test(name) || file.type.includes('csv') || file.type.includes('sheet') || file.type.includes('excel');
  if (!isCsv) return 'documents';
  if (/account|ledger|\bcoa\b|chart|nominal/.test(name)) return 'chart_of_accounts';
  return 'past_transactions';
}

const SOFTWARE_OPTIONS: { id: TargetSoftware; label: string; logo: string }[] = [
  { id: 'smith',      label: 'SMITH Bookkeeping',   logo: '/logos/general.svg' },
  { id: 'vt',         label: 'VT Transaction+',     logo: '/logos/vt.png' },
  { id: 'capium',     label: 'Capium Bookkeeping',  logo: '/logos/capium.png' },
  { id: 'xero',       label: 'Xero',                logo: '/logos/xero.png' },
  { id: 'quickbooks', label: 'QuickBooks',          logo: '/logos/quickbooks.png' },
  { id: 'freeagent',  label: 'FreeAgent',           logo: '/logos/freeagent.png' },
  { id: 'sage',       label: 'Sage 50',             logo: '/logos/sage.png' },
  { id: 'general',    label: 'General',             logo: '/logos/general.svg' },
];

export default function FullAnalysisPage() {
  // ── History dashboard wrapper ────────────────────────────────────────────
  // Default landing screen is the history dashboard. The user clicks
  // "New Analysis" to enter the tool, or "Open" on a past row to reload it.
  const [view, setView] = useState<'history' | 'tool'>('history');
  const [seed, setSeed] = useState<SeedAnalysis | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  return view === 'history' ? (
    <FullAnalysisHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <FullAnalysisTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
  );
}

function BackToHistory({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 mb-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
    >
      <ArrowLeft size={13} />
      Back to history
    </button>
  );
}

function FullAnalysisTool({ seed, onBack }: { seed: SeedAnalysis | null; onBack: () => void }) {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/full-analysis', appState);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState(0);

  // Batch scan state
  const [scanResults, setScanResults] = useState<DocumentScanResult[]>([]);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [fileRefs, setFileRefs] = useState<Map<string, File>>(new Map());
  const [isRescanning, setIsRescanning] = useState(false);
  // Shared inputs cached between scan and re-scan
  const sharedInputsRef = useRef<{ pastTransactionsContent: string | null; ledgersContent: string | null; parsedLedgerAccounts: LedgerAccount[] } | null>(null);

  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [targetSoftware, setTargetSoftware] = useState<TargetSoftware>('general');
  const [analysisMode, setAnalysisMode] = useState<'standard' | 'thorough'>('standard');

  // Setup wizard: 1 Select Client · 2 Choose Output · 3 Upload Documents · 4 Review
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  // Once analysis completes, the wizard sits on the Review step.
  useEffect(() => { if (appState === 'success') setWizardStep(4); }, [appState]);

  // ── Seed loader: when opened from history dashboard, hydrate the success view
  const seedLoadedRef = useRef(false);
  useEffect(() => {
    if (!seed || seedLoadedRef.current) return;
    seedLoadedRef.current = true;
    setTargetSoftware(seed.targetSoftware);
    if (seed.client) {
      setSelectedClient({
        id: seed.client.id,
        name: seed.client.name,
        client_ref: seed.client.client_ref,
        business_type: null,
        vat_number: seed.client.vat_number ?? null,
        status: 'active',
      });
      setClientName(seed.client.name);
    }
    setTransactionHistory([seed.transactions as Transaction[]]);
    setHistoryIndex(0);
    setFlaggedEntries(seed.flaggedEntries as FlaggedEntry[]);
    if (seed.dateFrom) setDateFrom(seed.dateFrom);
    if (seed.dateTo)   setDateTo(seed.dateTo);
    setAppState('success');
  }, [seed]);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/full-analysis');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/full-analysis') return;
      const p = consumePendingClient('/full-analysis');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

  // Pre-populate fields when a client is selected
  useEffect(() => {
    if (!selectedClient) return;
    if (selectedClient.name) setClientName(selectedClient.name);
    if (selectedClient.address) setClientAddress(selectedClient.address);
    if (selectedClient.vat_number) setIsVatRegistered(true);
  }, [selectedClient]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [pastTransactionsFile, setPastTransactionsFile] = useState<File | null>(null);
  const [ledgersFile, setLedgersFile] = useState<File | null>(null);

  // ── Package upload (step 3) ────────────────────────────────────────────────
  // A single drag-drop bucket of files, each auto-categorised. The existing
  // documentFiles / pastTransactionsFile / ledgersFile state is DERIVED from this
  // (see effect below) so the analysis logic stays unchanged.
  const [docs, setDocs] = useState<DocItem[]>([]);
  useEffect(() => {
    setDocumentFiles(docs.filter(d => d.cat === 'documents').map(d => d.file));
    setPastTransactionsFile(docs.find(d => d.cat === 'past_transactions')?.file ?? null);
    setLedgersFile(docs.find(d => d.cat === 'chart_of_accounts')?.file ?? null);
  }, [docs]);
  const addDocs = useCallback((files: File[]) => {
    setDocs(prev => [
      ...prev,
      ...files.map(file => ({ id: `${file.name}-${file.size}-${Math.round(file.lastModified)}-${prev.length}`, file, cat: detectDocCat(file) })),
    ]);
  }, []);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Step gating
  const canLeaveStep1 = clientName.trim().length > 0;
  const docCount = docs.filter(d => d.cat === 'documents').length;

  // ── Auto client-context: pulls past saved analyses for this client + software
  // and uses them as a synthetic "past transactions" CSV so the AI stays consistent
  // with previous account-code choices. Disabled automatically if the user uploads
  // their own past-transactions CSV.
  const [autoContextCsv,    setAutoContextCsv]    = useState<string>('');
  const [autoContextCount,  setAutoContextCount]  = useState({ rows: 0, analyses: 0 });
  const [autoContextLoading, setAutoContextLoading] = useState(false);
  const [useAutoContext,    setUseAutoContext]    = useState(true);

  useEffect(() => {
    if (!selectedClient?.id) {
      setAutoContextCsv(''); setAutoContextCount({ rows: 0, analyses: 0 });
      return;
    }
    let cancelled = false;
    setAutoContextLoading(true);
    fetch(`/api/full-analysis/client-context?clientId=${selectedClient.id}&software=${targetSoftware}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setAutoContextCsv(d.csv ?? '');
        setAutoContextCount({ rows: d.rowCount ?? 0, analyses: d.analysisCount ?? 0 });
      })
      .catch(() => {/* silent — context is optional */})
      .finally(() => { if (!cancelled) setAutoContextLoading(false); });
    return () => { cancelled = true; };
  }, [selectedClient?.id, targetSoftware]);

  // SMITH format: resolve the client's bookkeeping book + its chart of accounts
  // so analysis codes to the book's REAL accounts and we know the send target.
  const [bookCoa, setBookCoa] = useState<{ bookId: string; bookName: string; csv: string; accounts: { name: string; code: string }[]; books: { id: string; name: string }[] } | null>(null);
  const [coaBookId, setCoaBookId] = useState<string | null>(null); // user's chosen book (null = primary)
  const [coaStatus, setCoaStatus] = useState<'idle' | 'loading' | 'none' | 'ready'>('idle');

  // Forget the chosen book when the client or format changes.
  useEffect(() => { setCoaBookId(null); }, [selectedClient?.id, targetSoftware]);

  useEffect(() => {
    if (targetSoftware !== 'smith' || !selectedClient?.id) { setBookCoa(null); setCoaStatus('idle'); return; }
    let cancelled = false;
    setCoaStatus('loading');
    fetch(`/api/bookkeeping/clients/${selectedClient.id}/coa${coaBookId ? `?book_id=${coaBookId}` : ''}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        if (d?.book) { setBookCoa({ bookId: d.book.id, bookName: d.book.name, csv: d.csv ?? '', accounts: d.accounts ?? [], books: d.books ?? [] }); setCoaStatus('ready'); }
        else { setBookCoa(null); setCoaStatus('none'); }
      })
      .catch(() => { if (!cancelled) { setBookCoa(null); setCoaStatus('none'); } });
    return () => { cancelled = true; };
  }, [targetSoftware, selectedClient?.id, coaBookId]);

  const [transactionHistory, setTransactionHistory] = useState<Transaction[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [flaggedEntries, setFlaggedEntries] = useState<FlaggedEntry[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [currentView, setCurrentView] = useState<View>('valid');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  // ─── Date range ──────────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showOutOfRange, setShowOutOfRange] = useState(false);

  // ─── Sort & selection state ───────────────────────────────────────────────
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedValid, setSelectedValid] = useState<Set<number>>(new Set());
  const [selectedFlagged, setSelectedFlagged] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState<'account' | 'flag' | null>(null);
  const [bulkValue, setBulkValue] = useState('');

  const processedTransactions = transactionHistory[historyIndex] || [];
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < transactionHistory.length - 1;

  // Sorted views — sort is display-only; origIndex always refers to processedTransactions[]
  const sortedWithIndices = useMemo(() => {
    const indexed = processedTransactions.map((tx, i) => ({ tx, origIndex: i }));
    if (!sort) return indexed;
    return [...indexed].sort((a, b) => {
      const av = (a.tx as unknown as Record<string, unknown>)[sort.key];
      const bv = (b.tx as unknown as Record<string, unknown>)[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      return sort.dir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [processedTransactions, sort]);

  const sortedFlaggedWithIndices = useMemo(() => {
    const indexed = flaggedEntries.map((entry, i) => ({ entry, origIndex: i }));
    if (!sort) return indexed;
    return [...indexed].sort((a, b) => {
      const av = (a.entry as unknown as Record<string, unknown>)[sort.key];
      const bv = (b.entry as unknown as Record<string, unknown>)[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      return sort.dir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [flaggedEntries, sort]);

  // ─── Date range filtering ─────────────────────────────────────────────────
  const hasDateRange = !!(dateFrom || dateTo);

  function getTxDate(tx: Transaction): string {
    const t = tx as unknown as Record<string, unknown>;
    const raw =
      targetSoftware === 'capium' ? t.invoicedate :
      targetSoftware === 'xero'   ? t.invoiceDate :
      targetSoftware === 'quickbooks' ? t.invoiceDate :
      targetSoftware === 'sage'   ? t.DATE :
      t.date;
    return typeof raw === 'string' ? raw : '';
  }

  function txInRange(tx: Transaction): boolean {
    if (!hasDateRange) return true;
    const d = getTxDate(tx);
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo   && d > dateTo)   return false;
    return true;
  }

  const inRangeWithIndices   = useMemo(() => sortedWithIndices.filter(({ tx }) => txInRange(tx)),  [sortedWithIndices, dateFrom, dateTo]);
  const outRangeWithIndices  = useMemo(() => sortedWithIndices.filter(({ tx }) => !txInRange(tx)), [sortedWithIndices, dateFrom, dateTo]);

  const allValidSelected = inRangeWithIndices.length > 0 && inRangeWithIndices.every(({ origIndex }) => selectedValid.has(origIndex));
  const someValidSelected = inRangeWithIndices.some(({ origIndex }) => selectedValid.has(origIndex));
  const allFlaggedSelected = sortedFlaggedWithIndices.length > 0 && sortedFlaggedWithIndices.every(({ origIndex }) => selectedFlagged.has(origIndex));
  const someFlaggedSelected = sortedFlaggedWithIndices.some(({ origIndex }) => selectedFlagged.has(origIndex));

  const accountLabel =
    targetSoftware === 'vt' || targetSoftware === 'smith' ? 'Analysis Account' :
    targetSoftware === 'sage' ? 'Nominal Code' :
    targetSoftware === 'general' ? 'Category' : 'Account Name';
  const hasAccountField = targetSoftware !== 'freeagent';

  const pushHistory = useCallback((newList: Transaction[]) => {
    setTransactionHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, newList];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // ─── Edit handlers ───────────────────────────────────────────────────────────

  const handleSaveTransaction = useCallback((updated: Transaction) => {
    if (!editTarget || editTarget.type !== 'valid') return;
    const newList = processedTransactions.map((tx, i) => i === editTarget.index ? updated : tx);
    pushHistory(newList);
  }, [editTarget, processedTransactions, pushHistory]);

  const handleSaveFlagged = useCallback((updated: FlaggedEntry) => {
    if (!editTarget || editTarget.type !== 'flagged') return;
    setFlaggedEntries(prev => prev.map((e, i) => i === editTarget.index ? updated : e));
  }, [editTarget]);

  const handleFlagTransaction = useCallback((tx: Transaction, reason: string) => {
    if (!editTarget || editTarget.type !== 'valid') return;
    const flagged: FlaggedEntry = { fileName: tx.fileName, reason, pageNumber: tx.pageNumber, transactionData: tx };
    setFlaggedEntries(prev => [...prev, flagged]);
    const newList = processedTransactions.filter((_, i) => i !== editTarget.index);
    pushHistory(newList);
  }, [editTarget, processedTransactions, pushHistory]);

  const handleUnflag = useCallback((entry: FlaggedEntry, tx: Transaction) => {
    if (!editTarget || editTarget.type !== 'flagged') return;
    setFlaggedEntries(prev => prev.filter((_, i) => i !== editTarget.index));
    pushHistory([...processedTransactions, tx]);
  }, [editTarget, processedTransactions, pushHistory]);

  // ─── Bulk handlers ───────────────────────────────────────────────────────────

  const handleBulkAccountChange = useCallback(() => {
    if (!bulkValue.trim()) return;
    const newList = processedTransactions.map((tx, i) => {
      if (!selectedValid.has(i)) return tx;
      const u = { ...tx } as Record<string, unknown>;
      if (targetSoftware === 'vt' || targetSoftware === 'smith') u.analysisAccount = bulkValue;
      else if (targetSoftware === 'capium') { u.accountname = bulkValue; u.accountcode = ''; }
      else if (targetSoftware === 'xero')   { u.accountName = bulkValue; u.accountCode = ''; }
      else if (targetSoftware === 'quickbooks') { u.accountName = bulkValue; u.accountCode = ''; }
      else if (targetSoftware === 'sage')   u.NOMINAL_CODE = bulkValue;
      else if (targetSoftware === 'general') u.category = bulkValue;
      return u as unknown as Transaction;
    });
    pushHistory(newList);
    setSelectedValid(new Set());
    setBulkMode(null); setBulkValue('');
  }, [bulkValue, processedTransactions, selectedValid, targetSoftware, pushHistory]);

  const handleBulkFlag = useCallback(() => {
    if (!bulkValue.trim()) return;
    const newFlagged: FlaggedEntry[] = [];
    const remaining: Transaction[] = [];
    processedTransactions.forEach((tx, i) => {
      if (selectedValid.has(i)) newFlagged.push({ fileName: tx.fileName, reason: bulkValue, pageNumber: tx.pageNumber, transactionData: tx });
      else remaining.push(tx);
    });
    setFlaggedEntries(prev => [...prev, ...newFlagged]);
    pushHistory(remaining);
    setSelectedValid(new Set());
    setBulkMode(null); setBulkValue('');
  }, [bulkValue, processedTransactions, selectedValid, pushHistory]);

  const handleBulkUnflag = useCallback(() => {
    const toPromote: Transaction[] = [];
    const remaining = flaggedEntries.filter((entry, i) => {
      if (!selectedFlagged.has(i)) return true;
      toPromote.push(buildMinimalTx(entry, targetSoftware));
      return false;
    });
    setFlaggedEntries(remaining);
    pushHistory([...processedTransactions, ...toPromote]);
    setSelectedFlagged(new Set());
  }, [flaggedEntries, selectedFlagged, processedTransactions, targetSoftware, pushHistory]);

  // ─── Validation & ledger matching (applied after all scans complete) ─────────

  const applyValidationAndProceed = useCallback((results: DocumentScanResult[]) => {
    const successful = results.filter(r => r.status === 'success');
    const parsedLedgerAccounts = sharedInputsRef.current?.parsedLedgerAccounts ?? [];

    const rawTransactions: Transaction[] = successful.flatMap(r => (r.validTransactions ?? []) as Transaction[]).filter(Boolean);
    const rawFlagged: FlaggedEntry[] = successful.flatMap(r => (r.flaggedEntries ?? []) as FlaggedEntry[]).filter(Boolean);
    const calcFlagged: FlaggedEntry[] = [];
    const validTxs: Transaction[] = [];

    rawTransactions.forEach((tx) => {
      let isValid = true; let reason = ''; let net = 0, vat = 0, gross = 0;
      try {
        if (targetSoftware === 'smith') {
          const sm = tx as SmithTransaction; net = sm.netAmount || 0; vat = sm.vatAmount || 0; gross = sm.grossAmount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'vt') {
          const v = tx as VTTransaction; net = v.analysis || 0; vat = v.vat || 0; gross = v.total || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'capium') {
          const c = tx as CapiumTransaction; net = c.netAmount || 0; vat = c.vatamount || 0; gross = c.amount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'xero') {
          const x = tx as XeroTransaction; net = x.unitAmount || 0; gross = x.grossAmount || 0;
          const rate = x.taxType?.includes('20%') ? 0.20 : x.taxType?.includes('5%') ? 0.05 : 0;
          if (!isVatRegistered) { if (Math.abs(net - gross) > TOLERANCE) { isValid = false; reason = `Non-VAT calc error: unitAmount (${net.toFixed(2)}) ≠ grossAmount (${gross.toFixed(2)})`; } }
          else { if (Math.abs((net + net * rate) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT ≠ Gross (${gross.toFixed(2)})`; } }
        } else if (targetSoftware === 'quickbooks') {
          const q = tx as QuickBooksTransaction; net = q.unitAmount || 0; vat = q.vatAmount || 0; gross = q.grossAmount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'sage') {
          const s = tx as SageTransaction; net = s.NET_AMOUNT || 0; vat = s.TAX_AMOUNT || 0;
          const expectedRate = s.TAX_CODE === 'T1' ? 0.20 : s.TAX_CODE === 'T5' ? 0.05 : 0;
          if (expectedRate > 0 && Math.abs(vat - net * expectedRate) > TOLERANCE) { isValid = false; reason = `Sage VAT error: NET (${net.toFixed(2)}) × ${expectedRate * 100}% ≠ TAX_AMOUNT (${vat.toFixed(2)})`; }
        } else if (targetSoftware === 'general') {
          const g = tx as GeneralTransaction; net = g.netAmount || 0; vat = g.vatAmount || 0; gross = g.grossAmount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        }
      } catch { isValid = false; reason = 'Missing data for calculation check.'; }
      if (isValid) validTxs.push(tx); else calcFlagged.push({ fileName: tx.fileName, reason, pageNumber: tx.pageNumber, transactionData: tx });
    });

    const validated = parsedLedgerAccounts.length > 0 ? validTxs.map(tx => {
      const aiName =
        targetSoftware === 'smith'      ? (tx as SmithTransaction).analysisAccount :
        targetSoftware === 'vt'         ? (tx as VTTransaction).analysisAccount :
        targetSoftware === 'capium'     ? (tx as CapiumTransaction).accountname :
        targetSoftware === 'xero'       ? (tx as XeroTransaction).accountName :
        targetSoftware === 'quickbooks' ? (tx as QuickBooksTransaction).accountName :
        targetSoftware === 'sage'       ? (tx as SageTransaction).NOMINAL_CODE : undefined;
      if (!aiName) return tx;
      const perfect = parsedLedgerAccounts.find(a => a.name.toLowerCase() === aiName?.toLowerCase() || a.code === aiName);
      if (perfect) return { ...tx, ledgerValidation: { status: 'perfect' as const, originalAiSuggestion: { name: aiName } } };
      const { bestMatch, score } = findBestMatch(aiName || '', parsedLedgerAccounts);
      if (bestMatch && score > 0.7) {
        const updated = { ...tx } as Record<string, unknown>;
        if (targetSoftware === 'smith') updated.analysisAccount = bestMatch.name;
        if (targetSoftware === 'vt') updated.analysisAccount = bestMatch.name;
        if (targetSoftware === 'capium') { updated.accountname = bestMatch.name; updated.accountcode = bestMatch.code || ''; }
        if (targetSoftware === 'xero') { updated.accountName = bestMatch.name; updated.accountCode = bestMatch.code || ''; }
        if (targetSoftware === 'quickbooks') { updated.accountName = bestMatch.name; updated.accountCode = bestMatch.code || ''; }
        if (targetSoftware === 'sage') updated.NOMINAL_CODE = bestMatch.code || bestMatch.name;
        return { ...updated, ledgerValidation: { status: 'suggestion' as const, originalAiSuggestion: { name: aiName }, suggestedLedger: bestMatch } } as Transaction;
      }
      return { ...tx, ledgerValidation: { status: 'no-match' as const, originalAiSuggestion: { name: aiName } } };
    }) : validTxs;

    setTransactionHistory([validated]);
    setHistoryIndex(0);
    setFlaggedEntries([...rawFlagged, ...calcFlagged]);
    setSort(null); setSelectedValid(new Set()); setSelectedFlagged(new Set());
    setAppState('success');
  }, [targetSoftware, isVatRegistered]);

  // ─── Scan a list of files one at a time, returning per-file results ──────────

  const scanFiles = useCallback(async (
    filesToScan: File[],
    pastTransactionsContent: string | null,
    ledgersContent: string | null,
  ): Promise<DocumentScanResult[]> => {
    // Scan a single (already size-safe) document through the AI and normalise the
    // result. `chunk` is either the whole file or one page-range slice of it.
    const scanChunk = async (chunk: File): Promise<{
      ok: boolean; validTransactions: Transaction[]; flaggedEntries: FlaggedEntry[];
      errorMessage?: string; errorCode?: string;
    }> => {
      try {
        // Spreadsheets/CSV scanned as documents are converted to text; PDFs/
        // images go as base64.
        const filePayload = isSpreadsheetFile(chunk)
          ? { name: chunk.name, mimeType: chunk.type || 'text/csv', text: await spreadsheetToText(chunk) }
          : { name: chunk.name, mimeType: chunk.type || 'application/pdf', base64: await fileToBase64(chunk) };
        const res = await fetch('/api/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName, clientAddress, isVatRegistered, targetSoftware, analysisMode,
            files: [filePayload],
            pastTransactionsContent, ledgersContent,
            clientId: selectedClient?.id ?? null,
            clientCode: selectedClient?.client_ref ?? null,
          }),
        });

        if (!res.ok) {
          // The body isn't guaranteed to be JSON: a platform-level 413 (body over
          // the Vercel limit) or a proxy error returns plain text, and blindly
          // JSON-parsing it throws the confusing "not valid JSON". Read as text
          // first, then parse defensively.
          const raw = await res.text();
          let errorMessage = 'Analysis failed';
          let errorCode: string | undefined;
          try {
            const err = JSON.parse(raw) as { error?: string; code?: string };
            errorMessage = err.error || errorMessage;
            errorCode = err.code;
          } catch {
            if (res.status === 413) {
              errorMessage = 'This document is too large to send in one request, even after splitting. Try compressing the scan or lowering its resolution before uploading.';
              errorCode = 'FILES_TOO_LARGE';
            } else {
              errorMessage = `The server returned an unexpected response (status ${res.status}). Please try again, or try a smaller file.`;
            }
          }
          return { ok: false, validTransactions: [], flaggedEntries: [], errorMessage, errorCode };
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
        }
        accumulated += decoder.decode();
        const data = JSON.parse(accumulated);
        return { ok: true, validTransactions: data.validTransactions || [], flaggedEntries: data.flaggedEntries || [] };
      } catch (err) {
        return { ok: false, validTransactions: [], flaggedEntries: [], errorMessage: err instanceof Error ? err.message : 'Unexpected error during scanning' };
      }
    };

    // Split every file into chunks up front. Oversized PDFs (typically high-res
    // scans) become several page-chunks; this also gives an accurate total for
    // the progress bar and lets us scan all chunks across all files through one
    // bounded-concurrency pool instead of strictly one-at-a-time.
    const perFile = await Promise.all(
      filesToScan.map(async (file) => ({ file, chunks: await splitPdfIfNeeded(file) })),
    );
    const totalChunks = perFile.reduce((n, f) => n + f.chunks.length, 0);

    // Per-file accumulator — parallel chunk tasks merge their results in here.
    type FileAcc = {
      file: File; chunkCount: number;
      validTransactions: Transaction[]; flaggedEntries: FlaggedEntry[];
      partErrors: string[]; firstErrorCode: string | undefined; done: number;
    };
    const acc: FileAcc[] = perFile.map(({ file, chunks }) => ({
      file, chunkCount: chunks.length,
      validTransactions: [], flaggedEntries: [], partErrors: [], firstErrorCode: undefined, done: 0,
    }));

    const buildResult = (a: FileAcc): DocumentScanResult => {
      const allFailed = a.partErrors.length === a.chunkCount;
      return {
        fileName: a.file.name,
        status: allFailed ? 'failed' : 'success',
        // Parallel chunks can finish out of order — sort by page so the merged
        // document still reads top-to-bottom.
        validTransactions: [...a.validTransactions].sort((x, y) => (x.pageNumber ?? 0) - (y.pageNumber ?? 0)),
        flaggedEntries: [...a.flaggedEntries].sort((x, y) => (x.pageNumber ?? 0) - (y.pageNumber ?? 0)),
        errorMessage: allFailed
          ? a.partErrors[0]
          : a.partErrors.length
            ? `${a.partErrors.length} of ${a.chunkCount} parts couldn't be read — the rest were processed.`
            : undefined,
        errorCode: allFailed ? a.firstErrorCode : undefined,
      };
    };

    // One task per chunk, across every file. They run through the concurrency
    // pool below rather than sequentially.
    let completed = 0;
    const tasks = perFile.flatMap(({ file, chunks }, fileIdx) =>
      chunks.map((chunk) => async () => {
        const a = acc[fileIdx];
        const r = await scanChunk(chunk.file);
        if (r.ok) {
          // Remap chunk-local results back onto the original document: restore the
          // real filename and shift the chunk-relative page number to its absolute
          // page. Keeps preview, Drive/Gmail links and uploads (all keyed off
          // fileName) resolving to the source file and correct page.
          for (const t of r.validTransactions) {
            t.fileName = chunk.originalName;
            if (typeof t.pageNumber === 'number') t.pageNumber = chunk.pageOffset + t.pageNumber;
          }
          for (const f of r.flaggedEntries) {
            f.fileName = chunk.originalName;
            if (typeof f.pageNumber === 'number') f.pageNumber = chunk.pageOffset + f.pageNumber;
          }
          a.validTransactions.push(...r.validTransactions);
          a.flaggedEntries.push(...r.flaggedEntries);
        } else {
          a.partErrors.push(r.errorMessage || 'Processing failed');
          a.firstErrorCode = a.firstErrorCode ?? r.errorCode;
        }
        a.done += 1;
        completed += 1;
        setScanProgress({ current: completed, total: totalChunks, fileName: file.name });
        // Publish this file's result only once all its chunks are in, so the
        // per-file status flips to complete/error when the whole doc is done.
        if (a.done === a.chunkCount) {
          const finished = buildResult(a);
          setScanResults(prev => {
            const map = new Map(prev.map(r => [r.fileName, r]));
            map.set(finished.fileName, finished);
            return Array.from(map.values());
          });
        }
      }),
    );

    await runWithConcurrency(tasks, SCAN_CONCURRENCY);

    return acc.map(buildResult);
  }, [clientName, clientAddress, isVatRegistered, targetSoftware, analysisMode, selectedClient?.id, selectedClient?.client_ref]);

  // ─── Analysis ────────────────────────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (documentFiles.length === 0) return;
    setAppState('loading'); setError(null); setErrorCode(undefined); setProgress(0);
    setScanResults([]);

    // Build a stable file reference map for the rescan handler
    const fileMap = new Map(documentFiles.map(f => [f.name, f]));
    setFileRefs(fileMap);

    // Read shared inputs once — reused across all per-file calls and any re-scans
    let pastTransactionsContent = pastTransactionsFile
      ? await (isSpreadsheetFile(pastTransactionsFile) ? spreadsheetToText(pastTransactionsFile) : readFileAsText(pastTransactionsFile))
      : null;
    // No manual upload? Fall back to the auto-built client context (if enabled).
    if (!pastTransactionsContent && useAutoContext && autoContextCsv) {
      pastTransactionsContent = autoContextCsv;
    }
    let ledgersContent = ledgersFile
      ? await (isSpreadsheetFile(ledgersFile) ? spreadsheetToText(ledgersFile) : readFileAsText(ledgersFile))
      : null;
    // SMITH format: if the user didn't upload a ledgers file, feed the client's
    // book chart of accounts so the AI allocates to the book's real accounts.
    if (targetSoftware === 'smith' && !ledgersContent && bookCoa?.csv) {
      ledgersContent = bookCoa.csv;
    }
    let parsedLedgerAccounts: LedgerAccount[] = [];
    if (ledgersContent) { parsedLedgerAccounts = parseLedgerCsv(ledgersContent); setLedgerAccounts(parsedLedgerAccounts); }
    sharedInputsRef.current = { pastTransactionsContent, ledgersContent, parsedLedgerAccounts };

    // Single file: skip the results page and go straight to success or error
    if (documentFiles.length === 1) {
      try {
        const results = await scanFiles(documentFiles, pastTransactionsContent, ledgersContent);
        setScanProgress(null);
        if (results[0].status === 'failed') {
          setError(results[0].errorMessage ?? 'Scan failed'); setErrorCode(results[0].errorCode); setAppState('error');
        } else {
          applyValidationAndProceed(results);
        }
      } catch {
        setAppState('error'); setError('An unexpected error occurred');
      }
      return;
    }

    // Multiple files: scan each individually, then show the scan results page
    const results = await scanFiles(documentFiles, pastTransactionsContent, ledgersContent);
    setScanProgress(null);
    setScanResults(results);
    setAppState('scan_results');
  }, [documentFiles, pastTransactionsFile, ledgersFile, scanFiles, applyValidationAndProceed, useAutoContext, autoContextCsv]);

  // ─── Re-scan failed documents ─────────────────────────────────────────────

  const handleRescan = useCallback(async () => {
    const failedResults = scanResults.filter(r => r.status === 'failed');
    if (failedResults.length === 0) return;
    const failedFiles = failedResults.map(r => fileRefs.get(r.fileName)).filter(Boolean) as File[];
    if (failedFiles.length === 0) return;

    setIsRescanning(true);
    setAppState('loading');
    setScanProgress(null);

    const { pastTransactionsContent, ledgersContent } = sharedInputsRef.current ?? { pastTransactionsContent: null, ledgersContent: null };
    const newResults = await scanFiles(failedFiles, pastTransactionsContent ?? null, ledgersContent ?? null);

    // Merge: replace each failed entry with its new result (success or still failed)
    setScanResults(prev => {
      const newMap = new Map(newResults.map(r => [r.fileName, r]));
      return prev.map(r => newMap.get(r.fileName) ?? r);
    });

    setScanProgress(null);
    setIsRescanning(false);
    setAppState('scan_results');
  }, [scanResults, fileRefs, scanFiles]);

  // ─── Dismiss failed and proceed with successful results ───────────────────

  const handleDismissAndContinue = useCallback(() => {
    applyValidationAndProceed(scanResults);
  }, [scanResults, applyValidationAndProceed]);

  if (appState === 'loading') {
    const processingFiles: ProgressFile[] = documentFiles.map(f => {
      const result = scanResults.find(r => r.fileName === f.name);
      if (result) return { name: f.name, status: result.status === 'success' ? 'complete' : 'error' };
      if (scanProgress?.fileName === f.name) return { name: f.name, status: 'processing' };
      return { name: f.name, status: 'pending' };
    });
    return (
      <ProcessingView
        progress={progress}
        fileCount={documentFiles.length}
        scanProgress={scanProgress}
        files={processingFiles}
        steps={['Preparing documents', 'Extracting transactions', 'Matching account codes', 'Validating entries', 'Compiling results']}
      />
    );
  }
  if (appState === 'scan_results') return (
    <ToolLayout title="Capture" icon={FileSearch} wide>
      <BackToHistory onBack={onBack} />
      <ScanResultsView
        results={scanResults}
        fileRefs={fileRefs}
        isRescanning={isRescanning}
        onRescan={handleRescan}
        onDismissAndContinue={handleDismissAndContinue}
      />
    </ToolLayout>
  );
  if (appState === 'error') return (
    <ToolLayout title="Capture" icon={FileSearch} wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || 'Unknown error'} code={errorCode} onRetry={() => { setAppState('idle'); setErrorCode(undefined); }} />
    </ToolLayout>
  );

  // ─── Table helpers (scoped to success view) ───────────────────────────────

  const handleSort = (key: string) =>
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const SortTH = ({ children, sortKey, right }: { children?: React.ReactNode; sortKey: string; right?: boolean }) => {
    const active = sort?.key === sortKey;
    const Icon = active ? (sort!.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th onClick={() => handleSort(sortKey)}
        className={`px-3 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'} ${right ? 'text-right' : 'text-left'}`}>
        <div className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {children}<Icon size={11} className={active ? 'text-[var(--accent)]' : 'opacity-40'} />
        </div>
      </th>
    );
  };

  const CheckTH = ({ allSel, someSel, onToggle }: { allSel: boolean; someSel: boolean; onToggle: () => void }) => (
    <th className="px-3 py-3 w-10">
      <input type="checkbox" checked={allSel}
        ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
        onChange={onToggle}
        className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded" />
    </th>
  );

  const TH = ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{children}</th>
  );

  const EditBtn = ({ onClick }: { onClick: () => void }) => (
    <Tooltip label="View / Edit">
      <button onClick={onClick} aria-label="View / Edit" className="p-1 rounded hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
        <Pencil size={13} />
      </button>
    </Tooltip>
  );

  // Bulk action bar for valid transactions
  const BulkBarValid = () => {
    if (selectedValid.size === 0) return null;
    return (
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[var(--accent-light)] border border-[var(--accent)]/25 rounded-xl flex-wrap">
        <span className="text-sm font-semibold text-[var(--accent)]">{selectedValid.size} selected</span>
        <div className="w-px h-4 bg-[var(--accent)]/30 shrink-0" />
        {bulkMode === 'account' ? (<>
          <input type="text" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
            placeholder={`New ${accountLabel}…`} className="input-base py-1 text-sm w-56" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleBulkAccountChange(); if (e.key === 'Escape') { setBulkMode(null); setBulkValue(''); } }} />
          <button onClick={handleBulkAccountChange} disabled={!bulkValue.trim()} className="btn-primary py-1 px-3 text-xs">Apply to all</button>
          <button onClick={() => { setBulkMode(null); setBulkValue(''); }} className="btn-secondary py-1 px-3 text-xs">Cancel</button>
        </>) : bulkMode === 'flag' ? (<>
          <input type="text" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
            placeholder="Reason for flagging…" className="input-base py-1 text-sm w-56" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleBulkFlag(); if (e.key === 'Escape') { setBulkMode(null); setBulkValue(''); } }} />
          <button onClick={handleBulkFlag} disabled={!bulkValue.trim()}
            className="py-1 px-3 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors">Flag all</button>
          <button onClick={() => { setBulkMode(null); setBulkValue(''); }} className="btn-secondary py-1 px-3 text-xs">Cancel</button>
        </>) : (<>
          {hasAccountField && (
            <button onClick={() => setBulkMode('account')} className="btn-secondary py-1 px-3 text-xs">
              Change {accountLabel}
            </button>
          )}
          <button onClick={() => setBulkMode('flag')}
            className="py-1 px-3 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
            <span className="flex items-center gap-1"><AlertTriangle size={11} /> Flag selected</span>
          </button>
          <button onClick={() => setSelectedValid(new Set())} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-auto transition-colors">
            Deselect all
          </button>
        </>)}
      </div>
    );
  };

  // Bulk action bar for flagged entries
  const BulkBarFlagged = () => {
    if (selectedFlagged.size === 0) return null;
    return (
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex-wrap dark:bg-emerald-900/10 dark:border-emerald-800">
        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{selectedFlagged.size} selected</span>
        <div className="w-px h-4 bg-emerald-300/50 shrink-0" />
        <button onClick={handleBulkUnflag}
          className="flex items-center gap-1.5 py-1 px-3 text-xs font-medium rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
          <CheckCheck size={13} /> Mark all as valid
        </button>
        <button onClick={() => setSelectedFlagged(new Set())} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-auto transition-colors">
          Deselect all
        </button>
      </div>
    );
  };

  return (
    <ToolLayout title="Capture" description="Capture invoices, receipts and bank statements, and turn them into accurate bookkeeping entries formatted for VT Transaction+, Capium, Xero, QuickBooks, FreeAgent, Sage, or General." icon={FileSearch} wide>
      <BackToHistory onBack={onBack} />
      {appState === 'idle' && (
        <div className="space-y-5">
          {/* ── Wizard stepper ─────────────────────────────────────────── */}
          <div className="bg-white/[0.78] backdrop-blur-md rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper current={wizardStep} onStep={n => setWizardStep(n as 1 | 2 | 3 | 4)} />
          </div>

          {/* ── Step 1 · Select Client ─────────────────────────────────── */}
          {wizardStep === 1 && (
            <div className="relative z-30 bg-white/[0.78] backdrop-blur-md rounded-xl p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Users size={15} className="text-[var(--accent)]" /> Client</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">Link to client record</span>
                  <ClientSelector value={selectedClient} onSelect={setSelectedClient} align="right" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name" className="input-base" />
                <input type="text" value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Client address (optional)" className="input-base" />
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">VAT registered?</span>
                  <button type="button" onClick={() => setIsVatRegistered(!isVatRegistered)}
                    className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 ${isVatRegistered ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ml-0.5 ${isVatRegistered ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Date range <span className="normal-case font-normal">(optional)</span></p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base w-full" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base w-full" />
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5">Transactions outside this range will be shown separately.</p>
              </div>
            </div>
          )}

          {/* ── Step 2 · Choose Output ─────────────────────────────────── */}
          {wizardStep === 2 && (
            <div className="space-y-5">
              <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-1"><FileOutput size={15} className="text-[var(--accent)]" /> Generate for</h3>
                <p className="text-xs text-[var(--text-muted)] mb-4">Choose the accounting software the entries should be formatted for.</p>
                <div className="flex flex-wrap gap-2">
                  {SOFTWARE_OPTIONS.map(({ id, label, logo }) => (
                    <button key={id} type="button" onClick={() => setTargetSoftware(id)}
                      className={`flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${targetSoftware === id ? 'bg-[var(--accent)] text-white shadow-accent-glow' : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]'}`}>
                      <span className="w-6 h-6 rounded-full bg-white flex items-center justify-center overflow-hidden shrink-0 border border-black/5">
                        <img src={logo} alt="" className="w-full h-full object-contain" />
                      </span>
                      {label}
                    </button>
                  ))}
                </div>

                {/* SMITH Bookkeeping — which chart of accounts the analysis codes
                    against (and the book entries will post to). */}
                {targetSoftware === 'smith' && (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]">
                    {!selectedClient ? (
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><BookCopy size={13} /> Select a client to code against its bookkeeping chart of accounts.</p>
                    ) : coaStatus === 'loading' ? (
                      <p className="text-xs text-[var(--text-muted)]">Loading chart of accounts…</p>
                    ) : coaStatus === 'none' || !bookCoa ? (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        <span>No bookkeeping found for {clientName || 'this client'} — accounts will import to <strong>Suspense</strong>. Create a set of books for them (or upload a chart of accounts) for accurate coding.</span>
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <BookCopy size={13} className="text-[var(--accent)]" />
                        {bookCoa.books.length > 1 ? (
                          <>
                            <span className="text-[var(--text-secondary)]">Code against book:</span>
                            <select value={bookCoa.bookId} onChange={e => setCoaBookId(e.target.value)} className="input-base text-xs py-1">
                              {bookCoa.books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          </>
                        ) : (
                          <span className="text-[var(--text-secondary)]">Using <strong>{bookCoa.bookName}</strong>&rsquo;s chart of accounts</span>
                        )}
                        <span className="text-[var(--text-muted)]">· {bookCoa.accounts.length} account{bookCoa.accounts.length === 1 ? '' : 's'} · entries post here</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-1"><SlidersHorizontal size={15} className="text-[var(--accent)]" /> Analysis settings</h3>
                <p className="text-xs text-[var(--text-muted)] mb-4">Tune how carefully SMITH reads your documents.</p>

                <p className="text-xs font-semibold text-[var(--text-secondary)] mb-2">Analysis mode</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {([
                    { id: 'standard' as const, icon: <Zap size={15} />,      label: 'Standard', rec: true,  desc: 'Best balance of speed and accuracy. Right for most jobs.' },
                    { id: 'thorough' as const, icon: <Sparkles size={15} />, label: 'Thorough', rec: false, desc: 'Reads every line extra carefully and double-checks each figure. Slower and uses more AI credit.' },
                  ]).map(m => (
                    <button key={m.id} type="button" onClick={() => setAnalysisMode(m.id)}
                      className={`text-left rounded-xl border p-3.5 transition-colors ${analysisMode === m.id ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-nav-hover)]'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={analysisMode === m.id ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}>{m.icon}</span>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">{m.label}</span>
                        {m.rec && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">Recommended</span>}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] leading-snug">{m.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="flex items-start gap-3 mt-5 pt-4 border-t border-[var(--border)]">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-[var(--text-secondary)]">Learn from past analyses</p>
                    <p className="text-[11px] text-[var(--text-muted)] leading-snug mt-0.5">
                      {!selectedClient
                        ? 'Link a client (step 1) to reuse account-code choices from their previous analyses.'
                        : autoContextLoading
                          ? 'Looking for past analyses for this client…'
                          : autoContextCount.rows > 0
                            ? <>Using <span className="font-semibold text-[var(--text-secondary)]">{autoContextCount.rows}</span> entries from <span className="font-semibold text-[var(--text-secondary)]">{autoContextCount.analyses}</span> past {autoContextCount.analyses === 1 ? 'analysis' : 'analyses'} to keep coding consistent.</>
                            : 'No past analyses found for this client yet.'}
                    </p>
                  </div>
                  <button type="button" onClick={() => setUseAutoContext(v => !v)} aria-label="Toggle past-analysis learning"
                    disabled={!selectedClient || autoContextCount.rows === 0}
                    className={`relative inline-flex h-6 w-11 rounded-full transition-colors shrink-0 mt-0.5 disabled:opacity-40 ${useAutoContext && autoContextCount.rows > 0 ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${useAutoContext && autoContextCount.rows > 0 ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3 · Upload Documents ──────────────────────────────── */}
          {wizardStep === 3 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2 space-y-4">
                <div
                  onClick={() => docInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); addDocs(Array.from(e.dataTransfer.files)); }}
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)] bg-white/[0.5] hover:border-[var(--accent)]'}`}>
                  <UploadCloud size={28} className="mx-auto text-[var(--accent)] mb-2" />
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Drop files here or click to browse</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Invoices, receipts & bank statements (PDF, JPG, PNG) — plus optional past-transactions / chart-of-accounts CSVs. We auto-sort them; retag below if needed.</p>
                </div>
                <input ref={docInputRef} type="file" multiple accept="application/pdf,image/*,.csv,.xlsx,.xls,.tsv" className="hidden"
                  onChange={e => { addDocs(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

                {docs.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] px-1">{docs.length} {docs.length === 1 ? 'file' : 'files'}</p>
                    {docs.map(d => (
                      <div key={d.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                        <FileSearch size={14} className="text-[var(--text-muted)] shrink-0" />
                        <span className="text-xs font-medium text-[var(--text-primary)] truncate flex-1">{d.file.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0 hidden sm:inline">{(d.file.size / 1024).toFixed(0)} KB</span>
                        <select value={d.cat} onChange={e => setDocs(prev => prev.map(x => x.id === d.id ? { ...x, cat: e.target.value as DocCat } : x))}
                          className="text-[11px] h-7 rounded-md border border-[var(--border-input)] bg-[var(--bg-input)] px-1.5 text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent)]">
                          {DOC_CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        <button type="button" onClick={() => setDocs(prev => prev.filter(x => x.id !== d.id))} aria-label="Remove file" className="text-[var(--text-muted)] hover:text-red-500 shrink-0">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Readiness + connectors */}
              <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-4 h-fit">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-3">Ready to analyse</h4>
                <div className="space-y-3">
                  {DOC_CATS.map(c => {
                    const count = docs.filter(d => d.cat === c.id).length;
                    const ok = count > 0;
                    return (
                      <div key={c.id} className="flex items-start gap-2.5">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold ${ok ? 'bg-emerald-500 text-white' : c.required ? 'bg-amber-100 text-amber-600' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                          {ok ? <Check size={10} /> : c.required ? '!' : '○'}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[var(--text-primary)]">
                            {c.label} {c.required ? <span className="text-red-500">*</span> : <span className="text-[var(--text-muted)] font-normal">(optional)</span>}
                            {count > 0 && <span className="text-[var(--accent)] font-normal"> · {count}</span>}
                          </p>
                          <p className="text-[11px] text-[var(--text-muted)] leading-snug">{c.hint}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-[var(--border)] space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Connect a source <span className="font-normal normal-case">(soon)</span></p>
                  {['SMITH Bookkeeping', 'Xero', 'QuickBooks'].map(s => (
                    <div key={s} className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                      <BookCopy size={12} className="shrink-0" /> {s}
                      <span className="ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--bg-nav-hover)]">Soon</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Nav buttons ────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setWizardStep(s => Math.max(1, s - 1) as 1 | 2 | 3 | 4)} disabled={wizardStep === 1}
              className="btn-secondary disabled:opacity-40 disabled:cursor-not-allowed">
              <ArrowLeft size={15} /> Back
            </button>
            {wizardStep < 3 ? (
              <button type="button" onClick={() => setWizardStep(s => Math.min(3, s + 1) as 1 | 2 | 3 | 4)}
                disabled={wizardStep === 1 && !canLeaveStep1}
                className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                Next <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" onClick={handleProcess} disabled={docCount === 0} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
                <FileSearch size={15} /> Analyse {docCount > 0 ? `${docCount} ${docCount === 1 ? 'document' : 'documents'}` : 'documents'}
              </button>
            )}
          </div>
        </div>
      )}

      {appState === 'success' && (
        <div className="space-y-4">
          {/* Wizard stepper — Review step. Clicking a prior step returns to setup. */}
          <div className="bg-white/[0.78] backdrop-blur-md rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper current={4} onStep={n => { if (n < 4) { setAppState('idle'); setWizardStep(n as 1 | 2 | 3 | 4); } }} />
          </div>
          {/* Top action bar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2">
              <button onClick={() => { setCurrentView('valid'); setBulkMode(null); setBulkValue(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${currentView === 'valid' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>
                Valid ({processedTransactions.length})
              </button>
              <button onClick={() => { setCurrentView('flagged'); setBulkMode(null); setBulkValue(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${currentView === 'flagged' ? 'bg-amber-500 text-white' : 'btn-secondary'}`}>
                <AlertTriangle size={13} />Flagged ({flaggedEntries.length})
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setHistoryIndex(h => h - 1); setSelectedValid(new Set()); }} disabled={!canUndo} className="btn-secondary px-2.5 py-2"><Undo2 size={14} /></button>
              <button onClick={() => { setHistoryIndex(h => h + 1); setSelectedValid(new Set()); }} disabled={!canRedo} className="btn-secondary px-2.5 py-2"><Redo2 size={14} /></button>
              <button onClick={() => setSaveModalOpen(true)} className="btn-primary"><Download size={14} />Save Analysis</button>
              <button onClick={() => {
                setDocs([]); setTransactionHistory([]); setHistoryIndex(-1); setFlaggedEntries([]);
                setScanResults([]); setSelectedValid(new Set()); setSelectedFlagged(new Set());
                setWizardStep(1); setAppState('idle');
              }} className="btn-secondary">New Analysis</button>
            </div>
          </div>

          {/* Valid transactions */}
          {currentView === 'valid' && (
            <div className="space-y-2">
              <BulkBarValid />
              <div className="bg-white/[0.78] backdrop-blur-md rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--border)]">
                    <tr>
                      <CheckTH allSel={allValidSelected} someSel={someValidSelected}
                        onToggle={() => {
                          if (allValidSelected) setSelectedValid(new Set());
                          else setSelectedValid(new Set(inRangeWithIndices.map(x => x.origIndex)));
                        }} />
                      {targetSoftware === 'smith' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="type">Type</SortTH><SortTH sortKey="contactName">Contact</SortTH><TH>Description</TH><SortTH sortKey="analysisAccount">Account</SortTH><SortTH sortKey="netAmount" right>Net</SortTH><SortTH sortKey="vatAmount" right>VAT</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><TH></TH></>}
                      {targetSoftware === 'vt' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="type">Type</SortTH><SortTH sortKey="primaryAccount">Account</SortTH><TH>Details</TH><SortTH sortKey="total" right>Total</SortTH><SortTH sortKey="vat" right>VAT</SortTH><SortTH sortKey="analysis" right>Net</SortTH><SortTH sortKey="analysisAccount">Analysis Account</SortTH><TH></TH></>}
                      {targetSoftware === 'capium' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="invoicedate">Date</SortTH><SortTH sortKey="contactname">Contact</SortTH><TH>Description</TH><SortTH sortKey="accountname">Account</SortTH><SortTH sortKey="amount" right>Gross</SortTH><SortTH sortKey="vatamount" right>VAT</SortTH><SortTH sortKey="netAmount" right>Net</SortTH><TH></TH></>}
                      {targetSoftware === 'xero' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="invoiceDate">Date</SortTH><SortTH sortKey="contactName">Contact</SortTH><SortTH sortKey="invoiceNumber">Invoice No</SortTH><TH>Description</TH><SortTH sortKey="unitAmount" right>Net</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><SortTH sortKey="accountName">Account</SortTH><SortTH sortKey="taxType">Tax</SortTH><TH></TH></>}
                      {targetSoftware === 'quickbooks' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="invoiceDate">Date</SortTH><SortTH sortKey="supplier">Supplier</SortTH><SortTH sortKey="invoiceNo">Invoice No</SortTH><TH>Description</TH><SortTH sortKey="unitAmount" right>Net</SortTH><SortTH sortKey="vatAmount" right>VAT</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><SortTH sortKey="accountName">Account</SortTH><TH></TH></>}
                      {targetSoftware === 'freeagent' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="amount" right>Amount</SortTH><TH>Description</TH><TH></TH></>}
                      {targetSoftware === 'sage' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="DATE">Date</SortTH><SortTH sortKey="TYPE">Type</SortTH><SortTH sortKey="ACCOUNT_REF">Acct Ref</SortTH><SortTH sortKey="NOMINAL_CODE">Nominal</SortTH><TH>Details</TH><SortTH sortKey="NET_AMOUNT" right>Net</SortTH><SortTH sortKey="TAX_CODE">Tax</SortTH><SortTH sortKey="TAX_AMOUNT" right>Tax Amt</SortTH><TH></TH></>}
                      {targetSoftware === 'general' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="supplier">Supplier</SortTH><SortTH sortKey="invoiceNumber">Invoice No</SortTH><TH>Description</TH><SortTH sortKey="netAmount" right>Net</SortTH><SortTH sortKey="vatAmount" right>VAT</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><SortTH sortKey="category">Category</SortTH><TH></TH></>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {inRangeWithIndices.map(({ tx, origIndex }) => {
                      const isSelected = selectedValid.has(origIndex);
                      const rowCls = `transition-colors ${isSelected ? 'bg-[var(--accent-light)]' : 'hover:bg-[var(--bg-nav-hover)]'}`;
                      const toggleRow = () => setSelectedValid(prev => { const n = new Set(prev); isSelected ? n.delete(origIndex) : n.add(origIndex); return n; });
                      const checkTd = (
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={isSelected} onChange={toggleRow} className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded" />
                        </td>
                      );
                      const editTd = <td className="px-2 py-2" onClick={e => e.stopPropagation()}><EditBtn onClick={() => setEditTarget({ type: 'valid', index: origIndex })} /></td>;

                      if (targetSoftware === 'smith') {
                        const m = tx as SmithTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{m.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{m.date}</td>
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{m.type}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{m.contactName}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{m.description}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{m.analysisAccount}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{m.netAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{m.vatAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{m.grossAmount?.toFixed(2)}</td>
                          {editTd}
                        </tr>;
                      }

                      if (targetSoftware === 'vt') {
                        const v = tx as VTTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{v.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.date}</td>
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{v.type}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.primaryAccount}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{v.details}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{v.total?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{v.vat?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{v.analysis?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.analysisAccount}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'capium') {
                        const c = tx as CapiumTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{c.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.invoicedate}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.contactname}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{c.description}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.accountname}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{c.amount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{c.vatamount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{c.netAmount?.toFixed(2)}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'xero') {
                        const x = tx as XeroTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{x.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.invoiceDate}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.contactName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.invoiceNumber}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{x.description}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{x.unitAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{x.grossAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.accountName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.taxType}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'quickbooks') {
                        const q = tx as QuickBooksTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{q.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.invoiceDate}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.supplier}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.invoiceNo}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{q.description}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{q.unitAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{q.vatAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{q.grossAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.accountName}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'freeagent') {
                        const f = tx as FreeAgentTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{f.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{f.date}</td>
                          <td className={`px-3 py-2.5 text-right font-medium ${f.amount < 0 ? 'text-red-500' : 'text-emerald-600'}`}>£{f.amount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 truncate max-w-[200px] text-[var(--text-secondary)]">{f.description}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'sage') {
                        const s = tx as SageTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[100px]">{s.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.DATE}</td>
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{s.TYPE}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.ACCOUNT_REF}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.NOMINAL_CODE}</td>
                          <td className="px-3 py-2.5 truncate max-w-[140px] text-[var(--text-secondary)]">{s.DETAILS}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{s.NET_AMOUNT?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.TAX_CODE}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{s.TAX_AMOUNT?.toFixed(2)}</td>
                          {editTd}
                        </tr>;
                      }
                      // general
                      const g = tx as GeneralTransaction;
                      return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                        {checkTd}
                        <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[100px]">{g.fileName}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{g.date}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{g.supplier}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{g.invoiceNumber}</td>
                        <td className="px-3 py-2.5 truncate max-w-[140px] text-[var(--text-secondary)]">{g.description}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{g.netAmount?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{g.vatAmount?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{g.grossAmount?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] truncate max-w-[100px]">{g.category}</td>
                        {editTd}
                      </tr>;
                    })}
                  </tbody>
                </table>
                {inRangeWithIndices.length === 0 && (
                  <p className="text-center text-[var(--text-muted)] py-10 text-sm">
                    {hasDateRange && processedTransactions.length > 0 ? 'No transactions within the selected date range.' : 'No valid transactions found.'}
                  </p>
                )}
              </div>

              {/* Out-of-range section */}
              {hasDateRange && outRangeWithIndices.length > 0 && (
                <div className="bg-white/[0.78] backdrop-blur-md rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowOutOfRange(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle size={14} />
                      {outRangeWithIndices.length} out-of-range transaction{outRangeWithIndices.length !== 1 ? 's' : ''} (excluded from export)
                    </span>
                    {showOutOfRange ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  {showOutOfRange && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm opacity-70">
                        <thead className="border-b border-[var(--border)]">
                          <tr>
                            <th className="px-3 py-3 w-10" />
                            {targetSoftware === 'vt' && <><TH>File</TH><TH>Date</TH><TH>Type</TH><TH>Account</TH><TH>Details</TH><TH>Total</TH><TH>VAT</TH><TH>Net</TH><TH>Analysis Account</TH><TH /></>}
                            {targetSoftware === 'capium' && <><TH>File</TH><TH>Date</TH><TH>Contact</TH><TH>Description</TH><TH>Account</TH><TH>Gross</TH><TH>VAT</TH><TH>Net</TH><TH /></>}
                            {targetSoftware === 'xero' && <><TH>File</TH><TH>Date</TH><TH>Contact</TH><TH>Invoice No</TH><TH>Description</TH><TH>Net</TH><TH>Gross</TH><TH>Account</TH><TH>Tax</TH><TH /></>}
                            {targetSoftware === 'quickbooks' && <><TH>File</TH><TH>Date</TH><TH>Supplier</TH><TH>Invoice No</TH><TH>Description</TH><TH>Net</TH><TH>VAT</TH><TH>Gross</TH><TH>Account</TH><TH /></>}
                            {targetSoftware === 'freeagent' && <><TH>File</TH><TH>Date</TH><TH>Amount</TH><TH>Description</TH><TH /></>}
                            {targetSoftware === 'sage' && <><TH>File</TH><TH>Date</TH><TH>Type</TH><TH>Acct Ref</TH><TH>Nominal</TH><TH>Details</TH><TH>Net</TH><TH>Tax</TH><TH>Tax Amt</TH><TH /></>}
                            {targetSoftware === 'general' && <><TH>File</TH><TH>Date</TH><TH>Supplier</TH><TH>Invoice No</TH><TH>Description</TH><TH>Net</TH><TH>VAT</TH><TH>Gross</TH><TH>Category</TH><TH /></>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {outRangeWithIndices.map(({ tx, origIndex }) => {
                            const rowCls = 'hover:bg-[var(--bg-nav-hover)] transition-colors';
                            const editTd = <td className="px-2 py-2" onClick={e => e.stopPropagation()}><EditBtn onClick={() => setEditTarget({ type: 'valid', index: origIndex })} /></td>;
                            if (targetSoftware === 'vt') { const v = tx as VTTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 text-[var(--text-muted)] truncate max-w-[120px]">{v.fileName}</td><td className="px-3 py-2">{v.date}</td><td className="px-3 py-2">{v.type}</td><td className="px-3 py-2">{v.primaryAccount}</td><td className="px-3 py-2 truncate max-w-[160px]">{v.details}</td><td className="px-3 py-2 text-right">£{v.total?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{v.vat?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{v.analysis?.toFixed(2)}</td><td className="px-3 py-2">{v.analysisAccount}</td>{editTd}</tr>; }
                            if (targetSoftware === 'capium') { const c = tx as CapiumTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{c.fileName}</td><td className="px-3 py-2">{c.invoicedate}</td><td className="px-3 py-2">{c.contactname}</td><td className="px-3 py-2 truncate max-w-[160px]">{c.description}</td><td className="px-3 py-2">{c.accountname}</td><td className="px-3 py-2 text-right">£{c.amount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{c.vatamount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{c.netAmount?.toFixed(2)}</td>{editTd}</tr>; }
                            if (targetSoftware === 'xero') { const x = tx as XeroTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{x.fileName}</td><td className="px-3 py-2">{x.invoiceDate}</td><td className="px-3 py-2">{x.contactName}</td><td className="px-3 py-2">{x.invoiceNumber}</td><td className="px-3 py-2 truncate max-w-[160px]">{x.description}</td><td className="px-3 py-2 text-right">£{x.unitAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{x.grossAmount?.toFixed(2)}</td><td className="px-3 py-2">{x.accountName}</td><td className="px-3 py-2">{x.taxType}</td>{editTd}</tr>; }
                            if (targetSoftware === 'quickbooks') { const q = tx as QuickBooksTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{q.fileName}</td><td className="px-3 py-2">{q.invoiceDate}</td><td className="px-3 py-2">{q.supplier}</td><td className="px-3 py-2">{q.invoiceNo}</td><td className="px-3 py-2 truncate max-w-[160px]">{q.description}</td><td className="px-3 py-2 text-right">£{q.unitAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{q.vatAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{q.grossAmount?.toFixed(2)}</td><td className="px-3 py-2">{q.accountName}</td>{editTd}</tr>; }
                            if (targetSoftware === 'freeagent') { const f = tx as FreeAgentTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{f.fileName}</td><td className="px-3 py-2">{f.date}</td><td className="px-3 py-2 text-right">£{f.amount?.toFixed(2)}</td><td className="px-3 py-2 truncate max-w-[200px]">{f.description}</td>{editTd}</tr>; }
                            if (targetSoftware === 'sage') { const s = tx as SageTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[100px]">{s.fileName}</td><td className="px-3 py-2">{s.DATE}</td><td className="px-3 py-2">{s.TYPE}</td><td className="px-3 py-2">{s.ACCOUNT_REF}</td><td className="px-3 py-2">{s.NOMINAL_CODE}</td><td className="px-3 py-2 truncate max-w-[140px]">{s.DETAILS}</td><td className="px-3 py-2 text-right">£{s.NET_AMOUNT?.toFixed(2)}</td><td className="px-3 py-2">{s.TAX_CODE}</td><td className="px-3 py-2 text-right">£{s.TAX_AMOUNT?.toFixed(2)}</td>{editTd}</tr>; }
                            const g = tx as GeneralTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[100px]">{g.fileName}</td><td className="px-3 py-2">{g.date}</td><td className="px-3 py-2">{g.supplier}</td><td className="px-3 py-2">{g.invoiceNumber}</td><td className="px-3 py-2 truncate max-w-[140px]">{g.description}</td><td className="px-3 py-2 text-right">£{g.netAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{g.vatAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{g.grossAmount?.toFixed(2)}</td><td className="px-3 py-2 truncate max-w-[100px]">{g.category}</td>{editTd}</tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Flagged entries */}
          {currentView === 'flagged' && (
            <div className="space-y-2">
              <BulkBarFlagged />
              {flaggedEntries.length === 0 && (
                <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">No flagged entries.</div>
              )}
              {flaggedEntries.length > 0 && (
                <div className="bg-white/[0.78] backdrop-blur-md rounded-xl overflow-hidden">
                  {/* Select-all header row */}
                  <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
                    <input type="checkbox" checked={allFlaggedSelected}
                      ref={el => { if (el) el.indeterminate = someFlaggedSelected && !allFlaggedSelected; }}
                      onChange={() => {
                        if (allFlaggedSelected) setSelectedFlagged(new Set());
                        else setSelectedFlagged(new Set(sortedFlaggedWithIndices.map(x => x.origIndex)));
                      }}
                      className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded" />
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                      {flaggedEntries.length} flagged {flaggedEntries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {sortedFlaggedWithIndices.map(({ entry, origIndex }) => {
                      const isSelected = selectedFlagged.has(origIndex);
                      return (
                        <div key={origIndex}
                          className={`flex items-start gap-3 p-4 transition-colors cursor-pointer ${isSelected ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'hover:bg-[var(--bg-nav-hover)]'}`}
                          onClick={() => setSelectedFlagged(prev => { const n = new Set(prev); isSelected ? n.delete(origIndex) : n.add(origIndex); return n; })}>
                          <input type="checkbox" checked={isSelected}
                            onChange={() => setSelectedFlagged(prev => { const n = new Set(prev); isSelected ? n.delete(origIndex) : n.add(origIndex); return n; })}
                            onClick={e => e.stopPropagation()}
                            className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-[var(--text-primary)]">{entry.fileName}</p>
                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{entry.reason}</p>
                            {entry.date && <p className="text-xs text-[var(--text-muted)] mt-1">Date: {entry.date} · Amount: £{entry.amount?.toFixed(2)}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-lg">
                              p.{entry.pageNumber || '?'}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); setEditTarget({ type: 'flagged', index: origIndex }); }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium btn-secondary"
                            >
                              <Pencil size={12} /> Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <SaveAnalysisModal
        isOpen={saveModalOpen}
        transactions={processedTransactions}
        flaggedEntries={flaggedEntries}
        documentFiles={documentFiles}
        targetSoftware={targetSoftware}
        initialClient={selectedClient}
        dateFrom={dateFrom}
        dateTo={dateTo}
        bookId={targetSoftware === 'smith' ? (bookCoa?.bookId ?? null) : null}
        onClose={() => setSaveModalOpen(false)}
      />

      {editTarget && appState === 'success' && (
        <TransactionEditModal
          item={editTarget.type === 'valid' ? processedTransactions[editTarget.index] : flaggedEntries[editTarget.index]}
          isFlagged={editTarget.type === 'flagged'}
          targetSoftware={targetSoftware}
          documentFiles={documentFiles}
          onSaveTransaction={handleSaveTransaction}
          onSaveFlagged={handleSaveFlagged}
          onFlagTransaction={handleFlagTransaction}
          onUnflag={handleUnflag}
          onClose={() => setEditTarget(null)}
        />
      )}
    </ToolLayout>
  );
}
