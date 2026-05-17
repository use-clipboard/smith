'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2, Loader2, AlertTriangle, MessageSquareWarning,
  CalendarCheck, FileText,
} from 'lucide-react';
import { formatDateUk } from '@/lib/mtdIt/dateFormat';

interface ApprovalSummary {
  expired: boolean;
  already_responded: boolean;
  approved_at: string | null;
  changes_requested_at: string | null;
  changes_note: string | null;
  client_name: string;
  client_code: string;
  firm_name: string;
  tax_year_label: string;
  quarter_label: string;
  period_from: string;
  period_to: string;
  totals: Record<string, { income: number; expense: number }>;
  expires_at: string | null;
}

const STREAM_LABEL: Record<string, string> = {
  sole:           'Sole Trader',
  uk_rental:      'UK Rental',
  foreign_rental: 'Foreign Rental',
};

function fmtMoney(amount: number): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: 'GBP',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch { return `£${amount.toFixed(2)}`; }
}

export default function MtdItApproveClient({ token }: { token: string }) {
  const [data,     setData]     = useState<ApprovalSummary | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [action,   setAction]   = useState<null | 'approve' | 'request_changes'>(null);
  const [note,     setNote]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done,     setDone]     = useState<null | 'approve' | 'request_changes'>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/mtd-it/approve/${token}`);
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? 'Failed to load approval');
        }
        const j = await res.json() as ApprovalSummary;
        setData(j);
        if (j.approved_at)          setDone('approve');
        if (j.changes_requested_at) setDone('request_changes');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submit(which: 'approve' | 'request_changes') {
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/approve/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: which, note: which === 'request_changes' ? note : null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Failed to submit');
      setDone(which);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Layout chrome ──────────────────────────────────────────────────
  const wrapper = 'min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-12 px-4';
  const card = 'mx-auto max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden';

  if (loading) {
    return (
      <div className={wrapper}>
        <div className={card}>
          <div className="py-20 text-center text-gray-500">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Loading…
          </div>
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className={wrapper}>
        <div className={card}>
          <div className="px-6 py-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto">
              <AlertTriangle size={22} className="text-red-600" />
            </div>
            <h1 className="text-lg font-semibold text-gray-900">Approval link not available</h1>
            <p className="text-sm text-gray-600 max-w-md mx-auto">{error ?? 'We couldn\'t load this approval. Please contact your accountant.'}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── "Already responded" view ──────────────────────────────────────
  if (done || data.already_responded) {
    const wasApproved = done === 'approve' || (!done && !!data.approved_at);
    return (
      <div className={wrapper}>
        <div className={card}>
          <Header firmName={data.firm_name} />
          <div className="px-6 py-10 text-center space-y-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${wasApproved ? 'bg-green-50' : 'bg-amber-50'}`}>
              {wasApproved ? <CheckCircle2 size={32} className="text-green-600" /> : <MessageSquareWarning size={32} className="text-amber-600" />}
            </div>
            <h1 className="text-xl font-semibold text-gray-900">
              {wasApproved ? 'Thank you — approval recorded.' : 'Thanks — your accountant has been notified.'}
            </h1>
            <p className="text-sm text-gray-600 max-w-lg mx-auto">
              {wasApproved
                ? `Your MTD IT figures for ${data.quarter_label} of ${data.tax_year_label} have been approved. ${data.firm_name || 'Your accountant'} can now proceed with the HMRC submission.`
                : `${data.firm_name || 'Your accountant'} will review the changes you requested and get back to you shortly.`}
            </p>
            <ClientLine data={data} />
          </div>
        </div>
      </div>
    );
  }

  // ── Expired view ──────────────────────────────────────────────────
  if (data.expired) {
    return (
      <div className={wrapper}>
        <div className={card}>
          <Header firmName={data.firm_name} />
          <div className="px-6 py-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto">
              <AlertTriangle size={22} className="text-amber-600" />
            </div>
            <h1 className="text-lg font-semibold text-gray-900">This approval link has expired.</h1>
            <p className="text-sm text-gray-600 max-w-lg mx-auto">
              For your security, approval links are valid for 30 days. Please contact {data.firm_name || 'your accountant'} for a fresh link.
            </p>
            <ClientLine data={data} />
          </div>
        </div>
      </div>
    );
  }

  // ── Default review view ──────────────────────────────────────────
  return (
    <div className={wrapper}>
      <div className={card}>
        <Header firmName={data.firm_name} />

        <div className="px-6 py-6 space-y-5">
          {/* Client + period */}
          <div className="text-center">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">For approval</div>
            <h1 className="text-xl font-semibold text-gray-900 mt-1">
              {data.client_name}{data.client_code ? <span className="text-gray-400 font-normal">  ·  {data.client_code}</span> : null}
            </h1>
            <div className="text-sm text-gray-600 mt-1">
              MTD IT — {data.quarter_label} of {data.tax_year_label}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              <CalendarCheck size={11} className="inline mr-1" />
              {formatDateUk(data.period_from)} → {formatDateUk(data.period_to)}
            </div>
          </div>

          {/* Summary by stream */}
          {Object.keys(data.totals).length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left  px-4 py-2 font-medium text-gray-700 text-xs uppercase tracking-wide">Stream</th>
                    <th className="text-right px-4 py-2 font-medium text-green-700 text-xs uppercase tracking-wide">Income</th>
                    <th className="text-right px-4 py-2 font-medium text-red-700 text-xs uppercase tracking-wide">Expense</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-700 text-xs uppercase tracking-wide">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(data.totals).map(([stream, t]) => (
                    <tr key={stream}>
                      <td className="px-4 py-2 text-gray-800">{STREAM_LABEL[stream] ?? stream}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-green-700">{fmtMoney(t.income)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-red-700">{fmtMoney(t.expense)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtMoney(t.income - t.expense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-500 text-center">
            <FileText size={11} className="inline mr-1" />
            Full figures + entries are in the PDF attached to the email we sent you.
          </p>

          {/* Error inline */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
            </div>
          )}

          {/* Action area — either approve flow or request-changes flow */}
          {action === 'request_changes' ? (
            <div className="space-y-3">
              <label className="block">
                <span className="block text-sm font-medium text-gray-700 mb-1">What needs to change?</span>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={4}
                  placeholder="Tell your accountant what's wrong so they can amend the figures before resubmission."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </label>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => { setAction(null); setNote(''); }}
                  disabled={submitting}
                  className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >Back</button>
                <button
                  onClick={() => submit('request_changes')}
                  disabled={submitting || !note.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50"
                >
                  {submitting && <Loader2 size={14} className="animate-spin" />}
                  Send change request
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                onClick={() => submit('approve')}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-[var(--accent)] hover:opacity-90 text-white rounded-xl disabled:opacity-50 shadow-sm"
              >
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                Approve for HMRC submission
              </button>
              <button
                onClick={() => setAction('request_changes')}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-xl"
              >
                <MessageSquareWarning size={15} /> Request changes
              </button>
            </div>
          )}

          <ClientLine data={data} />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────
function Header({ firmName }: { firmName: string }) {
  return (
    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-5 text-white">
      <div className="text-[10px] uppercase tracking-widest font-semibold opacity-80">MTD IT — Quarterly Approval</div>
      <div className="text-lg font-semibold mt-0.5">{firmName || 'Your accountant'}</div>
    </div>
  );
}

function ClientLine({ data }: { data: ApprovalSummary }) {
  return (
    <p className="text-[11px] text-gray-400 text-center pt-2">
      Reviewing for <strong className="font-medium text-gray-600">{data.client_name}</strong>
      {data.client_code ? ` (${data.client_code})` : ''}
      {' · '}{data.quarter_label} {data.tax_year_label}
    </p>
  );
}
