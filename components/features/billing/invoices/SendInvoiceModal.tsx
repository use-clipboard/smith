'use client';

import { useEffect, useState } from 'react';
import { X, Mail, Loader2, Send, AlertTriangle, ExternalLink } from 'lucide-react';

interface Preview { to: string | null; senderEmail: string | null; subject: string; body: string; portalLink: string; ready: boolean; warning: string | null }

interface Props {
  invoiceId: string;
  invoiceNumber: string | null;
  onClose: () => void;
  onSent: () => void;
  onGoToSettings?: () => void;
}

export default function SendInvoiceModal({ invoiceId, invoiceNumber, onClose, onSent, onGoToSettings }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/billing/invoices/${invoiceId}/send-email`)
      .then(r => (r.ok ? r.json() : null))
      .then((p: Preview | null) => { if (p) { setPreview(p); setSubject(p.subject); setBody(p.body); } })
      .catch(() => setError('Could not load the email preview.'));
  }, [invoiceId]);

  async function send() {
    setSending(true); setError(null);
    const r = await fetch(`/api/billing/invoices/${invoiceId}/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject, body }),
    });
    setSending(false);
    if (r.ok) onSent();
    else { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not send the invoice.'); }
  }

  return (
    <>
      <div className="fixed inset-0 z-[62] bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[63] flex max-h-[88vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div className="flex items-center gap-2"><Mail size={18} className="text-[var(--accent)]" /><h3 className="text-[16px] font-bold text-[var(--text-primary)]">Send invoice {invoiceNumber ?? ''}</h3></div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        {!preview ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[var(--text-muted)]"><Loader2 size={22} className="animate-spin text-[var(--accent)]" /> Loading preview…</div>
        ) : (
          <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-3">
            {preview.warning && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{preview.warning}{!preview.senderEmail && onGoToSettings && <> <button onClick={onGoToSettings} className="font-semibold underline">Open Settings</button></>}</span>
              </div>
            )}
            <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-[13px]">
              <span className="text-[var(--text-muted)]">From</span>
              <span className="font-medium text-[var(--text-secondary)]">{preview.senderEmail ?? <em className="text-amber-600">not connected</em>}</span>
              <span className="text-[var(--text-muted)]">To</span>
              <span className="font-medium text-[var(--text-secondary)]">{preview.to ?? <em className="text-amber-600">no client email</em>}</span>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">A &ldquo;View &amp; pay invoice&rdquo; button linking to the client&rsquo;s secure statement is added automatically. Edit the default template in Settings.</p>
            </div>
            {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          {preview?.portalLink
            ? <a href={preview.portalLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)]">Preview portal <ExternalLink size={12} /></a>
            : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={send} disabled={sending || !preview?.ready} className="btn-primary disabled:opacity-50"><Send size={14} /> {sending ? 'Sending…' : 'Send invoice'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
