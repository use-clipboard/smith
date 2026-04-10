'use client';
import { useState, useEffect } from 'react';
import { FolderOpen, AlertTriangle } from 'lucide-react';

interface DriveUploadModalProps {
  isOpen: boolean;
  fileCount: number;
  initialClientCode?: string;
  onConfirm: (saveToDrive: boolean, clientCode: string) => void;
  onCancel: () => void;
}

export default function DriveUploadModal({
  isOpen,
  fileCount,
  initialClientCode = '',
  onConfirm,
  onCancel,
}: DriveUploadModalProps) {
  const [saveToDrive, setSaveToDrive] = useState(true);
  const [clientCode, setClientCode] = useState(initialClientCode);

  useEffect(() => {
    if (isOpen) {
      setSaveToDrive(true);
      setClientCode(initialClientCode);
    }
  }, [isOpen, initialClientCode]);

  if (!isOpen) return null;

  const needsClientCode = saveToDrive && !clientCode.trim();
  const canConfirm = !saveToDrive || clientCode.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div className="relative glass-solid rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 border border-[var(--border)]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex items-center justify-center flex-shrink-0">
            <FolderOpen size={18} className="text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Ready to Process</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {fileCount} file{fileCount !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>

        {/* Save to Drive toggle */}
        <div className="flex items-center justify-between p-4 bg-[var(--bg-nav-hover)] rounded-xl mb-4 border border-[var(--border)]">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">Save files to Google Drive</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Stored in your firm's Agent Smith Files folder</p>
          </div>
          <button
            type="button"
            onClick={() => setSaveToDrive(v => !v)}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors flex-shrink-0 ml-4 ${saveToDrive ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${saveToDrive ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Client code input */}
        {saveToDrive && (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
              Client code <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={clientCode}
              onChange={e => setClientCode(e.target.value.toUpperCase())}
              placeholder="e.g. MM001"
              autoFocus={!initialClientCode}
              className={`input-base w-full font-mono ${needsClientCode ? 'border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-900/10' : ''}`}
            />
            {needsClientCode && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                <AlertTriangle size={12} className="flex-shrink-0" />
                A client code is required to organise files in Drive
              </p>
            )}
            {clientCode.trim() && (
              <p className="text-xs text-[var(--text-muted)] mt-1.5">
                Files will be saved to:{' '}
                <span className="font-mono font-medium text-[var(--text-primary)]">
                  Agent Smith Files / {clientCode.trim()}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button
            onClick={() => onConfirm(saveToDrive, clientCode.trim())}
            disabled={!canConfirm}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveToDrive ? 'Save & Process' : 'Process without saving'}
          </button>
        </div>
      </div>
    </div>
  );
}
