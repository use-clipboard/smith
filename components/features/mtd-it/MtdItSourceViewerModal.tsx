'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, ExternalLink, FileText } from 'lucide-react';

interface Props {
  quarterId: string;
  fileName: string;
  pageNumber?: number | null;
  onClose: () => void;
}

interface SignedUrlResponse {
  url: string;
  file_name: string;
  expires_in: number;
}

// Best-effort mime-type guess from filename extension. The signed URL endpoint
// returns the filename but doesn't currently return the mime — and we want to
// pick rendering (inline <img> vs <iframe>) before the network round trip is
// even complete.
function guessKind(fileName: string): 'image' | 'pdf' | 'other' {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

export default function MtdItSourceViewerModal({ quarterId, fileName, pageNumber, onClose }: Props) {
  const [signed, setSigned] = useState<SignedUrlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const kind = guessKind(fileName);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const params = new URLSearchParams({ quarter_id: quarterId, file_name: fileName });
        const res = await fetch(`/api/mtd-it/source-doc?${params.toString()}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? 'Failed to load source');
        setSigned(j as SignedUrlResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load source');
      } finally {
        setLoading(false);
      }
    })();
  }, [quarterId, fileName]);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100">
          <FileText size={16} className="text-gray-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{fileName}</div>
            {pageNumber && (
              <div className="text-[11px] text-gray-500">Page {pageNumber}</div>
            )}
          </div>
          {signed?.url && (
            <a
              href={signed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent-light)] rounded-lg"
            >
              <ExternalLink size={12} /> Open in new tab
            </a>
          )}
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-gray-100">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-gray-50 overflow-auto">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading source…
            </div>
          )}
          {!loading && error && (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-sm">
              <AlertTriangle size={20} className="text-red-500" />
              <div className="text-red-700">{error}</div>
              <p className="text-xs text-gray-500 mt-2 max-w-md text-center">
                The original document for this entry isn't available. This usually means it was uploaded before the source-storage feature was enabled, or the file was removed.
              </p>
            </div>
          )}
          {!loading && !error && signed?.url && kind === 'image' && (
            <div className="h-full flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signed.url} alt={fileName} className="max-w-full max-h-full object-contain" />
            </div>
          )}
          {!loading && !error && signed?.url && kind === 'pdf' && (
            <iframe
              src={signed.url}
              title={fileName}
              className="w-full h-full bg-white"
            />
          )}
          {!loading && !error && signed?.url && kind === 'other' && (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <FileText size={28} className="text-gray-400" />
              <p className="text-sm text-gray-600">Inline preview isn't available for this file type.</p>
              <a
                href={signed.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
              >
                <ExternalLink size={13} /> Open / download
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
