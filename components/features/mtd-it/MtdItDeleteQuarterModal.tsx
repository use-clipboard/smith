'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle, Trash2, FileText, Mail } from 'lucide-react';

interface Props {
  quarterId: string;
  onClose: () => void;
  /** Called once the delete has gone through. Parent navigates away. */
  onDeleted: () => void;
}

interface Preview {
  is_admin: boolean;
  entry_count: number;
  document_count: number;
  approval_count: number;
  status: string;
  client_name: string;
  client_ref: string | null;
  quarter_label: string;
}

// Admin-only confirmation for "delete this quarter and everything attached".
// Loads a preview of what'll be wiped so the admin sees the blast radius
// before clicking. The actual DELETE is a single round trip.
export default function MtdItDeleteQuarterModal({ quarterId, onClose, onDeleted }: Props) {
  const [preview,  setPreview]  = useState<Preview | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/mtd-it/quarters/${quarterId}/deletion-preview`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? 'Failed to load preview');
        setPreview(j as Preview);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [quarterId]);

  // Close on Escape (but only when not mid-delete)
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !deleting) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, deleting]);

  async function doDelete() {
    setDeleting(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/quarters/${quarterId}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Failed to delete');
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={!deleting ? onClose : undefined}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-full bg-red-50 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Delete this quarter?</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {preview ? `${preview.client_name}${preview.client_ref ? `  ·  ${preview.client_ref}` : ''}  ·  ${preview.quarter_label}` : 'Loading…'}
            </p>
          </div>
          <button onClick={onClose} disabled={deleting} aria-label="Close" className="p-1 rounded hover:bg-gray-100 disabled:opacity-50">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-500">
              <Loader2 size={16} className="inline animate-spin mr-2" /> Loading…
            </div>
          ) : !preview ? (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" /> {error ?? 'Failed to load preview'}
            </div>
          ) : !preview.is_admin ? (
            <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" />
              Only firm admins can delete a quarter. Please ask your firm administrator to do this for you.
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-700">
                This will permanently wipe everything attached to this quarter. There is no undo.
              </p>

              <div className="border border-red-200 bg-red-50/40 rounded-lg divide-y divide-red-100">
                <PreviewLine icon={<FileText size={14} className="text-gray-500" />} label="Analysed + manual entries" count={preview.entry_count} />
                <PreviewLine icon={<FileText size={14} className="text-gray-500" />} label="Source documents (PDFs / images)" count={preview.document_count} extra="will also be deleted from storage" />
                <PreviewLine icon={<Mail size={14} className="text-gray-500" />}     label="Approval cycles sent to client" count={preview.approval_count} />
              </div>

              {preview.status === 'approved' || preview.status === 'submitted' ? (
                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
                  <AlertTriangle size={14} className="shrink-0 mt-px" />
                  This quarter is currently <strong>{preview.status}</strong>. Deleting it removes the client's approval audit trail. Make sure you really mean to.
                </div>
              ) : null}
            </>
          )}

          {error && !deleting && !loading && preview && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={doDelete}
            disabled={deleting || loading || !preview?.is_admin}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Delete quarter permanently
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewLine({ icon, label, count, extra }: { icon: React.ReactNode; label: string; count: number; extra?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-800">{label}</div>
        {extra && <div className="text-[11px] text-gray-500">{extra}</div>}
      </div>
      <div className="text-sm font-semibold tabular-nums text-gray-900">{count}</div>
    </div>
  );
}
