'use client';
import { useState, useEffect } from 'react';
import { Download, FolderOpen, Check, Loader2, X, Link2, AlertTriangle, Lock, Settings } from 'lucide-react';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { fileToBase64, exportToCsv } from '@/utils/fileUtils';
import { useModules } from '@/components/ui/ModulesProvider';
import type { Transaction, TargetSoftware } from '@/types';

type Status = 'idle' | 'uploading' | 'exporting' | 'done' | 'error';

interface SaveAnalysisModalProps {
  isOpen: boolean;
  transactions: Transaction[];
  documentFiles: File[];
  targetSoftware: TargetSoftware;
  initialClient?: SelectedClient | null;
  onClose: () => void;
}

export default function SaveAnalysisModal({
  isOpen,
  transactions,
  documentFiles,
  targetSoftware,
  initialClient,
  onClose,
}: SaveAnalysisModalProps) {
  const { isModuleActive } = useModules();
  const driveModuleActive = isModuleActive('google-drive');
  const vaultModuleActive = isModuleActive('document-vault');

  const [useDrive, setUseDrive] = useState(false);
  const [client, setClient] = useState<SelectedClient | null>(initialClient ?? null);
  const [clientCode, setClientCode] = useState(initialClient?.client_ref ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [driveCount, setDriveCount] = useState(0);

  // Reset when opened
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

  // Auto-populate client code when a client is selected
  useEffect(() => {
    if (client?.client_ref) setClientCode(client.client_ref);
  }, [client]);

  if (!isOpen) return null;

  const needsCode = useDrive && !clientCode.trim();
  const canSave = !useDrive || clientCode.trim().length > 0;
  const busy = status === 'uploading' || status === 'exporting';

  const handleSave = async () => {
    setStatus(useDrive ? 'uploading' : 'exporting');
    setErrorMsg('');

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${targetSoftware}_analysis_${dateStr}.csv`;
    let driveUrlMap: Record<string, string> = {};

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
            feature: 'full_analysis',
          }),
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error || 'Drive upload failed');
        }
        const result = await res.json();
        const uploadedFiles: { name: string; driveUrl: string; driveFileId: string }[] = result.uploadedFiles ?? [];
        uploadedFiles.forEach(f => { driveUrlMap[f.name] = f.driveUrl; });
        setDriveCount(uploadedFiles.length);

        // Save to vault if the document-vault module is active
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
              transactions,
              clientId: client?.id ?? null,
              clientCode: clientCode.trim() || null,
              clientName: client?.name ?? null,
            }),
          }).catch(err => console.error('[SaveAnalysisModal] vault save failed:', err));
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
        return;
      }
    }

    // Inject Drive links then export
    setStatus('exporting');
    const rows = transactions.map(tx => {
      const url = driveUrlMap[tx.fileName] ?? '';
      const row = { ...tx } as unknown as Record<string, unknown>;
      if (useDrive) row.driveLink = url;
      return row;
    });
    exportToCsv(rows, filename, targetSoftware);
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
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Save Analysis</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} · {documentFiles.length} source file{documentFiles.length !== 1 ? 's' : ''}
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
            <p className="font-semibold text-[var(--text-primary)] mb-1">Analysis saved</p>
            <p className="text-sm text-[var(--text-muted)]">
              Spreadsheet downloaded
              {driveCount > 0 && <> · {driveCount} file{driveCount !== 1 ? 's' : ''} saved to Google Drive</>}
              {useDrive && driveCount === 0 && ' · Google Drive not connected'}
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
              {status === 'uploading' ? 'Uploading files to Google Drive…' : 'Generating spreadsheet…'}
            </p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {status === 'uploading' ? 'This may take a moment' : 'Almost done'}
            </p>
          </div>
        )}

        {/* Idle form */}
        {status === 'idle' && (
          <div className="space-y-4">

            {/* Google Drive toggle — conditional on google-drive module */}
            {driveModuleActive ? (
              <div className="flex items-center justify-between p-4 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)]">
                <div>
                  <div className="flex items-center gap-2">
                    <FolderOpen size={15} className="text-[var(--text-secondary)]" />
                    <p className="text-sm font-medium text-[var(--text-primary)]">Save files to Google Drive</p>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 ml-5">
                    {useDrive ? 'Drive links will be included in the spreadsheet' : 'Toggle on to save source documents to Drive'}
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
              /* Greyed-out state when google-drive module is inactive */
              <div className="p-4 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)] opacity-60">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FolderOpen size={15} className="text-[var(--text-muted)]" />
                      <p className="text-sm font-medium text-[var(--text-secondary)]">Save files to Google Drive</p>
                      <Lock size={12} className="text-[var(--text-muted)]" />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1 ml-5">
                      Unlock the Google Drive integration to save source documents and add Drive links to your spreadsheet.
                    </p>
                  </div>
                  <div className="h-6 w-11 rounded-full bg-[var(--border-input)] shrink-0 ml-4 opacity-50" />
                </div>
                <a
                  href="/settings?tab=modules"
                  className="inline-flex items-center gap-1.5 mt-2 ml-5 text-xs text-[var(--accent)] hover:underline"
                >
                  <Settings size={11} />
                  Ask your admin to enable it in Settings → Modules
                </a>
              </div>
            )}

            {/* Document Vault note — shown when drive is on but vault is inactive */}
            {useDrive && driveModuleActive && !vaultModuleActive && (
              <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
                <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Files will be saved to Google Drive but won&apos;t be indexed in the Document Vault.{' '}
                  <a href="/settings?tab=modules" className="underline font-medium">Enable the Document Vault module</a> to automatically index and tag uploaded documents.
                </p>
              </div>
            )}

            {/* Drive link info pill */}
            {useDrive && driveModuleActive && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-light)] rounded-lg text-xs text-[var(--accent)] font-medium">
                <Link2 size={12} />
                A &quot;Drive Link&quot; column will be added to each row in the spreadsheet
              </div>
            )}

            {/* Client search (only when Drive on) */}
            {useDrive && driveModuleActive && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <ClientSelector
                    value={client}
                    onSelect={c => {
                      setClient(c);
                      if (c?.client_ref) setClientCode(c.client_ref);
                    }}
                  />
                </div>

                {/* Client code — shown if client has no ref or user wants to override */}
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

                {/* Folder path preview */}
                {clientCode.trim() && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Files will be saved to:{' '}
                    <span className="font-mono font-medium text-[var(--text-primary)]">
                      Agent Smith Files / {clientCode.trim()}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Spreadsheet summary */}
            <div className="p-3 bg-[var(--bg-nav-hover)] rounded-xl border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-1">
                <Download size={13} className="text-[var(--text-secondary)]" />
                <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Spreadsheet</span>
              </div>
              <p className="text-sm text-[var(--text-primary)]">
                {transactions.length} rows · {targetSoftware.toUpperCase()} format
                {useDrive && driveModuleActive && <> · includes Drive links</>}
              </p>
            </div>

            {/* Actions */}
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
                  <><Download size={14} /> Download Spreadsheet</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
