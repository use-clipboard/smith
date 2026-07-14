'use client';

/**
 * LandlordSendApprovalModal — send the property income computation to the client
 * for approval. Mirrors the MTD IT flow: when Email Triage is on we prepare the
 * approval + rendered email server-side and hand it to the in-app compose window
 * (prefilled recipient, subject, body, client allocation and the PDF attached)
 * so the user sends from their own Gmail. Otherwise the server sends it directly.
 */

import { useEffect, useState } from 'react';
import { X, Loader2, Send, Mail } from 'lucide-react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { blobToBase64 } from '@/utils/pdfFromHtml';

interface Props {
  open: boolean;
  outputId: string;
  clientId: string | null;
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  summaryLines: Array<{ label: string; value: string }>;
  /** Builds the PDF to attach (the combined computation). */
  buildPdf: () => Promise<Blob>;
  onClose: () => void;
  onSent: (info: { approval_url: string; via_compose: boolean }) => void;
}

export default function LandlordSendApprovalModal({
  open, outputId, clientId, clientName, clientRef, clientEmail, summaryLines, buildPdf, onClose, onSent,
}: Props) {
  const { isModuleActive } = useModules();
  const compose = useComposeWindow();
  const triageActive = isModuleActive('email-triage');

  const [recipient, setRecipient] = useState(clientEmail ?? '');
  const [coverNote, setCoverNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setRecipient(clientEmail ?? ''); setCoverNote(''); setError(''); }
  }, [open, clientEmail]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !sending) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  async function send() {
    if (!recipient.trim()) { setError('Enter an email address to send to.'); return; }
    setSending(true); setError('');
    try {
      const pdfBlob = await buildPdf();
      const pdfBase64 = await blobToBase64(pdfBlob);

      const res = await fetch(`/api/landlord/outputs/${outputId}/send-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email: recipient.trim(),
          cover_note: coverNote.trim() || null,
          pdf_base64: pdfBase64,
          summary_lines: summaryLines,
          // With Email Triage on, the server records the approval + renders the
          // email but doesn't send — the compose window does, from the user's Gmail.
          prepare_only: triageActive,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Failed to send');

      if (triageActive) {
        const pdfFile = new File([pdfBlob], (j.attachment_filename as string) || 'property-income.pdf', { type: 'application/pdf' });
        compose.open({
          defaultTo: [{ name: clientName, email: recipient.trim() }],
          defaultSubject: (j.subject as string) ?? '',
          prefilledBody: (j.html_body as string) ?? '',
          defaultAttachments: [pdfFile],
          defaultClients: clientId
            ? [{ id: clientId, name: clientName, client_ref: clientRef ?? '', contact_email: clientEmail, risk_rating: null }]
            : [],
        });
      }

      onSent({ approval_url: j.approval_url as string, via_compose: triageActive });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={!sending ? onClose : undefined}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Send size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Send for approval</h2>
            <p className="text-[11px] text-slate-500">{clientName}{clientRef ? ` (${clientRef})` : ''}</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="text-slate-400 hover:text-slate-700 disabled:opacity-50"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Send to</span>
            <input type="email" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="client@example.com"
              className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
            {!clientEmail && <span className="text-[11px] text-amber-600 mt-1 block">This client has no contact email saved — enter one above.</span>}
          </label>

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Cover note <span className="text-slate-400">(optional)</span></span>
            <textarea value={coverNote} onChange={e => setCoverNote(e.target.value)} rows={3}
              placeholder="A personal line to open the email — the firm's standard wording follows it."
              className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 resize-y" />
          </label>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Mail size={13} className="shrink-0 mt-0.5" />
            {triageActive
              ? <span>The email opens in your compose window with the PDF attached and the client allocated, so you can review it before sending from your own inbox.</span>
              : <span>The email is sent from your connected Gmail with the PDF attached. Connect Email Triage to review it in a compose window first.</span>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={sending} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => void send()} disabled={sending || !recipient.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Preparing…' : triageActive ? 'Prepare email' : 'Send for approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
