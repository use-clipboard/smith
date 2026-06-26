'use client';

import { useEffect, useState } from 'react';
import { Building2, Loader2, AlertTriangle, Clock, X } from 'lucide-react';

interface PendingRequest { id: string; status: string; requested_at: string; requested_by_name?: string | null }

/**
 * Admin-only "Delete entire firm account" request. Wiping a whole tenant is
 * processed by SMITH/operator after verification (not an instant in-app wipe) —
 * this just records the request, with a type-the-firm-name confirmation.
 */
export default function DeleteFirmSection({ firmName }: { firmName: string }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/account/firm-deletion-request');
        const d = await r.json() as { request: PendingRequest | null };
        setPending(d.request ?? null);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  async function submit() {
    setSubmitting(true); setError('');
    try {
      const r = await fetch('/api/account/firm-deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: confirmName, reason: reason.trim() || undefined }),
      });
      const d = await r.json() as { request?: PendingRequest; error?: string };
      if (!r.ok) throw new Error(d.error ?? 'Could not raise the request.');
      setPending(d.request ?? null);
      setShowModal(false); setReason(''); setConfirmName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not raise the request.');
    } finally { setSubmitting(false); }
  }

  async function cancel() {
    setCancelling(true);
    try {
      const r = await fetch('/api/account/firm-deletion-request', { method: 'DELETE' });
      if (r.ok) setPending(null);
    } finally { setCancelling(false); }
  }

  if (loading) return null;

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const nameMatches = confirmName.trim().toLowerCase() === firmName.trim().toLowerCase();

  return (
    <div className="glass-solid rounded-xl p-6 border border-red-300 dark:border-red-900/50">
      <div className="flex items-center gap-2 mb-1">
        <Building2 size={16} className="text-red-600 dark:text-red-400" />
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Delete entire firm account</h3>
      </div>

      {pending ? (
        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
            <Clock size={14} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-[var(--text-primary)]">Firm deletion requested on {fmt(pending.requested_at)}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                SMITH support will contact you to verify before anything is deleted. You can cancel this request
                until it&rsquo;s processed.
              </p>
            </div>
          </div>
          <button onClick={cancel} disabled={cancelling} className="btn-secondary text-xs shrink-0 disabled:opacity-50">
            {cancelling ? 'Cancelling…' : 'Cancel request'}
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-2xl">
            Permanently delete <strong>{firmName || 'this firm'}</strong> and <strong>all</strong> of its data —
            every team member&rsquo;s account, all clients, documents, outputs and connected services. This ends
            your subscription and <strong>cannot be undone</strong>. To prevent mistakes, the request is verified
            and carried out by SMITH support rather than instantly.
          </p>
          <button
            onClick={() => { setError(''); setShowModal(true); }}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
          >
            <AlertTriangle size={14} /> Request firm deletion
          </button>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={() => !submitting && setShowModal(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><AlertTriangle size={15} /></span>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex-1">Request firm deletion</h2>
              <button onClick={() => !submitting && setShowModal(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
              <p className="text-sm text-slate-600 dark:text-slate-300">
                This requests permanent deletion of the <strong>entire firm</strong> — all users, clients and
                data — and ends your subscription. SMITH support will verify with you before anything is removed.
              </p>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Reason (optional)</span>
                <textarea
                  value={reason} onChange={e => setReason(e.target.value)} rows={2}
                  placeholder="Why are you closing the account?"
                  className="mt-1 w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 outline-none focus:border-red-400 bg-transparent"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Type the firm name <strong>{firmName}</strong> to confirm
                </span>
                <input
                  type="text" value={confirmName} onChange={e => setConfirmName(e.target.value)}
                  className="mt-1 w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-2 outline-none focus:border-red-400 bg-transparent"
                />
              </label>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-end gap-2">
              <button onClick={() => setShowModal(false)} disabled={submitting} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={submit}
                disabled={submitting || !nameMatches}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                {submitting ? 'Requesting…' : 'Request deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
