'use client';

/**
 * LandlordApprovalPanel — step 5 status. Lists the live approval requests for a
 * saved analysis and their state. Built to handle one row (the combined
 * computation) or one per individual, so the "n of m approved" count already
 * works for the per-individual send.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, MessageSquareWarning, Loader2, Send } from 'lucide-react';

interface ApprovalRow {
  id: string;
  person_key: string | null;
  person_name: string | null;
  recipient_email: string;
  sent_at: string;
  expires_at: string | null;
  approved_at: string | null;
  changes_requested_at: string | null;
  changes_note: string | null;
  status: 'approved' | 'changes_requested' | 'pending';
}

const fmtDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
};

export default function LandlordApprovalPanel({
  outputId, clientName, refreshKey, onSend,
}: {
  outputId: string | null;
  clientId: string | null;
  clientName: string;
  clientRef: string | null;
  refreshKey?: number;
  onSend: () => void;
}) {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!outputId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/landlord/outputs/${outputId}/approvals`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not load approvals');
      setRows((d.approvals ?? []) as ApprovalRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load approvals');
    } finally {
      setLoading(false);
    }
  }, [outputId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const approved = rows.filter(r => r.status === 'approved').length;

  return (
    <div className="glass-solid rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={15} className="text-[var(--accent)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Client approval</p>
          {rows.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">{approved} of {rows.length} approved</span>
          )}
        </div>
        <button onClick={onSend} disabled={!outputId} className="btn-primary text-xs py-1.5 disabled:opacity-50">
          <Send size={12} /> {rows.length > 0 ? 'Send again' : 'Send for approval'}
        </button>
      </div>

      <div className="p-5">
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        {loading ? (
          <p className="text-sm text-[var(--text-muted)] flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading…</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-6">
            <Send size={22} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">Not sent yet.</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Send {clientName || 'the client'} the computation to approve. They get the PDF and a link to approve or request changes.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(r => {
              const tone = r.status === 'approved'
                ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-900/10'
                : r.status === 'changes_requested'
                  ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/10'
                  : 'border-[var(--border)]';
              return (
                <div key={r.id} className={`rounded-lg border px-4 py-3 ${tone}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {r.person_name || 'Combined computation'}
                        <span className="text-xs font-normal text-[var(--text-muted)]"> · {r.recipient_email}</span>
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Sent {fmtDateTime(r.sent_at)}</p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0">
                      {r.status === 'approved' && <><CheckCircle2 size={13} className="text-emerald-600" /><span className="text-emerald-700 dark:text-emerald-400">Approved {r.approved_at ? fmtDateTime(r.approved_at) : ''}</span></>}
                      {r.status === 'changes_requested' && <><MessageSquareWarning size={13} className="text-amber-600" /><span className="text-amber-700 dark:text-amber-400">Changes requested</span></>}
                      {r.status === 'pending' && <><Clock size={13} className="text-[var(--text-muted)]" /><span className="text-[var(--text-muted)]">Awaiting response</span></>}
                    </span>
                  </div>
                  {r.status === 'changes_requested' && r.changes_note && (
                    <p className="text-xs text-amber-800 dark:text-amber-300 mt-2 whitespace-pre-wrap bg-white/60 dark:bg-black/10 border border-amber-200 dark:border-amber-900/40 rounded px-2.5 py-2">
                      “{r.changes_note}”
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-[var(--text-muted)] pt-1">
              Re-sending replaces the pending link for that recipient — earlier requests stay in the audit trail.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
