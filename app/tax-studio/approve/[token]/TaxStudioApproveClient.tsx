'use client';

import { useEffect, useState } from 'react';

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

interface ApprovalData {
  expired: boolean;
  alreadyResponded: boolean;
  approvedAt: string | null;
  changesRequestedAt: string | null;
  changesNote: string | null;
  clientName: string;
  taxYear: string;
  entityLabel: string;
  firmName: string;
  figures: {
    totalIncome: number; personalAllowance: number; taxableIncome: number;
    incomeTax: number; class4Nic: number; studentLoan: number; hicbc: number; capitalGainsTax: number;
    totalDue: number; balancingPayment: number;
    employment: number; trade: number; property: number; savings: number; dividends: number; other: number;
  };
  payments: { balancing: number; poaEach: number; janTotal: number; julTotal: number; janDate: string; julDate: string };
}

export default function TaxStudioApproveClient({ token }: { token: string }) {
  const [data, setData] = useState<ApprovalData | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [mode, setMode] = useState<'view' | 'sign' | 'changes'>('view');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'approve' | 'request_changes' | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/tax-studio/approve/${token}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load this approval.'); return d; })
      .then(setData)
      .catch(e => setLoadErr(e instanceof Error ? e.message : 'Could not load this approval.'));
  }, [token]);

  async function submit(action: 'approve' | 'request_changes') {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/tax-studio/approve/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name: action === 'approve' ? name : undefined, note: action === 'request_changes' ? note : undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Something went wrong.');
      setDone(action);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Arial, Helvetica, sans-serif' }} className="flex justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_10px_40px_rgba(15,23,42,0.12)]">
          <div className="px-7 py-6 text-white" style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }}>
            <p className="text-[13px] font-semibold opacity-90">{data?.firmName || 'Your accountant'}</p>
            <h1 className="mt-0.5 text-[20px] font-bold">Self Assessment {data?.taxYear ?? ''} — for approval</h1>
          </div>

          <div className="px-7 py-6">
            {loadErr ? (
              <Notice tone="err" title="Unable to load" body={loadErr} />
            ) : !data ? (
              <p className="py-10 text-center text-[14px] text-slate-500">Loading…</p>
            ) : done ? (
              <Notice tone="ok" title={done === 'approve' ? 'Thank you — approved' : 'Thank you'} body={done === 'approve' ? 'Your tax return has been approved. Your accountant will now submit it to HMRC.' : 'Your request for changes has been sent to your accountant.'} />
            ) : data.alreadyResponded ? (
              <Notice tone="ok" title={data.approvedAt ? 'Already approved' : 'Changes already requested'} body={data.approvedAt ? 'This return has already been approved.' : (data.changesNote ? `You asked for: ${data.changesNote}` : 'Changes have already been requested for this return.')} />
            ) : data.expired ? (
              <Notice tone="err" title="Link expired" body="This approval link has expired. Please contact your accountant for a new one." />
            ) : (
              <>
                <p className="text-[14px] text-slate-700">Hello {String(data.clientName)}, please review your {data.taxYear} Self Assessment tax return below. The full computation and return are in the PDF attached to the email.</p>

                {/* Income + tax summary */}
                <div className="mt-4 rounded-xl border border-slate-200">
                  <Row label="Total income" value={gbp(data.figures.totalIncome)} />
                  <Row label="Taxable income" value={gbp(data.figures.taxableIncome)} muted />
                  <Row label="Income tax" value={gbp(data.figures.incomeTax)} />
                  {data.figures.class4Nic > 0 && <Row label="Class 4 National Insurance" value={gbp(data.figures.class4Nic)} muted />}
                  {data.figures.studentLoan > 0 && <Row label="Student loan" value={gbp(data.figures.studentLoan)} muted />}
                  {data.figures.hicbc > 0 && <Row label="High Income Child Benefit Charge" value={gbp(data.figures.hicbc)} muted />}
                  {data.figures.capitalGainsTax > 0 && <Row label="Capital gains tax" value={gbp(data.figures.capitalGainsTax)} muted />}
                  <Row label="Total tax & NIC due" value={gbp(data.figures.totalDue)} bold />
                </div>

                {/* Payments */}
                <p className="mt-5 text-[12px] font-bold uppercase tracking-wide text-slate-400">What to pay</p>
                <div className="mt-1.5 space-y-2">
                  <PayCard title={`Due by ${data.payments.janDate}`} amount={gbp(data.payments.janTotal)}
                    detail={data.payments.poaEach > 0 ? `Balancing payment ${gbp(data.payments.balancing)} + first payment on account ${gbp(data.payments.poaEach)}` : `Balancing payment for ${data.taxYear}`} />
                  {data.payments.julTotal > 0 && (
                    <PayCard title={`Due by ${data.payments.julDate}`} amount={gbp(data.payments.julTotal)} detail="Second payment on account towards next year" />
                  )}
                </div>
                <p className="mt-2 text-[11.5px] text-slate-400">How to pay is set out in the attached pack. Pay by the deadline to avoid HMRC interest.</p>

                {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{err}</p>}

                {mode === 'view' && (
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <button onClick={() => setMode('sign')} className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-indigo-700">Approve for submission</button>
                    <button onClick={() => setMode('changes')} className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 text-[14px] font-semibold text-slate-700 transition-colors hover:bg-slate-50">Request changes</button>
                  </div>
                )}

                {mode === 'sign' && (
                  <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                    <p className="text-[13px] font-semibold text-slate-800">Sign to approve</p>
                    <p className="mt-0.5 text-[12.5px] text-slate-600">By typing your full name below you confirm you approve this tax return for submission to HMRC.</p>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-indigo-500" />
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => setMode('view')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600">Back</button>
                      <button onClick={() => submit('approve')} disabled={busy || !name.trim()} className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? 'Submitting…' : 'Confirm approval'}</button>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">Your approval is recorded with your name, the date, and your IP address for audit purposes.</p>
                  </div>
                )}

                {mode === 'changes' && (
                  <div className="mt-5 rounded-xl border border-slate-200 p-4">
                    <p className="text-[13px] font-semibold text-slate-800">Request changes</p>
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Tell your accountant what needs changing…" className="mt-2 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-indigo-500" />
                    <div className="mt-3 flex gap-2">
                      <button onClick={() => setMode('view')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] font-semibold text-slate-600">Back</button>
                      <button onClick={() => submit('request_changes')} disabled={busy} className="flex-1 rounded-lg bg-slate-800 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send request'}</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-slate-400">Prepared by {data?.firmName || 'your accountant'} · This is not an HMRC document.</p>
      </div>
    </div>
  );
}

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${bold ? 'border-t-2 border-slate-200 bg-slate-50' : 'border-t border-slate-100 first:border-t-0'}`}>
      <span className={`text-[13px] ${bold ? 'font-bold text-slate-900' : muted ? 'text-slate-500' : 'text-slate-700'}`}>{label}</span>
      <span className={`text-[13px] ${bold ? 'font-extrabold text-indigo-700' : 'font-semibold text-slate-900'}`}>{value}</span>
    </div>
  );
}

function PayCard({ title, amount, detail }: { title: string; amount: string; detail: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-800">{title}</p>
        <p className="text-[11.5px] text-slate-500">{detail}</p>
      </div>
      <p className="text-[16px] font-extrabold text-indigo-700">{amount}</p>
    </div>
  );
}

function Notice({ tone, title, body }: { tone: 'ok' | 'err'; title: string; body: string }) {
  return (
    <div className={`rounded-xl border px-4 py-5 text-center ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
      <p className={`text-[15px] font-bold ${tone === 'ok' ? 'text-emerald-800' : 'text-rose-800'}`}>{title}</p>
      <p className={`mt-1 text-[13px] ${tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{body}</p>
    </div>
  );
}
