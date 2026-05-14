'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import FileUpload from '@/components/ui/FileUpload';
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
import { FileText, Download, Layers, ChevronDown, ChevronRight, ArrowLeft, Sparkles } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import type { OutOfRangeDocument, DocumentScanResult } from '@/types';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';
export type GroupBy = 'none' | 'entity' | 'category';

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
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/summarise', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [results, setResults] = useState<OutOfRangeDocument[]>([]);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
      setClientName(seed.client.name);
      if (seed.client.client_ref) setClientCode(seed.client.client_ref);
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
    if (c) {
      if (c.name) setClientName(c.name);
      if (c.client_ref) setClientCode(c.client_ref);
    }
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
    <ToolLayout title="Summarise Documents" icon={FileText} iconColor="#475569">
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  if (appState === 'scan_results') return (
    <ToolLayout title="Summarise Documents" icon={FileText} iconColor="#475569">
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

  const GROUP_BY_LABELS: Record<GroupBy, string> = {
    none: 'None',
    entity: 'Entity',
    category: 'Category',
  };

  return (
    <ToolLayout title="Summarise Documents" description="Summarise out-of-date-range documents for file note purposes." icon={FileText} iconColor="#475569">
      <BackToHistory onBack={onBack} />
      {appState === 'idle' && (
        <div className="space-y-5">
          {/* Auto-context pill — visible when this client has past summaries */}
          {selectedClient && (pastCtxLoading || pastDocs.length > 0) && (
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
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-solid rounded-xl p-5 space-y-4">
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Client</p>
                <div className="flex items-center gap-2 mb-3">
                  <ClientSelector value={selectedClient} onSelect={handleClientSelect} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Client Name</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      placeholder="e.g. John Smith"
                      className="input-base w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Client Code</label>
                    <input
                      type="text"
                      value={clientCode}
                      onChange={e => setClientCode(e.target.value.toUpperCase())}
                      placeholder="e.g. JS001"
                      className="input-base w-full text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Date Range (optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base w-full" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base w-full" />
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-2">Documents outside this range will be shown separately.</p>
              </div>
            </div>
            <FileUpload title="Documents to Summarise" onFilesChange={setDocumentFiles} multiple accept="application/pdf,image/*" helpText="Upload invoices, receipts, or any financial documents." existingFiles={documentFiles} />
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={documentFiles.length === 0} className="btn-primary">
              <FileText size={15} />
              Summarise Documents
            </button>
          </div>
        </div>
      )}

      {appState === 'success' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-sm text-[var(--text-muted)]">{results.length} documents summarised</p>
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
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Analysis</button>
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
        </div>
      )}
    </ToolLayout>
  );
}
