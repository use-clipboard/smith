'use client';

// Send one client's statement. Mirrors SendInvoiceModal: preview the resolved
// email, edit it, send it — with the statement PDF rendered here (the server has
// no browser) and attached.

import { useEffect, useState } from 'react';
import { X, Mail, Loader2, Send, AlertTriangle, Paperclip } from 'lucide-react';
import { fmtPence } from '@/lib/billing/totals';
import type { StatementData } from '@/lib/billing/statement';
import { buildStatementHtml } from '@/lib/billing/statementHtml';
import { fetchLetterhead } from '@/lib/billing/fetchLetterhead';
import { renderHtmlPdfBase64 } from '@/lib/billing/renderPdf';

interface Preview {
  statement: StatementData;
  firmName: string;
  to: string | null;
  senderEmail: string | null;
  subject: string;
  body: string;
  ready: boolean;
  warning: string | null;
}

interface Props {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onSent: (sentTo: string) => void;
}

export default function SendStatementModal({ clientId, clientName, onClose, onSent }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/billing/statements/send?clientId=${clientId}`)
      .then(r => (r.ok ? r.json() : null))
      .then((p: Preview | null) => {
        if (!p) { setError('Could not load the statement.'); return; }
        setPreview(p); setSubject(p.subject); setBody(p.body);
      })
      .catch(() => setError('Could not load the statement.'));
  }, [clientId]);

  async function send() {
    if (!preview) return;
    setSending(true); setError(null);

    let pdf_base64: string | undefined;
    try {
      setStage('Building PDF…');
      const letterhead = await fetchLetterhead();
      pdf_base64 = await renderHtmlPdfBase64(buildStatementHtml(preview.statement, letterhead));
    } catch (e) {
      console.error('statement pdf render', e);
      setSending(false); setStage(null);
      // Don't quietly downgrade — the screen promised an attachment.
      if (!confirm('The statement PDF could not be generated. Send the email without it attached?')) return;
      setSending(true);
    }

    setStage('Sending…');
    const r = await fetch('/api/billing/statements/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, subject, body, pdf_base64 }),
    });
    setSending(false); setStage(null);
    if (r.ok) { const d = await r.json().catch(() => null); onSent(d?.sentTo ?? clientName); }
    else { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not send the statement.'); }
  }

  const st = preview?.statement;

  return (
    <>
      <div className="fixed inset-0 z-[62] bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[63] flex max-h-[88vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-[var(--accent)]" />
            <h3 className="text-[16px] font-bold text-[var(--text-primary)]">Send statement — {clientName}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        {!preview ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[var(--text-muted)]">
            {error ? <span className="text-[13px] text-[var(--danger)]">{error}</span> : <><Loader2 size={22} className="animate-spin text-[var(--accent)]" /> Building statement…</>}
          </div>
        ) : (
          <div className="flex-1 space-y-3 overflow-y-auto scrollbar-thin p-5">
            {preview.warning && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{preview.warning}</span>
              </div>
            )}

            <div className="grid grid-cols-[64px_1fr] items-center gap-2 text-[13px]">
              <span className="text-[var(--text-muted)]">From</span>
              <span className="font-medium text-[var(--text-secondary)]">{preview.senderEmail ?? <em className="text-amber-600">not connected</em>}</span>
              <span className="text-[var(--text-muted)]">To</span>
              <span className="font-medium text-[var(--text-secondary)]">{preview.to ?? <em className="text-amber-600">no client email</em>}</span>
            </div>

            {st && (
              <div className="flex items-center justify-between rounded-xl bg-black/[0.02] px-3 py-2.5">
                <div className="text-[12px] text-[var(--text-muted)]">
                  {st.mode === 'activity' ? 'Activity statement' : 'Outstanding invoices'} · {st.lines.length} line{st.lines.length === 1 ? '' : 's'}
                </div>
                <div className="text-[15px] font-bold text-[var(--text-primary)]">{fmtPence(st.closingPence)}</div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Message</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={7} className="w-full resize-none rounded-lg border border-black/10 px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]" />
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">The statement table and a &ldquo;View &amp; pay invoice&rdquo; button are added below your message automatically.</p>
            </div>

            <div className="flex items-center gap-1.5 rounded-lg bg-black/[0.02] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              <Paperclip size={12} className="shrink-0 text-[var(--text-muted)]" />
              <span>The statement PDF is attached, using your invoice branding.</span>
            </div>

            {error && <p className="text-[13px] text-[var(--danger)]">{error}</p>}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={send} disabled={sending || !preview?.ready} className="btn-primary disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {sending ? (stage ?? 'Sending…') : 'Send statement'}
          </button>
        </div>
      </div>
    </>
  );
}
