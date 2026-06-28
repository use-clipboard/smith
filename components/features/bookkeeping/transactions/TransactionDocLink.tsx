'use client';

/**
 * TransactionDocLink — attach a SOURCE-DOCUMENT LINK to a transaction.
 *
 * No file is stored in SMITH. "Save to Drive" uploads the picked file to the
 * client's Google Drive (via the existing /api/vault/upload flow) and keeps only
 * the returned webViewLink. A user can also paste an existing link. The value is
 * { url, name } and is saved on the transaction as source_doc_url/source_doc_name.
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Loader2, X, Upload, ExternalLink } from 'lucide-react';

export default function TransactionDocLink({
  bookId, value, onChange,
}: {
  bookId: string;
  value: { url: string | null; name: string | null };
  onChange: (url: string | null, name: string | null) => void;
}) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // The book's client drives which Drive folder the file lands in. If we can't
  // resolve it, the upload falls back to the default vault folder.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookkeeping/books/${bookId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.book) setClientId(d.book.client_id ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  async function uploadFile(file: File) {
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (clientId) fd.append('client_id', clientId);
      const r = await fetch('/api/vault/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not save to Drive.');
      onChange(d.google_drive_url ?? null, d.file_name ?? file.name);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save to Drive.'); }
    finally { setUploading(false); }
  }

  if (value.url) {
    return (
      <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
        <Paperclip size={13} className="text-slate-400 shrink-0" />
        <a href={value.url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-indigo-700 hover:underline truncate flex-1 inline-flex items-center gap-1">
          {value.name || 'Source document'} <ExternalLink size={11} className="shrink-0" />
        </a>
        <button type="button" onClick={() => onChange(null, null)} aria-label="Remove document link" className="text-slate-400 hover:text-rose-600">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = ''; }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 disabled:opacity-50">
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Save to Drive
        </button>
        <span className="text-[11px] text-slate-400">or paste a link</span>
      </div>
      <div className="flex items-center gap-2">
        <input value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} placeholder="https://drive.google.com/…"
          className="flex-1 text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30" />
        <button type="button" disabled={!/^https?:\/\//.test(pasteUrl.trim())}
          onClick={() => { onChange(pasteUrl.trim(), null); setPasteUrl(''); }}
          className="text-xs px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40">
          Attach
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  );
}
