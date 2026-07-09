'use client';

import { useEffect, useState } from 'react';
import { X, Send, Loader2, Mail } from 'lucide-react';
import type { Engagement } from './types';

/**
 * Collects the recipient + cover note, then delegates the actual send to the
 * parent's useSendApproval hook (which lives in a component that stays mounted,
 * so it can catch the 'compose-sent' event that flips the status).
 */
export default function SendApprovalModal({
  engagement, initialEmail = '', sending, error, triageActive, onSubmit, onClose,
}: {
  engagement: Engagement;
  initialEmail?: string;
  sending: boolean;
  error: string;
  triageActive: boolean;
  onSubmit: (email: string, coverNote: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [coverNote, setCoverNote] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(!initialEmail);

  useEffect(() => {
    let cancelled = false;
    if (initialEmail || !engagement.clientId) { setLoadingEmail(false); return; }
    fetch(`/api/clients/${engagement.clientId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setEmail(d?.client?.contact_email ?? ''); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingEmail(false); });
    return () => { cancelled = true; };
  }, [engagement.clientId, initialEmail]);

  async function submit() {
    const ok = await onSubmit(email.trim(), coverNote.trim() || null);
    if (ok) onClose();
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
          <p className="text-[12.5px] text-[var(--text-muted)]">
            {triageActive
              ? `Opens a draft email with ${engagement.companyName}'s accounts attached and the client allocated — review and send it from the compose window.`
              : `Emails ${engagement.companyName}'s accounts (PDF attached) to the client from your connected Gmail.`}
          </p>
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
          <button onClick={onClose} disabled={sending} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={sending || !email.trim()} className="btn-primary disabled:opacity-50">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {triageActive ? 'Open draft' : 'Send for approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
