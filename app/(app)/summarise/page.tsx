'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import SaveSummariseModal from '@/components/features/summarise/SaveSummariseModal';
import SummariseHistory, { type SummariseSeed } from '@/components/features/summarise/SummariseHistory';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import Tooltip from '@/components/ui/Tooltip';
import { consumePendingClient, peekPendingClient } from '@/lib/pendingClient';
import ToolLayout from '@/components/ui/ToolLayout';
import {
  FileText, Download, Layers, ChevronDown, ChevronRight, ArrowLeft, ArrowRight, Sparkles,
  UploadCloud, Check, Building2, CalendarDays, Trash2, ShieldCheck, Users, Tag,
  Files, FileStack, ArrowUpRight,
} from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import type { OutOfRangeDocument, DocumentScanResult } from '@/types';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';
export type GroupBy = 'none' | 'entity' | 'category';

// ── Setup wizard ──────────────────────────────────────────────────────────
const WIZARD_STEPS = [
  { n: 1, label: 'Select Client' },
  { n: 2, label: 'Upload Documents' },
  { n: 3, label: 'Summary Results' },
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

const SUMMARISE_OUTPUTS = [
  { icon: Users, label: 'Totals by supplier' },
  { icon: Tag, label: 'Totals by entry type' },
  { icon: FileText, label: 'VAT totals' },
  { icon: Files, label: 'Document count' },
];

function isSupportedDoc(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name);
}

// ── Grouping helpers ──────────────────────────────────────────────────────────

function groupResults(results: OutOfRangeDocument[], by: GroupBy): [string, OutOfRangeDocument[]][] {
  if (by === 'none') return [['', results]];
  const map = new Map<string, OutOfRangeDocument[]>();
  for (const r of results) {
    const key = (by === 'entity' ? r.entityName : r.detailedCategory) || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function sumGroup(rows: OutOfRangeDocument[]) {
  return rows.reduce(
    (acc, r) => ({
      net: acc.net + (r.totalNetAmount ?? 0),
      vat: acc.vat + (r.totalVatAmount ?? 0),
      gross: acc.gross + (r.totalGrossAmount ?? 0),
    }),
    { net: 0, vat: 0, gross: 0 },
  );
}

function fmt(n: number) {
  return `£${n.toFixed(2)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Page wrapper: history dashboard or tool ─────────────────────────────────
export default function SummarisePage() {
  // Skip the history view when arriving via a Quick Launch pill (pending client present).
  const [view, setView] = useState<'history' | 'tool'>(
    () => peekPendingClient('/summarise') ? 'tool' : 'history',
  );
  const [seed, setSeed] = useState<SummariseSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  // Subsequent pill clicks while the tab is already open
  useEffect(() => {
    function onPending(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/summarise') return;
      setSeed(null);
      setView('tool');
    }
    window.addEventListener('smith:pending-client', onPending);
    return () => window.removeEventListener('smith:pending-client', onPending);
  }, []);

  return view === 'history' ? (
    <SummariseHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <SummariseTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
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

function SummariseTool({ seed, onBack }: { seed: SummariseSeed | null; onBack: () => void }) {
  const router = useRouter();
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/summarise', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [results, setResults] = useState<OutOfRangeDocument[]>([]);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setDocumentFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}-${f.size}`));
      return [...prev, ...files.filter(f => !seen.has(`${f.name}-${f.size}`))];
    });
  }, []);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [groupByOpen, setGroupByOpen] = useState(false);
  const groupByRef = useRef<HTMLDivElement>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Close group-by dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (groupByRef.current && !groupByRef.current.contains(e.target as Node)) setGroupByOpen(false);
    }
    if (groupByOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [groupByOpen]);

  // ── Auto client-context: pulls past Summarise runs for this client and
  // feeds them to the AI for entity/category consistency.
  type PastDoc = { detectedDate: string; entityName: string; detailedCategory: string; totalGrossAmount: number };
  const [pastDocs, setPastDocs]              = useState<PastDoc[]>([]);
  const [pastCtxAnalyses, setPastCtxAnalyses]= useState(0);
  const [pastCtxLoading, setPastCtxLoading]  = useState(false);
  const [usePastContext, setUsePastContext]  = useState(true);

  useEffect(() => {
    if (!selectedClient?.id) {
      setPastDocs([]); setPastCtxAnalyses(0);
      return;
    }
    let cancelled = false;
    setPastCtxLoading(true);
    fetch(`/api/summarise/client-context?clientId=${selectedClient.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setPastDocs(d.pastDocuments ?? []);
        setPastCtxAnalyses(d.analysisCount ?? 0);
      })
      .catch(() => {/* silent */})
      .finally(() => { if (!cancelled) setPastCtxLoading(false); });
    return () => { cancelled = true; };
  }, [selectedClient?.id]);

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
    setResults(seed.documents ?? []);
    setGroupBy(seed.groupBy ?? 'none');
    setDateFrom(seed.dateFrom ?? '');
    setDateTo(seed.dateTo ?? '');
    setAppState('success');
  }, [seed]);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/summarise');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/summarise') return;
      const p = consumePendingClient('/summarise');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

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
  ): Promise<DocumentScanResult[]> => {
    const docResults: DocumentScanResult[] = [];
    const effectivePastDocs = (usePastContext && pastDocs.length > 0) ? pastDocs : null;

    for (let i = 0; i < filesToScan.length; i++) {
      const file = filesToScan[i];
      setScanProgress({ current: i + 1, total: filesToScan.length, fileName: file.name });

      try {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/summarise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [{ name: file.name, mimeType: file.type || 'application/pdf', base64 }],
            clientId,
            pastDocuments: effectivePastDocs,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          docResults.push({
            fileName: file.name,
            status: 'failed',
            validTransactions: [],
            flaggedEntries: [],
            errorMessage: err.error || 'Processing failed',
            errorCode: err.code,
          });
        } else {
          const data = await res.json();
          const docs: OutOfRangeDocument[] = (data.documents || []).filter(Boolean);
          docResults.push({
            fileName: file.name,
            status: 'success',
            validTransactions: docs,
            flaggedEntries: [],
          });
        }
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
  }, [usePastContext, pastDocs]);

  const applyAndProceed = useCallback((allScanResults: DocumentScanResult[]) => {
    const docs = allScanResults
      .filter(r => r.status === 'success')
      .flatMap(r => r.validTransactions as OutOfRangeDocument[])
      .filter(Boolean);

    setResults(docs);
    setScanProgress(null);
    setAppState('success');
  }, []);

  const handleProcess = useCallback(async () => {
    if (documentFiles.length === 0) return;
    setAppState('loading');
    setError(null);
    setProgress(0);
    setScanResults([]);
    setScanProgress(null);

    fileRefs.current = new Map(documentFiles.map(f => [f.name, f]));

    const est = (5 + documentFiles.length * 4) * 1000;
    let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(90, (elapsed / est) * 100)); }, 100);

    const allResults = await scanFiles(documentFiles, selectedClient?.id ?? null);

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

    const newResults = await scanFiles(failedFiles, selectedClient?.id ?? null);

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
        steps={['Reading documents', 'Identifying key details', 'Generating summaries', 'Compiling report']}
      />
    );
  }

  if (appState === 'error') return (
    <ToolLayout title="Summarise Documents" icon={FileText} iconColor="#475569" wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  if (appState === 'scan_results') return (
    <ToolLayout title="Summarise Documents" icon={FileText} iconColor="#475569" wide>
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

  // ── Grouped table render ──────────────────────────────────────────────────

  const groups = groupResults(results, groupBy);
  const grandTotals = sumGroup(results);
  const allSupported = documentFiles.length > 0 && documentFiles.every(isSupportedDoc);
  const idleStep = selectedClient ? 2 : 1;

  // Totals tables for the results step (top suppliers / entry types, with a "more" tail)
  const supplierTotals = groupResults(results, 'entity').map(([k, rows]) => ({ key: k, ...sumGroup(rows), count: rows.length }))
    .sort((a, b) => b.gross - a.gross);
  const entryTotals = groupResults(results, 'category').map(([k, rows]) => ({ key: k, ...sumGroup(rows), count: rows.length }))
    .sort((a, b) => b.gross - a.gross);

  const GROUP_BY_LABELS: Record<GroupBy, string> = {
    none: 'None',
    entity: 'Entity',
    category: 'Category',
  };

  // Shared past-context pill (steps 1 & 2)
  const PastContextPill = () => (
    selectedClient && (pastCtxLoading || pastDocs.length > 0) ? (
      <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs ${
        usePastContext
          ? 'bg-[var(--accent-light)] border-[var(--accent)]/30 text-[var(--accent)]'
          : 'bg-[var(--bg-nav-hover)] border-[var(--border)] text-[var(--text-muted)]'
      }`}>
        <Sparkles size={13} className="shrink-0" />
        <div className="flex-1 leading-snug">
          {pastCtxLoading ? (
            <span>Looking for past summaries for this client…</span>
          ) : usePastContext ? (
            <>
              Using <span className="font-semibold">{pastDocs.length}</span> past document entries from
              {' '}<span className="font-semibold">{pastCtxAnalyses}</span> previous {pastCtxAnalyses === 1 ? 'summary' : 'summaries'} to keep entity names and categories consistent.
            </>
          ) : (
            <>Past-summary learning is off — entity / category consistency may be lower.</>
          )}
        </div>
        <Tooltip label={usePastContext ? 'Turn off learning from past summaries' : 'Turn learning back on'}>
          <button
            onClick={() => setUsePastContext(v => !v)}
            aria-label="Toggle past-summary learning"
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0 ${usePastContext ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${usePastContext ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </Tooltip>
      </div>
    ) : null
  );

  return (
    <ToolLayout title="Summarise Documents" description="Get a quick summary of your invoices, receipts or financial documents." icon={FileText} iconColor="#475569" wide>
      <BackToHistory onBack={onBack} />
      {appState === 'idle' && (
        <div className="space-y-5">
          {/* Stepper */}
          <div className="glass-solid rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper current={idleStep} />
          </div>

          <PastContextPill />

          {/* Top row — Client · Upload · What we'll summarise */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Client */}
            <div className="lg:col-span-3 relative z-30 glass-solid rounded-xl p-5 space-y-4">
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
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]"><CalendarDays size={12} /> Date range <span className="text-[var(--text-muted)] font-normal">(optional)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base w-full text-sm" />
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-snug">Recorded against the summary so you can note which period it covers.</p>
              </div>
            </div>

            {/* Upload */}
            <div className="lg:col-span-6 glass-solid rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">2. Upload Documents</p>
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
                <p className="text-sm font-semibold text-[var(--text-primary)]">Drag and drop your documents here</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Upload invoices, receipts or any financial documents (PDF, PNG, JPG)</p>
                <span className="btn-primary mt-4 inline-flex pointer-events-none">Browse files</span>
              </div>
              <input ref={fileInputRef} type="file" multiple accept="application/pdf,image/*" className="hidden"
                onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

              {documentFiles.length > 0 && (
                <div className="space-y-1.5">
                  {documentFiles.map((f, i) => {
                    const ok = isSupportedDoc(f);
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

            {/* What we'll summarise */}
            <div className="lg:col-span-3 glass-solid rounded-xl p-5">
              <p className="text-sm font-semibold text-[var(--text-primary)]">What we&apos;ll summarise</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">We&apos;ll analyse your documents and give you a quick summary.</p>
              <div className="space-y-3">
                {SUMMARISE_OUTPUTS.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0"><Check size={12} className="text-white" /></span>
                    <span className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5"><Icon size={13} className="text-[var(--text-muted)]" /> {label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-start gap-2.5">
                <ShieldCheck size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-[var(--text-muted)] leading-snug">Documents are sent over an encrypted connection and are never used to train AI models.</p>
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><ShieldCheck size={13} /> Sent over an encrypted connection and never used to train AI models.</p>
            <button onClick={handleProcess} disabled={documentFiles.length === 0 || !allSupported} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
              <FileText size={15} /> Summarise Documents <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {appState === 'success' && (
        <div className="space-y-4">
          {/* Stepper */}
          <div className="glass-solid rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper current={3} onStep={() => setAppState('idle')} />
          </div>

          {/* Summary Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: Files,    label: 'Documents',     value: String(results.length),     tint: 'text-[var(--accent)] bg-[var(--accent-light)]' },
              { icon: FileStack, label: 'Total (ex VAT)', value: fmt(grandTotals.net),      tint: 'text-slate-600 bg-slate-100' },
              { icon: FileText, label: 'Total VAT',      value: fmt(grandTotals.vat),       tint: 'text-amber-600 bg-amber-50' },
              { icon: Download, label: 'Total (inc VAT)', value: fmt(grandTotals.gross),    tint: 'text-emerald-600 bg-emerald-50' },
            ].map(c => (
              <div key={c.label} className="glass-solid rounded-xl p-5 flex items-center gap-3.5">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${c.tint}`}>
                  <c.icon size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums truncate">{c.value}</p>
                  <p className="text-xs text-[var(--text-muted)]">{c.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Totals by supplier / entry type */}
          {results.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {([
                { title: 'Totals by Supplier', head: 'Supplier', icon: Users, rows: supplierTotals },
                { title: 'Totals by Entry Type', head: 'Entry Type', icon: Tag, rows: entryTotals },
              ] as const).map(({ title, head, icon: Icon, rows }) => {
                const top = rows.slice(0, 6);
                const moreCount = rows.length - top.length;
                return (
                  <div key={title} className="glass-solid rounded-xl p-5">
                    <p className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3"><Icon size={15} className="text-[var(--text-muted)]" /> {title}</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                          <th className="text-left pb-2 font-semibold">{head}</th>
                          <th className="text-right pb-2 font-semibold">Net (ex VAT)</th>
                          <th className="text-right pb-2 font-semibold">VAT</th>
                          <th className="text-right pb-2 font-semibold">Total (inc VAT)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {top.map(r => (
                          <tr key={r.key}>
                            <td className="py-2 pr-2 text-[var(--text-secondary)] truncate max-w-[160px]">{r.key}</td>
                            <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">{fmt(r.net)}</td>
                            <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">{fmt(r.vat)}</td>
                            <td className="py-2 text-right tabular-nums font-medium text-[var(--text-primary)]">{fmt(r.gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-[var(--border)]">
                          <td className="pt-2 text-xs font-bold text-[var(--text-primary)]">Total</td>
                          <td className="pt-2 text-right tabular-nums font-bold text-[var(--text-primary)]">{fmt(grandTotals.net)}</td>
                          <td className="pt-2 text-right tabular-nums font-bold text-[var(--text-primary)]">{fmt(grandTotals.vat)}</td>
                          <td className="pt-2 text-right tabular-nums font-bold text-[var(--text-primary)]">{fmt(grandTotals.gross)}</td>
                        </tr>
                      </tfoot>
                    </table>
                    {moreCount > 0 && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-2">+{moreCount} more {moreCount === 1 ? 'row' : 'rows'} — see the full breakdown below.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-sm text-[var(--text-muted)]">{results.length} documents summarised — full breakdown</p>
            <div className="flex items-center gap-2">

              {/* Group By dropdown */}
              <div ref={groupByRef} className="relative">
                <button
                  onClick={() => setGroupByOpen(v => !v)}
                  className={`btn-secondary flex items-center gap-1.5 ${groupBy !== 'none' ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`}
                >
                  <Layers size={14} />
                  Group By{groupBy !== 'none' && <span className="font-semibold">: {GROUP_BY_LABELS[groupBy]}</span>}
                  <ChevronDown size={12} className={`transition-transform ${groupByOpen ? 'rotate-180' : ''}`} />
                </button>
                {groupByOpen && (
                  <div className="absolute right-0 top-full mt-1 z-20 glass-solid rounded-xl border border-[var(--border)] shadow-dropdown overflow-hidden animate-slide-up w-40">
                    {(['none', 'entity', 'category'] as GroupBy[]).map(opt => (
                      <button
                        key={opt}
                        onClick={() => { setGroupBy(opt); setGroupByOpen(false); setExpandedGroups(new Set()); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                          groupBy === opt
                            ? 'bg-[var(--accent-light)] text-[var(--accent)] font-medium'
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
                        }`}
                      >
                        {GROUP_BY_LABELS[opt]}
                        {groupBy === opt && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => setSaveModalOpen(true)} className="btn-primary">
                <Download size={14} />
                Save & Export
              </button>
              <button onClick={() => {
                setDocumentFiles([]); setResults([]); setScanResults([]); setGroupBy('none'); setExpandedGroups(new Set());
                setAppState('idle');
              }} className="btn-secondary">New Analysis</button>
            </div>
          </div>

          <SaveSummariseModal
            isOpen={saveModalOpen}
            results={results}
            documentFiles={documentFiles}
            initialClient={selectedClient}
            groupBy={groupBy}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onClose={() => setSaveModalOpen(false)}
          />

          {/* Results table */}
          <div className="glass-solid rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)]">
                <tr>
                  {groupBy === 'none' && ['File', 'Date', 'Entity', 'Category', 'Net', 'VAT', 'Gross'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                  ))}
                  {groupBy === 'entity' && ['File', 'Date', 'Category', 'Net', 'VAT', 'Gross'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                  ))}
                  {groupBy === 'category' && ['File', 'Date', 'Entity', 'Net', 'VAT', 'Gross'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {groupBy === 'none' ? (
                  results.map((r, i) => (
                    <tr key={i} className="hover:bg-[var(--bg-nav-hover)] transition-colors">
                      <td className="px-4 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{r.fileName}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.detectedDate}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.entityName}</td>
                      <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.detailedCategory}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{fmt(r.totalNetAmount ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{fmt(r.totalVatAmount ?? 0)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">{fmt(r.totalGrossAmount ?? 0)}</td>
                    </tr>
                  ))
                ) : (
                  groups.map(([groupKey, rows]) => {
                    const sub = sumGroup(rows);
                    const isExpanded = expandedGroups.has(groupKey);
                    const toggle = () => setExpandedGroups(prev => {
                      const next = new Set(prev);
                      isExpanded ? next.delete(groupKey) : next.add(groupKey);
                      return next;
                    });
                    return (
                      <>
                        {/* Collapsible group header — shows totals, click to expand/collapse */}
                        <tr
                          key={`hdr-${groupKey}`}
                          onClick={toggle}
                          className="bg-[var(--bg-nav-hover)] cursor-pointer hover:brightness-95 select-none transition-all"
                        >
                          <td className="px-4 py-2.5" colSpan={3}>
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--text-muted)] shrink-0 transition-transform duration-150" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                <ChevronRight size={14} />
                              </span>
                              <span className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wide">{groupKey}</span>
                              <span className="text-[10px] font-medium text-[var(--text-muted)] bg-[var(--border)] px-1.5 py-0.5 rounded-full">
                                {rows.length} doc{rows.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right text-sm font-semibold text-[var(--text-primary)]">{fmt(sub.net)}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-semibold text-[var(--text-primary)]">{fmt(sub.vat)}</td>
                          <td className="px-4 py-2.5 text-right text-sm font-bold text-[var(--text-primary)]">{fmt(sub.gross)}</td>
                        </tr>
                        {/* Detail rows — only shown when expanded */}
                        {isExpanded && rows.map((r, i) => (
                          <tr key={`${groupKey}-${i}`} className="hover:bg-[var(--bg-nav-hover)] transition-colors border-t border-[var(--border)] border-opacity-50">
                            <td className="px-4 py-2.5 pl-9 text-[var(--text-muted)] truncate max-w-[120px]">{r.fileName}</td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.detectedDate}</td>
                            {groupBy === 'entity'
                              ? <td className="px-4 py-2.5 text-[var(--text-muted)]">{r.detailedCategory}</td>
                              : <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.entityName}</td>
                            }
                            <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{fmt(r.totalNetAmount ?? 0)}</td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">{fmt(r.totalVatAmount ?? 0)}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">{fmt(r.totalGrossAmount ?? 0)}</td>
                          </tr>
                        ))}
                      </>
                    );
                  })
                )}

                {/* Grand total row — only when grouped */}
                {groupBy !== 'none' && (
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--accent-light)]">
                    <td className="px-4 py-2.5 text-xs font-bold text-[var(--accent)] uppercase tracking-wide" colSpan={3}>
                      Grand Total ({results.length} documents)
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-[var(--accent)]">{fmt(grandTotals.net)}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[var(--accent)]">{fmt(grandTotals.vat)}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-[var(--accent)]">{fmt(grandTotals.gross)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Cross-sell — Capture for full transaction extraction */}
          <div className="glass-solid rounded-xl p-5 flex items-center gap-4 flex-wrap">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
              <Layers size={20} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">Ready to go further?</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Use Capture to extract full transactions from these documents and export them to your accounting software.</p>
            </div>
            <button onClick={() => router.push('/full-analysis')} className="btn-secondary inline-flex items-center gap-1.5 shrink-0">
              Go to Capture <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
