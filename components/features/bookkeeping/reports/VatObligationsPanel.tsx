'use client';

/**
 * VatObligationsPanel — the "Obligations" sub-tab on the VAT return screen.
 *
 * Pulls the OPEN VAT obligations HMRC has on record for this book's VRN and
 * lists them, each with a one-click "Use this period" that drops the dates into
 * the period selector so the user files exactly the period HMRC is asking for.
 */

import { useEffect, useState } from 'react';
import { Loader2, CalendarClock, ArrowRight, RefreshCw, AlertCircle } from 'lucide-react';
import { collectFraudData, HMRC_OBLIGATION_SCENARIOS } from '@/lib/hmrc/clientFraudData';

interface Obligation { periodKey: string; start: string; end: string; due: string; status: string }
interface Status { configured: boolean; environment: string; vatNumber: string | null; connection: { kind: string; status: string } | null }

function uk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export default function VatObligationsPanel({
  bookId, onUsePeriod,
}: {
  bookId: string;
  onUsePeriod: (from: string, to: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [obligations, setObligations] = useState<Obligation[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testScenario, setTestScenario] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/mtd/status`);
      const d = await r.json().catch(() => ({}));
      if (cancelled) return;
      setStatus(r.ok ? d as Status : null);
      if (r.ok && (d as Status).connection?.status === 'connected') void load((d as Status).environment);
      else setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(_env?: string) {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/mtd/obligations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraudData: collectFraudData(), testScenario }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not load obligations from HMRC.');
      setObligations((d.obligations ?? []) as Obligation[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load obligations.');
      setObligations([]);
    } finally { setLoading(false); }
  }

  const connected = status?.connection?.status === 'connected';

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
            <CalendarClock size={14} className="text-indigo-600" /> Open obligations
          </h3>
          <p className="text-xs text-slate-500">VAT periods HMRC has open for this client. Pick one to file exactly that period.</p>
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            {status?.environment === 'sandbox' && (
              <select value={testScenario} onChange={e => setTestScenario(e.target.value)} title="Sandbox test scenario" className="text-[11px] border border-slate-200 rounded px-1.5 py-1 text-slate-600 bg-white outline-none">
                {HMRC_OBLIGATION_SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            )}
            <button type="button" onClick={() => load()} disabled={loading} className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {!status?.configured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 inline-flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> MTD isn’t switched on for this environment yet.
        </div>
      ) : !connected ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center">
          <CalendarClock size={22} className="mx-auto text-slate-300 mb-1.5" />
          <p className="text-sm text-slate-700">Connect SMITH to HMRC to see open obligations.</p>
          <p className="text-xs text-slate-500 mt-0.5">Use <strong>Submit to HMRC</strong> at the top of this screen to connect.</p>
        </div>
      ) : loading ? (
        <div className="text-sm text-slate-400 inline-flex items-center gap-2 px-1 py-4"><Loader2 size={14} className="animate-spin" /> Loading from HMRC…</div>
      ) : !obligations || obligations.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          No open obligations returned by HMRC for this VRN.
          {status?.environment === 'sandbox' && <span className="block text-xs text-slate-400 mt-1">Try a sandbox test scenario above to generate current periods.</span>}
        </div>
      ) : (
        <ul className="space-y-2">
          {obligations.map(o => (
            <li key={o.periodKey} className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900">{uk(o.start)} → {uk(o.end)}</p>
                <p className="text-[11px] text-slate-500">Due {uk(o.due)} · period key {o.periodKey}</p>
              </div>
              <button type="button" onClick={() => onUsePeriod(o.start, o.end)} className="text-xs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                Use this period <ArrowRight size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-slate-400">In MTD, HMRC defines the periods you can file. Filing the matching obligation keeps SMITH and HMRC in step.</p>
    </div>
  );
}
