'use client';
import { useState, useRef, useCallback } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import SaveBankCsvModal from '@/components/features/bank-to-csv/SaveBankCsvModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import { fileToBase64 } from '@/utils/fileUtils';
import type { BankCsvTransaction, DocumentScanResult } from '@/types';
import { ArrowLeftRight, Download } from 'lucide-react';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';

export default function BankToCsvPage() {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/bank-to-csv', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [results, setResults] = useState<BankCsvTransaction[]>([]);
  const [wasTruncated, setWasTruncated] = useState(false);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [saveModalOpen, setSaveModalOpen] = useState(false);

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
    clientCode: string | null,
  ): Promise<DocumentScanResult[]> => {
    const docResults: DocumentScanResult[] = [];

    for (let i = 0; i < filesToScan.length; i++) {
      const file = filesToScan[i];
      setScanProgress({ current: i + 1, total: filesToScan.length, fileName: file.name });

      try {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/bank-to-csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [{ name: file.name, mimeType: file.type || 'application/pdf', base64 }],
            clientId,
            clientCode,
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
          const transactions: BankCsvTransaction[] = (data.transactions || []).filter(Boolean);
          if (data.truncated) setWasTruncated(true);
          docResults.push({
            fileName: file.name,
            status: 'success',
            validTransactions: transactions,
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
    <ToolLayout title="Bank to CSV" icon={ArrowLeftRight} iconColor="#0891B2">
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  if (appState === 'scan_results') return (
    <ToolLayout title="Bank to CSV" icon={ArrowLeftRight} iconColor="#0891B2">
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
    <ToolLayout title="Bank to CSV" description="Extract transactions from bank statements and produce a clean CSV." icon={ArrowLeftRight} iconColor="#0891B2">
      {appState === 'idle' && (
        <div className="space-y-5">
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
            </div>
            <FileUpload title="Bank Statement(s)" onFilesChange={setDocumentFiles} multiple accept="application/pdf,image/*" helpText="Upload PDF or image bank statements." existingFiles={documentFiles} />
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={documentFiles.length === 0} className="btn-primary">
              <ArrowLeftRight size={15} />
              Extract Transactions
            </button>
          </div>
        </div>
      )}

      {appState === 'success' && (
        <div className="space-y-4">
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
              <button onClick={() => setSaveModalOpen(true)} className="btn-primary">
                <Download size={14} />
                Save & Export CSV
              </button>
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Analysis</button>
            </div>
          </div>
          <SaveBankCsvModal
            isOpen={saveModalOpen}
            results={results}
            documentFiles={documentFiles}
            initialClient={selectedClient}
            onClose={() => setSaveModalOpen(false)}
          />
          <div className="glass-solid rounded-xl overflow-x-auto">
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
