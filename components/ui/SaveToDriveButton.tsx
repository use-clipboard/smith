'use client';
import { useState, useCallback } from 'react';
import { FolderOpen, Check, Loader2 } from 'lucide-react';
import DriveUploadModal from './DriveUploadModal';
import { fileToBase64 } from '@/utils/fileUtils';

interface SaveToDriveButtonProps {
  files: File[];
  feature: string;
  clientId?: string | null;
  initialClientCode?: string;
}

export default function SaveToDriveButton({ files, feature, clientId, initialClientCode = '' }: SaveToDriveButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleConfirm = useCallback(async (saveToDrive: boolean, clientCode: string) => {
    setModalOpen(false);
    if (!saveToDrive) return;
    setStatus('loading');
    try {
      const encodedFiles = await Promise.all(files.map(async f => ({ name: f.name, mimeType: f.type || 'application/pdf', base64: await fileToBase64(f) })));
      const res = await fetch('/api/documents/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: encodedFiles, clientId: clientId ?? null, clientCode, feature }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Upload failed'); }
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    }
  }, [files, clientId, feature]);

  if (status === 'saved') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-900/30 rounded-lg text-sm font-medium">
        <Check size={14} />
        Saved to Drive
      </div>
    );
  }

  return (
    <>
      <DriveUploadModal isOpen={modalOpen} fileCount={files.length} initialClientCode={initialClientCode} onConfirm={handleConfirm} onCancel={() => setModalOpen(false)} />
      <div className="flex items-center gap-2">
        <button
          onClick={() => setModalOpen(true)}
          disabled={status === 'loading' || files.length === 0}
          className="btn-secondary"
        >
          {status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
          {status === 'loading' ? 'Saving…' : 'Save to Drive'}
        </button>
        {status === 'error' && <span className="text-xs text-red-500">{errorMsg}</span>}
      </div>
    </>
  );
}
