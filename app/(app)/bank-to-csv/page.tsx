'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { consumePendingClient } from '@/lib/pendingClient';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import SaveBankCsvModal from '@/components/features/bank-to-csv/SaveBankCsvModal';
import BankToCsvHistory, { type BankCsvSeed } from '@/components/features/bank-to-csv/BankToCsvHistory';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { fileToBase64 } from '@/utils/fileUtils';
import type { BankCsvTransaction, DocumentScanResult } from '@/types';
import {
  ArrowLeftRight, Download, ArrowLeft, ArrowRight, Check, UploadCloud, Building2,
  CalendarDays, Hash, CreditCard, FileText, Image as ImageIcon, Files, ShieldCheck,
  Loader2, Trash2, BookCopy,
} from 'lucide-react';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';

// Max base64 length we can POST in one request. The hosting platform caps a
// serverless request body at ~4.5 MB; base64 is ~1 byte per character, so we
// keep the encoded payload comfortably under that.
const BANK_UPLOAD_LIMIT = 4_400_000;

interface ChunkScan {
  ok: boolean;
  transactions: BankCsvTransaction[];
  errorMessage?: string;
  errorCode?: string;
  truncated?: boolean;
}

interface BankScanContext {
  accountName?: string | null;
  accountNumber?: string | null;
  yearEnd?: string | null;
}

// Scan a single (already-small-enough) file through the API, returning a result
// object. Parses error responses defensively so a platform error page (e.g. a
// 413 sent as plain text) surfaces a real message, not "Unexpected token … is
// not valid JSON".
async function scanOneBankFile(file: File, clientId: string | null, clientCode: string | null, ctx: BankScanContext): Promise<ChunkScan> {
  const base64 = await fileToBase64(file);
  const tooLargeMsg = `This file is too large to process in one go (${(file.size / 1048576).toFixed(1)} MB). Split the PDF into smaller parts and upload them separately.`;
  if (base64.length > BANK_UPLOAD_LIMIT) {
    return { ok: false, transactions: [], errorCode: 'FILE_TOO_LARGE', errorMessage: tooLargeMsg };
  }
  const res = await fetch('/api/bank-to-csv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ name: file.name, mimeType: file.type || 'application/pdf', base64 }],
      clientId, clientCode,
      accountName: ctx.accountName ?? null,
      accountNumber: ctx.accountNumber ?? null,
      yearEnd: ctx.yearEnd ?? null,
    }),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    if (res.status === 413 || /request entity too large|payload too large|content too large/i.test(raw)) {
      return { ok: false, transactions: [], errorCode: 'FILE_TOO_LARGE', errorMessage: tooLargeMsg };
    }
    let errorMessage = 'Processing failed';
    let errorCode: string | undefined;
    try { const err = JSON.parse(raw); errorMessage = err.error || errorMessage; errorCode = err.code; }
    catch { errorMessage = raw.slice(0, 160).trim() || `Server error (${res.status})`; }
    return { ok: false, transactions: [], errorMessage, errorCode };
  }
  const data = await res.json();
  return { ok: true, transactions: ((data.transactions || []) as BankCsvTransaction[]).filter(Boolean), truncated: !!data.truncated };
}

// A long statement is split into runs of at most this many pages so each part
// is a quick, self-contained request — this keeps a big PDF from timing out or
// having its output truncated, even when the file itself is small (text-based
// statements are tiny on disk but can be dozens of pages / thousands of rows).
const MAX_PAGES_PER_CHUNK = 6;

// Split a PDF into page-chunks so each part processes quickly and fits under
// both the upload limit and the model's output limit. A PDF is split when it's
// either too big on disk OR longer than MAX_PAGES_PER_CHUNK pages. Non-PDFs and
// single-page PDFs pass straight through. Each page-run is also halved
// recursively if the saved bytes are still over the upload limit — this copes
// with pdf-lib duplicating shared resources (fonts/images) into each chunk, and
// with heavy scanned pages. Parts stay in page order so the merged rows are
// chronological.
async function splitPdfIfNeeded(file: File): Promise<File[]> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return [file];
  try {
    const { PDFDocument } = await import('pdf-lib');
    const srcBytes = new Uint8Array(await file.arrayBuffer());
    const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
    const pageCount = src.getPageCount();
    const overSize = (file.size * 4) / 3 > BANK_UPLOAD_LIMIT;
    const overLength = pageCount > MAX_PAGES_PER_CHUNK;
    // Nothing to gain from splitting a single page or a short, small statement.
    if (pageCount <= 1 || (!overSize && !overLength)) return [file];
    const base = file.name.replace(/\.pdf$/i, '');
    const out: File[] = [];
    const emit = async (indices: number[]): Promise<void> => {
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(src, indices);
      pages.forEach(p => doc.addPage(p));
      const bytes = await doc.save();
      if ((bytes.length * 4) / 3 <= BANK_UPLOAD_LIMIT || indices.length === 1) {
        out.push(new File([bytes], `${base} — part ${out.length + 1}.pdf`, { type: 'application/pdf' }));
        return;
      }
      const mid = Math.ceil(indices.length / 2);
      await emit(indices.slice(0, mid));
      await emit(indices.slice(mid));
    };
    // First break the document into page-runs (bounds request time + output
    // size), then let emit() further halve any run that's still too big on disk.
    const allIndices = Array.from({ length: pageCount }, (_, i) => i);
    for (let start = 0; start < pageCount; start += MAX_PAGES_PER_CHUNK) {
      await emit(allIndices.slice(start, start + MAX_PAGES_PER_CHUNK));
    }
    return out.length > 0 ? out : [file];
  } catch {
    return [file];
  }
}

// ── Setup wizard ──────────────────────────────────────────────────────────
const WIZARD_STEPS = [
  { n: 1, label: 'Select Client' },
  { n: 2, label: 'Upload Statement' },
  { n: 3, label: 'Extract Transactions' },
  { n: 4, label: 'Review & Export' },
] as const;

function WizardStepper({ current, onStep }: { current: number; onStep?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap">
      {WIZARD_STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const clickable = !!onStep && s.n < current;
        return (
          <div key={s.n} className="flex items-center gap-1.5 sm:gap-2.5">
            <button type="button" disabled={!clickable} onClick={() => clickable && onStep?.(s.n)}
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

const SUPPORTED_FORMATS = [
  { icon: FileText, label: 'PDF documents' },
  { icon: ImageIcon, label: 'PNG, JPG images' },
  { icon: Files, label: 'Multi-page statements' },
];

const EXTRACTED_FIELDS = ['Transaction date', 'Description', 'Money in', 'Money out', 'Balance', 'Reference'];

function isSupportedBankFile(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
}

// ── Page wrapper ────────────────────────────────────────────────────────────
export default function BankToCsvPage() {
  const [view, setView] = useState<'history' | 'tool'>('history');
  const [seed, setSeed] = useState<BankCsvSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  return view === 'history' ? (
    <BankToCsvHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <BankToCsvTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
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

function BankToCsvTool({ seed, onBack }: { seed: BankCsvSeed | null; onBack: () => void }) {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/bank-to-csv', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [results, setResults] = useState<BankCsvTransaction[]>([]);
  const [wasTruncated, setWasTruncated] = useState(false);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  // Optional statement context — passed through to the AI as reference only.
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [yearEnd, setYearEnd] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setDocumentFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}-${f.size}`));
      return [...prev, ...files.filter(f => !seen.has(`${f.name}-${f.size}`))];
    });
  }, []);

  // ── Seed loader: when opened from history dashboard, hydrate the success view
  const seedLoadedRef = useRef(false);
  useEffect(() => {
    if (!seed || seedLoadedRef.current) return;
    seedLoadedRef.current = true;
    if (seed.client) {
      setSelectedClient({
        id: seed.client.id,
        name: seed.client.name,
        client_ref: seed.client.client_ref,
        business_type: null,
        vat_number: seed.client.vat_number ?? null,
        status: 'active',
      });
    }
    setResults(seed.transactions ?? []);
    setAppState('success');
  }, [seed]);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/bank-to-csv');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/bank-to-csv') return;
      const p = consumePendingClient('/bank-to-csv');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const handleClientSelect = useCallback((c: SelectedClient | null) => {
    setSelectedClient(c);
  }, []);

  // Per-document scan state
  const [scanResults, setScanResults] = useState<DocumentScanResult[]>([]);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const fileRefs = useRef<Map<string, File>>(new Map());

  const scanFiles = useCallback(async (
    filesToScan: File[],
    clientId: string | null,
    clientCode: string | null,
  ): Promise<DocumentScanResult[]> => {
    const ctx: BankScanContext = {
      accountName: accountName.trim() || null,
      accountNumber: accountNumber.trim() || null,
      yearEnd: yearEnd || null,
    };
    const docResults: DocumentScanResult[] = [];

    for (let i = 0; i < filesToScan.length; i++) {
      const file = filesToScan[i];
      setScanProgress({ current: i + 1, total: filesToScan.length, fileName: file.name });

      try {
        // Large PDFs are auto-split into page-chunks that each fit under the
        // upload limit; the rows are merged back under the original filename, so
        // the user still sees one document (and gets one CSV).
        const chunks = await splitPdfIfNeeded(file);
        const merged: BankCsvTransaction[] = [];
        const partErrors: string[] = [];
        let firstErrorCode: string | undefined;
        let truncated = false;

        for (let c = 0; c < chunks.length; c++) {
          if (chunks.length > 1) {
            setScanProgress({ current: i + 1, total: filesToScan.length, fileName: `${file.name} — part ${c + 1} of ${chunks.length}` });
          }
          const r = await scanOneBankFile(chunks[c], clientId, clientCode, ctx);
          if (r.ok) {
            merged.push(...r.transactions);
            if (r.truncated) truncated = true;
          } else {
            partErrors.push(r.errorMessage || 'Processing failed');
            firstErrorCode = firstErrorCode ?? r.errorCode;
          }
        }

        if (truncated) setWasTruncated(true);
        const allFailed = partErrors.length === chunks.length;
        docResults.push({
          fileName: file.name,
          status: allFailed ? 'failed' : 'success',
          validTransactions: merged,
          flaggedEntries: [],
          errorMessage: allFailed
            ? partErrors[0]
            : partErrors.length
              ? `${partErrors.length} of ${chunks.length} parts couldn't be read — the rest were processed.`
              : undefined,
          errorCode: allFailed ? firstErrorCode : undefined,
        });
      } catch (err) {
        docResults.push({
          fileName: file.name,
          status: 'failed',
          validTransactions: [],
          flaggedEntries: [],
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      setScanResults(prev => {
        const map = new Map(prev.map(r => [r.fileName, r]));
        map.set(docResults[docResults.length - 1].fileName, docResults[docResults.length - 1]);
        return Array.from(map.values());
      });
    }

    return docResults;
  }, [accountName, accountNumber, yearEnd]);

  const applyAndProceed = useCallback((allScanResults: DocumentScanResult[]) => {
    const successfulTxs = allScanResults
      .filter(r => r.status === 'success')
      .flatMap(r => r.validTransactions as BankCsvTransaction[])
      .filter(Boolean);

    setResults(successfulTxs);
    setScanProgress(null);
    setAppState('success');
  }, []);

  const handleProcess = useCallback(async () => {
    if (documentFiles.length === 0) return;
    setAppState('loading');
    setError(null);
    setProgress(0);
    setWasTruncated(false);
    setScanResults([]);
    setScanProgress(null);

    fileRefs.current = new Map(documentFiles.map(f => [f.name, f]));

    const est = (5 + documentFiles.length * 4) * 1000;
    let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(90, (elapsed / est) * 100)); }, 100);

    const allResults = await scanFiles(
      documentFiles,
      selectedClient?.id ?? null,
      selectedClient?.client_ref ?? null,
    );

    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
    setScanProgress(null);

    if (documentFiles.length === 1) {
      if (allResults[0].status === 'failed') {
        setError(allResults[0].errorMessage || 'Processing failed. Please try again.');
        setAppState('error');
      } else {
        applyAndProceed(allResults);
      }
      return;
    }

    setAppState('scan_results');
  }, [documentFiles, selectedClient, scanFiles, applyAndProceed]);

  const handleRescan = useCallback(async () => {
    const failedResults = scanResults.filter(r => r.status === 'failed');
    if (failedResults.length === 0) return;
    const failedFiles = failedResults.map(r => fileRefs.current.get(r.fileName)).filter(Boolean) as File[];
    if (failedFiles.length === 0) return;

    setIsRescanning(true);
    setScanProgress(null);

    const newResults = await scanFiles(
      failedFiles,
      selectedClient?.id ?? null,
      selectedClient?.client_ref ?? null,
    );

    setScanResults(prev => {
      const newMap = new Map(newResults.map(r => [r.fileName, r]));
      return prev.map(r => newMap.get(r.fileName) ?? r);
    });

    setScanProgress(null);
    setIsRescanning(false);
  }, [scanResults, selectedClient, scanFiles]);

  const handleDismissAndContinue = useCallback(() => {
    applyAndProceed(scanResults);
  }, [scanResults, applyAndProceed]);

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
        steps={['Reading bank statement', 'Detecting transactions', 'Categorising entries', 'Building export']}
      />
    );
  }

  if (appState === 'error') return (
    <ToolLayout title="Bank to CSV" icon={ArrowLeftRight} iconColor="#0891B2" wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  if (appState === 'scan_results') return (
    <ToolLayout title="Bank to CSV" icon={ArrowLeftRight} iconColor="#0891B2" wide>
      <BackToHistory onBack={onBack} />
      <ScanResultsView
        results={scanResults}
        fileRefs={fileRefs.current}
        isRescanning={isRescanning}
        onRescan={handleRescan}
        onDismissAndContinue={handleDismissAndContinue}
      />
    </ToolLayout>
  );

  const allSupported = documentFiles.length > 0 && documentFiles.every(isSupportedBankFile);
  const idleStep = selectedClient ? 2 : 1;

  return (
    <ToolLayout
      title="Bank to CSV"
      description="Extract transactions from bank statements and produce a clean CSV file."
      icon={ArrowLeftRight}
      iconColor="#0891B2"
      wide
    >
      <BackToHistory onBack={onBack} />

      {appState === 'idle' && (
        <div className="space-y-5">
          {/* Stepper */}
          <div className="bg-white/[0.78] backdrop-blur-md rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper current={idleStep} />
          </div>

          {/* Top row — Client · Upload · Readiness */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Client */}
            <div className="lg:col-span-3 relative z-30 bg-white/[0.78] backdrop-blur-md rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">1. Client</p>
              {selectedClient ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                      <Building2 size={20} className="text-[var(--accent)]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{selectedClient.name}</p>
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 flex-wrap">
                        {selectedClient.client_ref && <span className="font-mono">{selectedClient.client_ref}</span>}
                        {selectedClient.client_ref && selectedClient.vat_number && <span>·</span>}
                        {selectedClient.vat_number
                          ? <span className="text-emerald-600 font-medium">VAT Registered</span>
                          : <span>Not VAT registered</span>}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={() => handleClientSelect(null)} className="btn-secondary text-xs py-1.5 px-3">Change client</button>
                </div>
              ) : (
                <ClientSelector value={selectedClient} onSelect={handleClientSelect} />
              )}

              <div className="space-y-3 pt-1">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mb-1"><CalendarDays size={12} /> Year end <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
                  <input type="date" value={yearEnd} onChange={e => setYearEnd(e.target.value)} className="input-base w-full text-sm" />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mb-1"><CreditCard size={12} /> Account <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
                  <input type="text" value={accountName} onChange={e => setAccountName(e.target.value)} placeholder="e.g. Business Current Account" className="input-base w-full text-sm" />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mb-1"><Hash size={12} /> Account number <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
                  <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="e.g. 12345678" className="input-base w-full text-sm font-mono" />
                </div>
              </div>
            </div>

            {/* Upload */}
            <div className="lg:col-span-6 bg-white/[0.78] backdrop-blur-md rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">2. Upload Bank Statement</p>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)] bg-white/[0.5] hover:border-[var(--accent)]'}`}
              >
                <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-3">
                  <UploadCloud size={22} className="text-[var(--accent)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Drag and drop your bank statement here</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Upload PDF or image file (PNG, JPG)</p>
                <span className="btn-primary mt-4 inline-flex pointer-events-none">Browse files</span>
              </div>
              <input ref={fileInputRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
                onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

              {documentFiles.length > 0 && (
                <div className="space-y-1.5">
                  {documentFiles.map((f, i) => {
                    const ok = isSupportedBankFile(f);
                    return (
                      <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                        <FileText size={15} className={ok ? 'text-rose-500 shrink-0' : 'text-[var(--text-muted)] shrink-0'} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)] uppercase">{(f.type.split('/')[1] || f.name.split('.').pop() || 'file')} · {(f.size / 1048576).toFixed(1)} MB</p>
                        </div>
                        {ok
                          ? <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0"><Check size={12} className="text-white" /></span>
                          : <Tooltip label="Unsupported format"><span className="text-[10px] font-semibold text-amber-600">?</span></Tooltip>}
                        <button type="button" onClick={() => setDocumentFiles(prev => prev.filter((_, j) => j !== i))} aria-label="Remove file" className="text-[var(--text-muted)] hover:text-red-500 shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:opacity-80 pt-1">
                    <UploadCloud size={13} /> Add another file
                  </button>
                </div>
              )}
            </div>

            {/* AI Readiness */}
            <div className="lg:col-span-3 bg-white/[0.78] backdrop-blur-md rounded-xl p-5">
              <p className="text-sm font-semibold text-[var(--text-primary)]">AI Readiness</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">We&apos;ll let you know when your file is ready to extract.</p>

              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2.5">Required</p>
              <div className="space-y-2.5">
                {[
                  { label: 'File uploaded', ok: documentFiles.length > 0 },
                  { label: 'File format recognised', ok: allSupported },
                  { label: 'Ready to analyse', ok: allSupported },
                ].map(r => (
                  <div key={r.label} className="flex items-center gap-2.5">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${r.ok ? 'bg-emerald-500 text-white' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                      {r.ok ? <Check size={12} /> : <Loader2 size={12} className="animate-spin opacity-50" />}
                    </span>
                    <span className={`text-xs ${r.ok ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{r.label}</span>
                  </div>
                ))}
              </div>

              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mt-5 mb-2.5">Supported formats</p>
              <div className="space-y-2.5">
                {SUPPORTED_FORMATS.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2.5 text-xs text-[var(--text-secondary)]">
                    <Icon size={14} className="text-[var(--text-muted)] shrink-0" /> {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom row — what we extract + security */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 bg-white/[0.78] backdrop-blur-md rounded-xl p-5">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">What we&apos;ll extract automatically</p>
              <div className="flex flex-wrap gap-2">
                {EXTRACTED_FIELDS.map(field => (
                  <span key={field} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-nav-hover)] text-xs font-medium text-[var(--text-secondary)]">
                    <Check size={11} className="text-[var(--accent)]" /> {field}
                  </span>
                ))}
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-3">We use AI to detect and extract all key data points with high accuracy — then you review every row before exporting.</p>
            </div>
            <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-5 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <ShieldCheck size={18} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Private &amp; secure</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Documents are sent over an encrypted connection and are never used to train AI models.</p>
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><ShieldCheck size={13} /> Sent over an encrypted connection and never used to train AI models.</p>
            <button onClick={handleProcess} disabled={documentFiles.length === 0} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
              Extract Transactions <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {appState === 'success' && (
        <div className="space-y-4">
          <div className="bg-white/[0.78] backdrop-blur-md rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper current={4} onStep={() => setAppState('idle')} />
          </div>
          {wasTruncated && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-300">
              <span className="shrink-0 font-bold">⚠</span>
              <div>
                <p className="font-medium">Statement too large — partial results only</p>
                <p className="mt-0.5 text-amber-700 dark:text-amber-400">Only the first portion of transactions could be extracted. For full results, split the statement into smaller files (e.g. one month at a time) and process each separately.</p>
              </div>
            </div>
          )}
          <div className="flex justify-between items-center">
            <p className="text-sm text-[var(--text-muted)]">{results.length} transactions extracted</p>
            <div className="flex items-center gap-2">
              <Tooltip label="Coming soon — send these transactions straight to the Bookkeeping tool for this client to complete the bank reconciliation.">
                <button
                  type="button"
                  disabled
                  aria-label="Upload to Bookkeeping (coming soon)"
                  className="btn-secondary opacity-50 cursor-not-allowed inline-flex items-center gap-2"
                >
                  <BookCopy size={14} />
                  Upload to Bookkeeping
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">Soon</span>
                </button>
              </Tooltip>
              <button onClick={() => setSaveModalOpen(true)} className="btn-primary">
                <Download size={14} />
                Save & Export CSV
              </button>
              <button onClick={() => {
                setDocumentFiles([]); setResults([]); setScanResults([]); setWasTruncated(false);
                setAccountName(''); setAccountNumber(''); setYearEnd('');
                setAppState('idle');
              }} className="btn-secondary">New Analysis</button>
            </div>
          </div>
          <SaveBankCsvModal
            isOpen={saveModalOpen}
            results={results}
            documentFiles={documentFiles}
            initialClient={selectedClient}
            onClose={() => setSaveModalOpen(false)}
          />
          <div className="bg-white/[0.78] backdrop-blur-md rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)]">
                <tr>{['Date', 'Description', 'Money In', 'Money Out', 'Balance'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {results.map((tx, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-nav-hover)] transition-colors">
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{tx.Date}</td>
                    <td className="px-4 py-3 text-[var(--text-primary)]">{tx.Description}</td>
                    <td className="px-4 py-3 text-green-600 dark:text-green-400">{tx['Money In'] != null ? `£${Number(tx['Money In']).toFixed(2)}` : ''}</td>
                    <td className="px-4 py-3 text-red-600 dark:text-red-400">{tx['Money Out'] != null ? `£${Number(tx['Money Out']).toFixed(2)}` : ''}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{tx.Balance != null ? `£${Number(tx.Balance).toFixed(2)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
