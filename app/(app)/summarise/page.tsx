'use client';
import { useState, useRef, useCallback } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import SaveSummariseModal from '@/components/features/summarise/SaveSummariseModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import { FileText, Download } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import type { OutOfRangeDocument, DocumentScanResult } from '@/types';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';

export default function SummarisePage() {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/summarise', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [results, setResults] = useState<OutOfRangeDocument[]>([]);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

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
  }, []);

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
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  if (appState === 'scan_results') return (
    <ToolLayout title="Summarise Documents" icon={FileText} iconColor="#475569">
      <ScanResultsView
        results={scanResults}
        fileRefs={fileRefs.current}
        isRescanning={isRescanning}
        onRescan={handleRescan}
        onDismissAndContinue={handleDismissAndContinue}
      />
    </ToolLayout>
  );

  return (
    <ToolLayout title="Summarise Documents" description="Summarise out-of-date-range documents for file note purposes." icon={FileText} iconColor="#475569">
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-solid rounded-xl p-5">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[var(--text-secondary)]">Client</span>
                <ClientSelector value={selectedClient} onSelect={setSelectedClient} />
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
          <div className="flex justify-between items-center flex-wrap gap-3">
            <p className="text-sm text-[var(--text-muted)]">{results.length} documents summarised</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setSaveModalOpen(true)} className="btn-primary">
                <Download size={14} />
                Save & Export CSV
              </button>
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Analysis</button>
            </div>
          </div>
          <SaveSummariseModal
            isOpen={saveModalOpen}
            results={results}
            documentFiles={documentFiles}
            initialClient={selectedClient}
            onClose={() => setSaveModalOpen(false)}
          />
          <div className="glass-solid rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)]"><tr>{['File','Date','Entity','Category','Net','VAT','Gross'].map(h=><th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[var(--border)]">
                {results.map((r, i) => <tr key={i} className="hover:bg-[var(--bg-nav-hover)] transition-colors"><td className="px-4 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{r.fileName}</td><td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.detectedDate}</td><td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.entityName}</td><td className="px-4 py-2.5 text-[var(--text-muted)]">{r.detailedCategory}</td><td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">£{(r.totalNetAmount||0).toFixed(2)}</td><td className="px-4 py-2.5 text-right text-[var(--text-secondary)]">£{(r.totalVatAmount||0).toFixed(2)}</td><td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)]">£{r.totalGrossAmount?.toFixed(2)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
