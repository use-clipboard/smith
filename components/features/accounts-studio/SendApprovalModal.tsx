'use client';

import { useEffect, useState } from 'react';
import { X, Send, Loader2, Mail } from 'lucide-react';
import { generatePdfBlob } from '@/utils/pdfFromHtml';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { getFirmBranding } from './branding';
import { sendForApproval } from './persistence';
import type { Engagement } from './types';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export default function SendApprovalModal({
  engagement, onClose, onSent,
}: {
  engagement: Engagement;
  onClose: () => void;
  onSent: (e: Engagement) => void;
}) {
  const [email, setEmail] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(true);

  // Prefill the recipient from the client record.
  useEffect(() => {
    let cancelled = false;
    if (!engagement.clientId) { setLoadingEmail(false); return; }
    fetch(`/api/clients/${engagement.clientId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setEmail(d?.client?.contact_email ?? ''); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingEmail(false); });
    return () => { cancelled = true; };
  }, [engagement.clientId]);

  async function send() {
    if (!email.trim()) { setError('Enter the client’s email address.'); return; }
    setBusy(true); setError('');
    try {
      const branding = await getFirmBranding();
      const s = engagement.statements;
      const summaryLines = s ? [
        { label: 'Turnover', value: `£${Math.round(s.profitLoss.turnoverTotal).toLocaleString('en-GB')}` },
        { label: 'Profit for the year', value: `£${Math.round(s.profitLoss.netProfit).toLocaleString('en-GB')}` },
        { label: 'Net assets', value: `£${Math.round(s.balanceSheet.netAssets).toLocaleString('en-GB')}` },
      ] : [];
      const html = buildAccountsPackHtml(engagement, {
        firmName: branding.firmName, firmLogoUrl: branding.logoUrl,
        accountantDetails: branding.accountantDetails, accountantsReport: branding.accountantsReport,
        comparatives: engagement.showComparatives ?? true, amended: engagement.amended ?? false,
      });
      const blob = await generatePdfBlob(html, undefined, { hardPageBreaks: true, pageNumbers: true });
      const pdfBase64 = await blobToBase64(blob);
      await sendForApproval(engagement.id, { recipientEmail: email.trim(), coverNote: coverNote.trim() || null, pdfBase64, summaryLines });
      onSent({ ...engagement, approvalStatus: 'sent', sentAt: new Date().toISOString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send for approval.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-[20px] bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Mail size={16} /></div>
          <h3 className="flex-1 text-[15px] font-bold text-[var(--text-primary)]">Send for approval</h3>
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <p className="text-[12.5px] text-[var(--text-muted)]">Emails {engagement.companyName}&apos;s accounts (PDF attached) to the client to review and sign. Sent from your connected Gmail.</p>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">Client email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder={loadingEmail ? 'Loading…' : 'client@example.com'} className="input-base w-full" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">Cover note <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
            <textarea value={coverNote} onChange={e => setCoverNote(e.target.value)} rows={3} placeholder="A short personal note to the client…" className="input-base w-full resize-none" />
          </div>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-black/5 px-5 py-3.5">
          <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
          <button onClick={send} disabled={busy || !email.trim()} className="btn-primary disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send for approval
          </button>
        </div>
      </div>
    </div>
  );
}
