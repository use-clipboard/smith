'use client';

import { useEffect, useState } from 'react';
import { Trash2, Loader2, AlertTriangle, Check } from 'lucide-react';

interface DeletionRequest {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  reason: string | null;
  requested_at: string;
}

/**
 * Admin panel listing pending account-deletion requests for the firm. Renders
 * nothing when there are none, so it stays invisible until a request comes in.
 * `onCompleted` lets the parent (TeamTab) reload the member list after a
 * deletion removes the user.
 */
export default function DeletionRequestsPanel({ onCompleted }: { onCompleted?: () => void }) {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/account/deletion-requests');
        const d = await r.json() as { requests?: DeletionRequest[] };
        setRequests(d.requests ?? []);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  async function complete(req: DeletionRequest) {
    const who = req.user_name || req.user_email || 'this user';
    if (!confirm(`Permanently delete ${who}'s account and personal data? This cannot be undone.`)) return;
    setBusyId(req.id); setError('');
    try {
      const r = await fetch(`/api/account/deletion-requests/${req.id}/complete`, { method: 'POST' });
      const d = await r.json() as { error?: string };
      if (!r.ok) throw new Error(d.error ?? 'Deletion failed.');
      setRequests(prev => prev.filter(x => x.id !== req.id));
      onCompleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deletion failed.');
    } finally { setBusyId(null); }
  }

  if (loading || requests.length === 0) return null;

  const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="glass-solid rounded-xl p-6 border border-red-200 dark:border-red-900/40 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
        <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
          Account deletion requests ({requests.length})
        </h3>
      </div>

      <div className="text-xs text-[var(--text-muted)] bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg p-3">
        <p className="font-medium text-[var(--text-secondary)] mb-1">Completing a request will:</p>
        <ul className="space-y-0.5">
          <li className="flex items-start gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-red-500" /> Revoke the user&rsquo;s Google (Gmail &amp; Calendar) access at Google</li>
          <li className="flex items-start gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-red-500" /> Permanently delete their account, profile and personal data (notes, reminders, chat, notifications)</li>
          <li className="flex items-start gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-red-500" /> Keep shared client/firm records (work outputs are retained, attributed to no user)</li>
        </ul>
        <p className="mt-1.5">Honour requests within <strong>30 days</strong> (privacy policy commitment).</p>
      </div>

      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="space-y-2">
        {requests.map(req => (
          <div key={req.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {req.user_name || req.user_email || 'Unknown user'}
              </p>
              {req.user_email && req.user_name && (
                <p className="text-xs text-[var(--text-muted)] truncate">{req.user_email}</p>
              )}
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Requested {fmt(req.requested_at)}</p>
              {req.reason && <p className="text-xs text-[var(--text-secondary)] mt-1 italic">&ldquo;{req.reason}&rdquo;</p>}
              {!req.user_id && <p className="text-[11px] text-amber-600 mt-0.5">User already removed — completing just closes the request.</p>}
            </div>
            <button
              onClick={() => complete(req)}
              disabled={busyId === req.id}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors shrink-0"
            >
              {busyId === req.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {busyId === req.id ? 'Deleting…' : 'Complete deletion'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
