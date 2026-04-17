'use client';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Download, FolderOpen, Check, Loader2, X, AlertTriangle, Lock, Settings, Table2 } from 'lucide-react';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { fileToBase64 } from '@/utils/fileUtils';
import { useModules } from '@/components/ui/ModulesProvider';
import type { OutOfRangeDocument } from '@/types';
import type { GroupBy } from '@/app/(app)/summarise/page';

type Status = 'idle' | 'uploading' | 'exporting' | 'done' | 'error';

interface SaveSummariseModalProps {
  isOpen: boolean;
  results: OutOfRangeDocument[];
  documentFiles: File[];
  initialClient?: SelectedClient | null;
  groupBy: GroupBy;
  onClose: () => void;
}

// ── XLSX export ───────────────────────────────────────────────────────────────

function buildSummarySheet(
  results: OutOfRangeDocument[],
  groupKey: 'entityName' | 'detailedCategory',
  labelCol: string,
) {
  const map = new Map<string, { net: number; vat: number; gross: number; count: number }>();
  for (const r of results) {
    const key = (r[groupKey] as string) || 'Unknown';
    const cur = map.get(key) ?? { net: 0, vat: 0, gross: 0, count: 0 };
    map.set(key, {
      net: cur.net + (r.totalNetAmount ?? 0),
      vat: cur.vat + (r.totalVatAmount ?? 0),
      gross: cur.gross + (r.totalGrossAmount ?? 0),
      count: cur.count + 1,
    });
  }
  const rows = Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, t]) => ({
      [labelCol]: label,
      'Documents': t.count,
      'Net (£)': +t.net.toFixed(2),
      'VAT (£)': +t.vat.toFixed(2),
      'Gross (£)': +t.gross.toFixed(2),
    }));

  // Grand total row
  const grandNet = results.reduce((s, r) => s + (r.totalNetAmount ?? 0), 0);
  const grandVat = results.reduce((s, r) => s + (r.totalVatAmount ?? 0), 0);
  const grandGross = results.reduce((s, r) => s + (r.totalGrossAmount ?? 0), 0);
  rows.push({
    [labelCol]: 'TOTAL',
    'Documents': results.length,
    'Net (£)': +grandNet.toFixed(2),
    'VAT (£)': +grandVat.toFixed(2),
    'Gross (£)': +grandGross.toFixed(2),
  });

  return XLSX.utils.json_to_sheet(rows);
}

function exportToXlsx(results: OutOfRangeDocument[], filename: string) {
  const wb = XLSX.utils.book_new();

  // Sheet 1 — Detail (flat data, ideal for building your own pivot)
  const detailRows = results.map(r => ({
    'File': r.fileName,
    'Date': r.detectedDate,
    'Entity': r.entityName,
    'Category': r.detailedCategory,
    'Net (£)': +(r.totalNetAmount ?? 0).toFixed(2),
    'VAT (£)': +(r.totalVatAmount ?? 0).toFixed(2),
    'Gross (£)': +(r.totalGrossAmount ?? 0).toFixed(2),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Detail');

  // Sheet 2 — By Entity
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(results, 'entityName', 'Entity'), 'By Entity');

  // Sheet 3 — By Category
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(results, 'detailedCategory', 'Category'), 'By Category');

  XLSX.writeFile(wb, filename);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SaveSummariseModal({
  isOpen,
  results,
  documentFiles,
  initialClient,
  groupBy,
  onClose,
}: SaveSummariseModalProps) {
  const { isModuleActive } = useModules();
  const driveModuleActive = isModuleActive('google-drive');
  const vaultModuleActive = isModuleActive('document-vault');

  const [useDrive, setUseDrive] = useState(false);
  const [client, setClient] = useState<SelectedClient | null>(initialClient ?? null);
  const [clientCode, setClientCode] = useState(initialClient?.client_ref ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [driveCount, setDriveCount] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setUseDrive(false);
      setClient(initialClient ?? null);
      setClientCode(initialClient?.client_ref ?? '');
      setStatus('idle');
      setErrorMsg('');
      setDriveCount(0);
    }
  }, [isOpen, initialClient]);

  useEffect(() => {
    if (client?.client_ref) setClientCode(client.client_ref);
  }, [client]);

  if (!isOpen) return null;

  const needsCode = useDrive && !clientCode.trim();
  const canSave = !useDrive || clientCode.trim().length > 0;
  const busy = status === 'uploading' || status === 'exporting';

  const filename = `summarised_docs_${new Date().toISOString().slice(0, 10)}.xlsx`;

  const GROUP_BY_LABELS: Record<GroupBy, string> = {
    none: 'None (flat list)',
    entity: 'Entity',
    category: 'Category',
  };

  const handleSave = async () => {
    setStatus(useDrive ? 'uploading' : 'exporting');
    setErrorMsg('');

    if (useDrive) {
      try {
        const encodedFiles = await Promise.all(
          documentFiles.map(async f => ({
            name: f.name,
            mimeType: f.type || 'application/pdf',
            base64: await fileToBase64(f),
          }))
        );
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: encodedFiles,
            clientId: client?.id ?? null,
            clientCode: clientCode.trim(),
            feature: 'summarise',
          }),
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error || 'Drive upload failed');
        }
        const result = await res.json();
        const uploadedFiles: { name: string; driveUrl: string; driveFileId: string }[] = result.uploadedFiles ?? [];
        setDriveCount(uploadedFiles.length);

        if (vaultModuleActive && uploadedFiles.length > 0) {
          const filesWithSize = await Promise.all(
            uploadedFiles.map(async uf => {
              const original = documentFiles.find(f => f.name === uf.name);
              return { ...uf, mimeType: original?.type || 'application/pdf', fileSizeBytes: original?.size };
            })
          );
          fetch('/api/vault/save-from-analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uploadedFiles: filesWithSize,
              transactions: [],
              clientId: client?.id ?? null,
              clientCode: clientCode.trim() || null,
              clientName: client?.name ?? null,
              sourceTool: 'summarise',
            }),
          }).catch(err => console.error('[SaveSummariseModal] vault save failed:', err));
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
        return;
      }
    }

    setStatus('exporting');
    exportToXlsx(results, filename);
    setStatus('done');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={!busy ? onClose : undefined} />

      <div className="relative glass-solid rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 border border-[var(--border)]">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
              <Download size={18} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Save Results</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {results.length} document{results.length !== 1 ? 's' : ''} · {documentFiles.length} source file{documentFiles.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          {!busy && status !== 'done' && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] transition-colors">
              <X size={16} />
            </button>
          )}
        </div>

        {/* Done state */}
        {status === 'done' && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3">
              <Check size={22} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="font-semibold text-[var(--text-primary)] mb-1">Saved successfully</p>
            <p className="text-sm text-[var(--text-muted)]">
              Excel file downloaded
              {driveCount > 0 && <> · {driveCount} file{driveCount !== 1 ? 's' : ''} saved to Google Drive</>}
            </p>
            <button onClick={onClose} className="btn-primary mt-4 w-full">Done</button>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl">
              <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-400">{errorMsg}</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={() => setStatus('idle')} className="btn-primary">Try again</button>
            </div>
          </div>
        )}

        {/* Loading states */}
        {(status === 'uploading' || status === 'exporting') && (
          <div className="text-center py-6">
            <Loader2 size={28} className="animate-spin text-[var(--accent)] mx-auto mb-3" />
            <p className="font-medium text-[var(--text-primary)]">
              {status === 'uploading' ? 'Uploading files to Google Drive…' : 'Generating Excel file…'}
            </p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {status === 'uploading' ? 'This may take a moment' : 'Almost done'}
            </p>
          </div>
        )}

        {/* Idle form */}
        {status === 'idle' && (
          <div className="space-y-4">

            {driveModuleActive ? (
              <div className="flex items-center justify-between p-4 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <FolderOpen size={15} className="text-[var(--text-secondary)]" />
                    <p className="text-sm font-medium text-[var(--text-primary)]">Save files to Google Drive</p>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 ml-5">
                    {useDrive ? 'Source documents will be saved to Drive' : 'Toggle on to save source documents to Drive'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUseDrive(v => !v)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors shrink-0 ml-4 ${useDrive ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${useDrive ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ) : (
              <div className="p-4 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)] opacity-60">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FolderOpen size={15} className="text-[var(--text-muted)]" />
                      <p className="text-sm font-medium text-[var(--text-secondary)]">Save files to Google Drive</p>
                      <Lock size={12} className="text-[var(--text-muted)]" />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1 ml-5">
                      Unlock the Google Drive integration to save source documents to Drive.
                    </p>
                  </div>
                  <div className="h-6 w-11 rounded-full bg-[var(--border-input)] shrink-0 ml-4 opacity-50" />
                </div>
                <a href="/settings?tab=modules" className="inline-flex items-center gap-1.5 mt-2 ml-5 text-xs text-[var(--accent)] hover:underline">
                  <Settings size={11} />
                  Ask your admin to enable it in Settings → Modules
                </a>
              </div>
            )}

            {useDrive && driveModuleActive && !vaultModuleActive && (
              <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
                <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Files will be saved to Google Drive but won&apos;t be indexed in the Document Vault.{' '}
                  <a href="/settings?tab=modules" className="underline font-medium">Enable the Document Vault module</a> to automatically index uploaded documents.
                </p>
              </div>
            )}

            {useDrive && driveModuleActive && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <ClientSelector value={client} onSelect={c => { setClient(c); if (c?.client_ref) setClientCode(c.client_ref); }} />
                </div>
                {(!client?.client_ref || !client) && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                      Client code <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={clientCode}
                      onChange={e => setClientCode(e.target.value.toUpperCase())}
                      placeholder="e.g. MM001"
                      className={`input-base w-full font-mono ${needsCode ? 'border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/10' : ''}`}
                    />
                    {needsCode && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                        <AlertTriangle size={12} className="shrink-0" />
                        A client code is required to organise files in Drive
                      </p>
                    )}
                  </div>
                )}
                {clientCode.trim() && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Files will be saved to:{' '}
                    <span className="font-mono font-medium text-[var(--text-primary)]">SMITH Files / {clientCode.trim()}</span>
                  </p>
                )}
              </div>
            )}

            {/* Excel export info */}
            <div className="p-3 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)] space-y-2">
              <div className="flex items-center gap-2">
                <Table2 size={13} className="text-[var(--text-secondary)]" />
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Excel Export (.xlsx)</span>
              </div>
              <p className="text-sm text-[var(--text-primary)]">{filename}</p>
              <div className="text-xs text-[var(--text-muted)] space-y-0.5">
                <p>· <span className="font-medium text-[var(--text-secondary)]">Detail</span> — {results.length} row{results.length !== 1 ? 's' : ''}, all documents (use for custom pivot tables)</p>
                <p>· <span className="font-medium text-[var(--text-secondary)]">By Entity</span> — totals grouped by supplier/entity</p>
                <p>· <span className="font-medium text-[var(--text-secondary)]">By Category</span> — totals grouped by category</p>
              </div>
              {groupBy !== 'none' && (
                <p className="text-xs text-[var(--accent)]">
                  Current view grouped by: <span className="font-semibold">{groupBy === 'entity' ? 'Entity' : 'Category'}</span>
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {useDrive && driveModuleActive ? (
                  <><FolderOpen size={14} /> Save & Download</>
                ) : (
                  <><Download size={14} /> Download Excel</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
