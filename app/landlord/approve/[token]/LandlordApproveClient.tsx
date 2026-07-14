'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, MessageSquareWarning, House } from 'lucide-react';

interface ApprovalSummary {
  expired: boolean;
  already_responded: boolean;
  approved_at: string | null;
  changes_requested_at: string | null;
  changes_note: string | null;
  client_name: string;
  client_code: string;
  firm_name: string;
  /** Set when this is a per-individual report; null for the combined computation. */
  person_name: string | null;
  period_from: string;
  period_to: string;
  totals: { income: number; expenses: number; net: number };
  expires_at: string | null;
}

function fmtMoney(amount: number): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch { return `£${amount.toFixed(2)}`; }
}

function fmtDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return (y && m && d) ? `${d}-${m}-${y}` : iso;
}

export default function LandlordApproveClient({ token }: { token: string }) {
  const [data, setData] = useState<ApprovalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);       // showing the changes note box
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | 'approve' | 'request_changes'>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/landlord/approve/${token}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error ?? 'Failed to load approval');
        const s = j as ApprovalSummary;
        setData(s);
        if (s.approved_at) setDone('approve');
        if (s.changes_requested_at) setDone('request_changes');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submit(action: 'approve' | 'request_changes') {
    if (action === 'request_changes' && !note.trim()) { setError('Please tell us what needs changing.'); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/landlord/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: action === 'request_changes' ? note.trim() : null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Failed to submit');
      setDone(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-slate-50 flex items-start justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2 mb-4 text-slate-500">
          <span className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center"><House size={16} className="text-slate-600" /></span>
          <span className="text-sm font-medium">{data?.firm_name || 'Your accountant'}</span>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">{children}</div>
        <p className="text-[11px] text-slate-400 text-center mt-4">
          This link is personal to you. If you weren&apos;t expecting it, please contact {data?.firm_name || 'your accountant'}.
        </p>
      </div>
    </div>
  );

  if (loading) {
    return <Shell><div className="p-10 text-center text-slate-500"><Loader2 size={20} className="animate-spin mx-auto mb-3" />Loading…</div></Shell>;
  }

  if (error && !data) {
    return (
      <Shell>
        <div className="p-10 text-center">
          <AlertTriangle size={24} className="text-amber-500 mx-auto mb-3" />
          <p className="text-sm text-slate-700">{error}</p>
        </div>
      </Shell>
    );
  }
  if (!data) return null;

  // Already responded (either this visit or a previous one).
  if (done) {
    const approved = done === 'approve';
    return (
      <Shell>
        <div className="p-10 text-center">
          <div className={`w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center ${approved ? 'bg-emerald-100' : 'bg-amber-100'}`}>
            {approved ? <CheckCircle2 size={22} className="text-emerald-600" /> : <MessageSquareWarning size={22} className="text-amber-600" />}
          </div>
          <p className="font-semibold text-slate-900 mb-1">{approved ? 'Thank you — approved' : 'Thank you — we’ll be in touch'}</p>
          <p className="text-sm text-slate-500">
            {approved
              ? `Your property income computation for ${fmtDateUk(data.period_from)} to ${fmtDateUk(data.period_to)} has been approved.`
              : 'Your change request has been sent to your accountant.'}
          </p>
          {!approved && data.changes_note && (
            <p className="text-xs text-slate-500 mt-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-left whitespace-pre-wrap">{data.changes_note}</p>
          )}
        </div>
      </Shell>
    );
  }

  if (data.expired) {
    return (
      <Shell>
        <div className="p-10 text-center">
          <AlertTriangle size={24} className="text-amber-500 mx-auto mb-3" />
          <p className="font-semibold text-slate-900 mb-1">This link has expired</p>
          <p className="text-sm text-slate-500">Please contact {data.firm_name || 'your accountant'} for a fresh copy.</p>
        </div>
      </Shell>
    );
  }

  const net = data.totals.net;
  return (
    <Shell>
      <div className="px-6 py-5 border-b border-slate-200">
        <h1 className="text-lg font-semibold text-slate-900">Property income computation</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {data.person_name ? <><span className="font-medium text-slate-700">{data.person_name}</span> · </> : null}
          {data.client_name}{data.client_code ? ` (${data.client_code})` : ''}
        </p>
        <p className="text-xs text-slate-400 mt-1">{fmtDateUk(data.period_from)} to {fmtDateUk(data.period_to)}</p>
      </div>

      <div className="px-6 py-5">
        <p className="text-sm text-slate-600 mb-4">
          Please review the figures below{data.person_name ? ' — these are your share' : ''}. The full computation is attached to the email we sent you.
        </p>

        <div className="rounded-xl border border-slate-200 overflow-hidden mb-5">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <span className="text-sm text-slate-600">Total income</span>
            <span className="text-sm font-medium text-emerald-700 tabular-nums">{fmtMoney(data.totals.income)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <span className="text-sm text-slate-600">Total expenses</span>
            <span className="text-sm font-medium text-rose-600 tabular-nums">{fmtMoney(data.totals.expenses)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
            <span className="text-sm font-semibold text-slate-900">Net {net >= 0 ? 'profit' : 'loss'}</span>
            <span className={`text-sm font-bold tabular-nums ${net >= 0 ? 'text-slate-900' : 'text-rose-600'}`}>{fmtMoney(Math.abs(net))}</span>
          </div>
        </div>

        {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

        {asking ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">What needs changing?</span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={4}
                autoFocus
                placeholder="e.g. the insurance figure looks too high, and a repair in June is missing."
                className="mt-1 w-full text-sm border border-slate-300 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-slate-300"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setAsking(false); setError(null); }} disabled={submitting} className="px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">Back</button>
              <button onClick={() => void submit('request_changes')} disabled={submitting || !note.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : <MessageSquareWarning size={14} />} Send change request
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button onClick={() => setAsking(true)} disabled={submitting}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <MessageSquareWarning size={15} /> Request changes
            </button>
            <button onClick={() => void submit('approve')} disabled={submitting}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Approve
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}
