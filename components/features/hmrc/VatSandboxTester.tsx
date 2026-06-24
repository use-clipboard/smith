'use client';

/**
 * VatSandboxTester — admin dev/compliance harness for HMRC VAT (MTD).
 *
 * Exercises the real VAT endpoints HMRC's Production Approvals Checklist asks
 * for, against a VRN (default the sandbox test VRN): connect via OAuth →
 * retrieve obligations (with Gov-Test-Scenario) → submit a return for the open
 * period. Uses the same hmrcRequest path + fraud headers as live submissions,
 * so a clean run here is the evidence to file with HMRC. Keep it on SANDBOX —
 * a real submission is irreversible.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link2, Loader2, AlertCircle, CheckCircle2, Download, Send } from 'lucide-react';
import { collectFraudData, HMRC_OBLIGATION_SCENARIOS } from '@/lib/hmrc/clientFraudData';

interface Status { env: string; configured: boolean; connected: boolean; kind: string | null; vrn: string | null }
interface Obligation { periodKey?: string; start?: string; end?: string; due?: string; status?: string; received?: string }

const DEFAULT_VRN = '373778212';
const BOX_DEFAULTS = {
  vatDueSales: 100, vatDueAcquisitions: 0, vatReclaimedCurrPeriod: 20,
  totalValueSalesExVAT: 1000, totalValuePurchasesExVAT: 200,
  totalValueGoodsSuppliedExVAT: 0, totalAcquisitionsExVAT: 0,
};

function ukDate(iso?: string) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export default function VatSandboxTester() {
  const [vrn, setVrn] = useState(DEFAULT_VRN);
  const [status, setStatus] = useState<Status | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [scenario, setScenario] = useState('');
  const [obligations, setObligations] = useState<Obligation[] | null>(null);
  const [oblBusy, setOblBusy] = useState(false);
  const [oblError, setOblError] = useState<string | null>(null);

  const [periodKey, setPeriodKey] = useState('');
  const [boxes, setBoxes] = useState(BOX_DEFAULTS);
  const [finalised, setFinalised] = useState(true);
  const [subBusy, setSubBusy] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<unknown>(null);

  // Derived boxes (HMRC validates box3 = box1+box2, box5 = |box3-box4|).
  const box3 = +(boxes.vatDueSales + boxes.vatDueAcquisitions).toFixed(2);
  const box5 = +Math.abs(box3 - boxes.vatReclaimedCurrPeriod).toFixed(2);

  const loadStatus = useCallback(() => {
    fetch('/api/hmrc/vat-test/status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
    const q = new URLSearchParams(window.location.search).get('hmrc');
    if (q === 'connected') setBanner('Connected to HMRC (VAT).');
    else if (q === 'denied') setBanner('HMRC connection was denied.');
    else if (q && q !== 'connected') setBanner(`HMRC connection problem: ${q}.`);
  }, [loadStatus]);

  function connect() {
    window.location.href = '/api/hmrc/connect?service=vat&kind=agent&returnTo=/hmrc-vat-test';
  }

  async function retrieveObligations() {
    setOblBusy(true); setOblError(null); setObligations(null);
    try {
      const r = await fetch('/api/hmrc/vat-test/obligations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vrn, status: 'O', testScenario: scenario || undefined, fraudData: collectFraudData() }),
      });
      const d = await r.json();
      if (!r.ok) { setOblError(d.error ?? 'Failed to retrieve obligations.'); return; }
      const raw = d.raw as { obligations?: Obligation[] };
      setObligations(raw?.obligations ?? []);
    } catch (e) { setOblError(String(e)); } finally { setOblBusy(false); }
  }

  async function submitReturn() {
    if (!periodKey) { setSubError('Pick a period key first (from the obligations above, or type one).'); return; }
    setSubBusy(true); setSubError(null); setSubResult(null);
    try {
      const r = await fetch('/api/hmrc/vat-test/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vrn, periodKey, finalised,
          boxes: {
            vatDueSales: boxes.vatDueSales, vatDueAcquisitions: boxes.vatDueAcquisitions, totalVatDue: box3,
            vatReclaimedCurrPeriod: boxes.vatReclaimedCurrPeriod, netVatDue: box5,
            totalValueSalesExVAT: boxes.totalValueSalesExVAT, totalValuePurchasesExVAT: boxes.totalValuePurchasesExVAT,
            totalValueGoodsSuppliedExVAT: boxes.totalValueGoodsSuppliedExVAT, totalAcquisitionsExVAT: boxes.totalAcquisitionsExVAT,
          },
          fraudData: collectFraudData(),
        }),
      });
      const d = await r.json();
      if (!r.ok) { setSubError(d.error ?? 'Submission failed.'); setSubResult(d.raw ?? null); return; }
      setSubResult(d.raw);
    } catch (e) { setSubError(String(e)); } finally { setSubBusy(false); }
  }

  const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const setBox = (k: keyof typeof BOX_DEFAULTS, v: string) => setBoxes(b => ({ ...b, [k]: num(v) }));

  const isSandbox = status?.env === 'sandbox';

  return (
    <div className="max-w-3xl space-y-4">
      {banner && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-800">{banner}</div>
      )}

      {/* ── Connection ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">1 · HMRC connection</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {status
                ? status.connected
                  ? <>Connected · {status.kind} · {status.env}{status.vrn ? ` · VRN ${status.vrn}` : ''}</>
                  : <>Not connected · {status.env}{!status.configured ? ' · credentials not set' : ''}</>
                : 'Checking…'}
            </p>
          </div>
          <button onClick={connect} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 shrink-0">
            <Link2 size={14} /> {status?.connected ? 'Reconnect' : 'Connect VAT'}
          </button>
        </div>
        {!isSandbox && status && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={13} className="mt-0.5 shrink-0" /> Environment is <strong>{status.env}</strong> — a submission here is a REAL filing. Switch HMRC_ENV to sandbox for testing.
          </div>
        )}
      </div>

      {/* ── Obligations ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">2 · Retrieve obligations</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-600">
            <span className="block mb-1 font-medium">VRN</span>
            <input value={vrn} onChange={e => setVrn(e.target.value.replace(/\D/g, '').slice(0, 9))} className="w-36 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-mono" />
          </label>
          <label className="text-xs text-slate-600 flex-1 min-w-[180px]">
            <span className="block mb-1 font-medium">Gov-Test-Scenario (sandbox)</span>
            <select value={scenario} onChange={e => setScenario(e.target.value)} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm">
              {HMRC_OBLIGATION_SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <button onClick={() => void retrieveObligations()} disabled={oblBusy || !status?.connected} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {oblBusy ? <><Loader2 size={14} className="animate-spin" /> …</> : <><Download size={14} /> Retrieve</>}
          </button>
        </div>

        {oblError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{oblError}</div>}

        {obligations && (
          obligations.length === 0
            ? <p className="text-xs text-slate-500">No open obligations returned. In sandbox, pick a Gov-Test-Scenario (e.g. “one filed”) to get an open period.</p>
            : (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr><th className="px-2 py-1.5 text-left">Period</th><th className="px-2 py-1.5 text-left">Due</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-left">Period key</th><th className="px-2 py-1.5"></th></tr>
                  </thead>
                  <tbody>
                    {obligations.map((o, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 tabular-nums">{ukDate(o.start)} – {ukDate(o.end)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{ukDate(o.due)}</td>
                        <td className="px-2 py-1.5">{o.status === 'O' ? 'Open' : o.status === 'F' ? 'Fulfilled' : o.status}</td>
                        <td className="px-2 py-1.5 font-mono">{o.periodKey}</td>
                        <td className="px-2 py-1.5 text-right">
                          {o.periodKey && o.status === 'O' && (
                            <button onClick={() => setPeriodKey(o.periodKey!)} className="text-indigo-600 hover:underline">Use →</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        )}
      </div>

      {/* ── Submit ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">3 · Submit return</h2>
        <label className="text-xs text-slate-600 block">
          <span className="block mb-1 font-medium">Period key</span>
          <input value={periodKey} onChange={e => setPeriodKey(e.target.value)} placeholder="e.g. 18A1" className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-mono" />
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {([
            ['vatDueSales', 'Box 1 · VAT due (sales)'],
            ['vatDueAcquisitions', 'Box 2 · VAT due (acquisitions)'],
            ['vatReclaimedCurrPeriod', 'Box 4 · VAT reclaimed'],
            ['totalValueSalesExVAT', 'Box 6 · Sales ex-VAT'],
            ['totalValuePurchasesExVAT', 'Box 7 · Purchases ex-VAT'],
            ['totalValueGoodsSuppliedExVAT', 'Box 8 · Goods supplied'],
            ['totalAcquisitionsExVAT', 'Box 9 · Acquisitions'],
          ] as [keyof typeof BOX_DEFAULTS, string][]).map(([k, label]) => (
            <label key={k} className="text-[11px] text-slate-600">
              <span className="block mb-0.5">{label}</span>
              <input type="number" step="0.01" value={boxes[k]} onChange={e => setBox(k, e.target.value)} className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm tabular-nums" />
            </label>
          ))}
          <label className="text-[11px] text-slate-500">
            <span className="block mb-0.5">Box 3 · Total VAT due (auto)</span>
            <input disabled value={box3.toFixed(2)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums" />
          </label>
          <label className="text-[11px] text-slate-500">
            <span className="block mb-0.5">Box 5 · Net VAT due (auto)</span>
            <input disabled value={box5.toFixed(2)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-sm tabular-nums" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={finalised} onChange={e => setFinalised(e.target.checked)} className="accent-indigo-600" />
          <span><span className="font-medium">finalised</span> — declares the figures are final (HMRC requires true to accept the return)</span>
        </label>

        <button onClick={() => void submitReturn()} disabled={subBusy || !status?.connected} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {subBusy ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : <><Send size={14} /> Submit return</>}
        </button>

        {subError && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">{subError}</div>}

        {subResult != null && !subError && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 flex items-start gap-2">
            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 shrink-0" />
            <div>Return accepted by HMRC. Keep the <strong>formBundleNumber</strong> below as your evidence.</div>
          </div>
        )}
        {subResult != null && (
          <details className="text-xs" open>
            <summary className="cursor-pointer text-slate-500 hover:text-slate-800">HMRC response</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{JSON.stringify(subResult, null, 2)}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
