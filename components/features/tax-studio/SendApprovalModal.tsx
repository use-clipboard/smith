'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Send, Download, Loader2, Mail } from 'lucide-react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { renderSa100ApprovalPdf, blobToBase64, packSummaryLines } from './approvalPdf';
import { sendForApproval, markApprovalSent } from './persistence';
import type { TaxReturn } from './types';

export default function SendApprovalModal({ ret, onClose, onSent }: { ret: TaxReturn; onClose: () => void; onSent: (approvalUrl?: string) => void }) {
  const { isModuleActive } = useModules();
  const compose = useComposeWindow();
  const triageActive = isModuleActive('email-triage');

  const [email, setEmail] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  // Default the recipient from the client record.
  useEffect(() => {
    let cancelled = false;
    if (!ret.clientId) return;
    fetch(`/api/clients/${ret.clientId}`).then(r => (r.ok ? r.json() : null)).then(d => { if (!cancelled && d?.client?.contact_email) setEmail(d.client.contact_email); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ret.clientId]);

  // Flip to 'sent' only when the compose window really sends.
  useEffect(() => {
    function handler(ev: Event) {
      if (!pending.current) return;
      const ids = ((ev as CustomEvent).detail?.clientIds ?? []) as string[];
      if (ret.clientId && ids.length && !ids.includes(ret.clientId)) return;
      pending.current = false;
      markApprovalSent(ret.id).finally(() => { onSent(); onClose(); });
    }
    window.addEventListener('smith:compose-sent', handler);
    return () => window.removeEventListener('smith:compose-sent', handler);
  }, [ret.id, ret.clientId, onSent, onClose]);

  function buildInput() {
    return {
      clientName: ret.clientName, clientRef: ret.clientRef, utr: ret.utr,
      taxYear: ret.taxYear, returnTypeId: ret.returnType, entityLabel: ret.entityLabel,
      preparedBy: ret.preparedBy, income: ret.income,
    };
  }

  async function download() {
    setDownloading(true); setError('');
    try {
      const blob = await renderSa100ApprovalPdf(buildInput());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Tax_Return_${ret.clientName.replace(/\s+/g, '_')}_${ret.taxYear.replace('/', '-')}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch { setError('Could not generate the pack.'); }
    finally { setDownloading(false); }
  }

  async function send() {
    if (!email.trim()) { setError('Enter the client’s email address.'); return; }
    setSending(true); setError('');
    try {
      const blob = await renderSa100ApprovalPdf(buildInput());
      const summaryLines = packSummaryLines(ret.income, ret.taxYear);
      const filename = `Tax_Return_${ret.clientName.replace(/\s+/g, '_')}_${ret.taxYear.replace('/', '-')}.pdf`;

      if (triageActive) {
        const res = await sendForApproval(ret.id, { recipientEmail: email.trim(), coverNote: coverNote || null, summaryLines, prepareOnly: true });
        pending.current = true;
        compose.open({
          defaultTo: [{ name: ret.clientName, email: email.trim() }],
          defaultClients: ret.clientId ? [{ id: ret.clientId, name: ret.clientName, client_ref: ret.clientRef ?? '', contact_email: email.trim(), risk_rating: null }] : null,
          defaultSubject: res.subject ?? null,
          defaultHtmlBody: res.htmlBody ?? null,
          defaultAttachments: [new File([blob], filename, { type: 'application/pdf' })],
        });
        // The compose-sent listener flips status + closes. Leave the modal open until then.
      } else {
        const pdfBase64 = await blobToBase64(blob);
        const res = await sendForApproval(ret.id, { recipientEmail: email.trim(), coverNote: coverNote || null, pdfBase64, summaryLines, prepareOnly: false });
        onSent(res.approvalUrl); onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send for approval.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !sending && onClose()}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[22px] border border-white/60 bg-white/95 shadow-[0_24px_80px_rgba(31,38,88,0.28)] backdrop-blur-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Mail size={18} /></div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">Send for approval</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">{ret.clientName} · {ret.taxYear}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>

        <div className="px-5 py-4">
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Client email</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="client@example.com" className="input-base py-2 text-sm" />

          <label className="mb-1 mt-3 block text-[12px] font-semibold text-[var(--text-secondary)]">Cover note (optional)</label>
          <textarea value={coverNote} onChange={e => setCoverNote(e.target.value)} rows={2} placeholder="A short message added above the standard email." className="input-base resize-none py-2 text-sm" />

          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            The pack (tax computation, your return, and what to pay) is attached automatically.
            {triageActive ? ' It opens in the compose window for you to review and send.' : ' Sent from your connected Gmail.'}
          </p>

          {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}

          <div className="mt-4 flex items-center justify-between gap-2">
            <button onClick={download} disabled={downloading} className="btn-secondary bg-white">{downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download pack</button>
            <button onClick={send} disabled={sending} className="btn-primary disabled:opacity-50">{sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {triageActive ? 'Prepare email' : 'Send for approval'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
