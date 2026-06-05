'use client';

/**
 * MtdSubmitModal — "Submit to HMRC (MTD)" on the VAT return screen.
 *
 * Flow: readiness (VAT reg · VRN · HMRC connected) → connect (agent/business) →
 * pick the open obligation → confirm the 9 boxes + finalised declaration →
 * submit → show HMRC's receipt. All VAT API calls carry fraud-prevention
 * headers built from data collected here in the browser.
 *
 * In SANDBOX this submits against your HMRC test user — a real end-to-end
 * submission with a real receipt, but no live filing. Submission is one-way.
 */

import { useEffect, useState } from 'react';
import {
  X, Loader2, Check, AlertCircle, Building2, ShieldCheck, ExternalLink, Send, RefreshCw,
} from 'lucide-react';
import { collectFraudData, HMRC_OBLIGATION_SCENARIOS } from '@/lib/hmrc/clientFraudData';

interface Status {
  configured: boolean;
  environment: string;
  vatRegistered: boolean;
  vatNumber: string | null;
  connection: { kind: 'agent' | 'business'; status: string } | null;
}
interface Obligation { periodKey: string; start: string; end: string; due: string; status: string }
interface Receipt { processingDate?: string; formBundleNumber?: string; paymentIndicator?: string; chargeRefNumber?: string }
interface Boxes { box1: number; box2: number; box3: number; box4: number; box5: number; box6: number; box7: number; box8: number; box9: number }

function uk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}
const money = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function CheckRow({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
        {ok ? <Check size={12} /> : <AlertCircle size={12} />}
      </span>
      <div className="min-w-0">
        <p className={`text-sm ${ok ? 'text-slate-800' : 'text-slate-600'}`}>{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
    </li>
  );
}

export default function MtdSubmitModal({
  bookId, fromIso, toIso, boxes, lateEntryVat, onClose, onSubmitted,
}: {
  bookId: string;
  fromIso: string;
  toIso: string;
  boxes: Boxes;
  lateEntryVat: number;
  onClose: () => void;
  /** Fired after a successful submission so the parent can refresh the filings list. */
  onSubmitted?: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [vrnInput, setVrnInput] = useState('');
  const [savingVrn, setSavingVrn] = useState(false);
  const [error, setError] = useState('');

  const [obligations, setObligations] = useState<Obligation[] | null>(null);
  const [oblLoading, setOblLoading] = useState(false);
  const [testScenario, setTestScenario] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  // Figures recomputed for the SELECTED obligation's period (the period HMRC has
  // open), so what's shown + submitted always matches the obligation being filed.
  const [oblBoxes, setOblBoxes] = useState<Boxes | null>(null);
  const [oblBoxesLoading, setOblBoxesLoading] = useState(false);
  const [finalised, setFinalised] = useState(false);
  const [lockPeriod, setLockPeriod] = useState(true);
  const [postJournal, setPostJournal] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/mtd/status`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setStatus(d as Status); setVrnInput((d.vatNumber ?? '').replace(/\s/g, '')); }
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadStatus(); }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const vrnOk = !!status?.vatNumber && /^\d{9}$/.test(status.vatNumber.replace(/\s/g, ''));
  const connected = status?.connection?.status === 'connected';

  // Once connected + VRN set, pull the open obligations.
  useEffect(() => {
    if (!connected || !vrnOk || obligations !== null) return;
    void loadObligations();
  }, [connected, vrnOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedObl = obligations?.find(o => o.periodKey === selectedKey) ?? null;

  // Recompute the figures for the selected obligation's period.
  useEffect(() => {
    if (!selectedObl) { setOblBoxes(null); return; }
    let cancelled = false;
    setOblBoxesLoading(true);
    fetch(`/api/bookkeeping/books/${bookId}/vat-return?from=${selectedObl.start}&to=${selectedObl.end}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d?.boxes) return;
        const b = d.boxes;
        setOblBoxes({
          box1: b.box1.value, box2: b.box2.value, box3: b.box3.value, box4: b.box4.value, box5: b.box5.value,
          box6: b.box6.value, box7: b.box7.value, box8: b.box8.value, box9: b.box9.value,
        });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOblBoxesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedObl?.periodKey, bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadObligations() {
    setOblLoading(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/mtd/obligations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraudData: collectFraudData(), testScenario }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not load obligations from HMRC.');
      const list = (d.obligations ?? []) as Obligation[];
      setObligations(list);
      if (list.length === 1) setSelectedKey(list[0].periodKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load obligations.');
      setObligations([]);
    } finally { setOblLoading(false); }
  }

  async function saveVrn() {
    const vrn = vrnInput.replace(/\s/g, '');
    if (!/^\d{9}$/.test(vrn)) { setError('A VRN is 9 digits.'); return; }
    setSavingVrn(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vat_number: vrn }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error ?? 'Could not save the VRN.'); }
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the VRN.');
    } finally { setSavingVrn(false); }
  }

  function connect(kind: 'agent' | 'business') {
    window.location.href = `/api/hmrc/connect?kind=${kind}&bookId=${encodeURIComponent(bookId)}`;
  }
  async function disconnect() {
    if (!status?.connection) return;
    await fetch('/api/hmrc/disconnect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: status.connection.kind, bookId }),
    }).catch(() => {});
    setObligations(null); setSelectedKey(''); setReceipt(null);
    await loadStatus();
  }

  async function submit() {
    if (!selectedObl || !finalised) return;
    setSubmitting(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/mtd/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodKey: selectedObl.periodKey, periodFrom: selectedObl.start, periodTo: selectedObl.end,
          finalised: true, lockPeriod, postJournal, fraudData: collectFraudData(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'HMRC rejected the submission.');
      setReceipt(d.receipt as Receipt);
      onSubmitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'HMRC rejected the submission.');
    } finally { setSubmitting(false); }
  }

  const canSubmit = connected && vrnOk && !!selectedKey && finalised && !submitting && !receipt;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Building2 size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Submit to HMRC (MTD)</h2>
            <p className="text-[11px] text-slate-500">VAT period {uk(fromIso)} → {uk(toIso)}</p>
          </div>
          {status?.environment && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase">{status.environment}</span>}
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin mx-auto mb-1.5" /> Checking readiness…</div>
        ) : receipt ? (
          // ── Success ──────────────────────────────────────────────────────
          <div className="p-6 text-center">
            <div className="inline-flex w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 items-center justify-center mb-2"><ShieldCheck size={22} /></div>
            <p className="text-sm font-semibold text-slate-900">Submitted to HMRC</p>
            <p className="text-xs text-slate-500 mt-0.5">{status?.environment === 'production' ? 'Your VAT return has been filed.' : 'Sandbox submission accepted — this is a test filing.'}</p>
            <div className="mt-4 text-left text-xs bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-100">
              <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Receipt (form bundle)</span><span className="font-mono text-slate-800">{receipt.formBundleNumber ?? '—'}</span></div>
              <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Processing date</span><span className="text-slate-800">{receipt.processingDate ? new Date(receipt.processingDate).toLocaleString('en-GB') : '—'}</span></div>
              {receipt.chargeRefNumber && <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Charge reference</span><span className="font-mono text-slate-800">{receipt.chargeRefNumber}</span></div>}
            </div>
            <button type="button" onClick={onClose} className="btn-primary text-sm mt-4">Done</button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

            {/* Readiness */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Readiness</p>
              <ul>
                <CheckRow ok={!!status?.vatRegistered} label="Book is VAT registered" hint={status?.vatRegistered ? undefined : 'Turn on VAT in Book settings.'} />
                <CheckRow ok={vrnOk} label="VAT registration number (VRN) set" hint={vrnOk ? status?.vatNumber ?? undefined : 'A 9-digit VRN is required to file.'} />
                <CheckRow ok={connected} label="HMRC connected" hint={connected ? `Connected (${status?.connection?.kind})` : 'Authorise SMITH with HMRC to file.'} />
              </ul>
            </div>

            {/* VRN capture */}
            {!vrnOk && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <label className="text-xs font-medium text-slate-600">Set the VAT registration number</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="text" value={vrnInput} onChange={e => setVrnInput(e.target.value)} placeholder="9 digits, e.g. 123456789" className="flex-1 text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-400" />
                  <button type="button" onClick={saveVrn} disabled={savingVrn} className="btn-primary text-sm disabled:opacity-50">{savingVrn ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save</button>
                </div>
              </div>
            )}

            {/* Connection */}
            {!status?.configured ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5"><AlertCircle size={14} /> MTD submission isn’t switched on yet</p>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">HMRC credentials aren’t configured for this environment. Once set, you’ll connect and file straight from here.</p>
              </div>
            ) : !connected ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Connect SMITH to HMRC to file this return:</p>
                <button type="button" onClick={() => connect('agent')} className="w-full text-left inline-flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700">
                  <Building2 size={15} className="shrink-0" /><span className="flex-1"><span className="font-medium">Connect as agent</span> <span className="text-xs text-slate-500">— files for all your authorised clients</span></span><ExternalLink size={13} className="text-slate-400" />
                </button>
                <button type="button" onClick={() => connect('business')} className="w-full text-left inline-flex items-center gap-2.5 text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700">
                  <Building2 size={15} className="shrink-0" /><span className="flex-1"><span className="font-medium">Connect this business</span> <span className="text-xs text-slate-500">— files only this entity’s VAT</span></span><ExternalLink size={13} className="text-slate-400" />
                </button>
              </div>
            ) : (
              // ── Connected: obligation + boxes + submit ───────────────────
              <>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                  <span className="text-sm text-emerald-800 inline-flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-600" /> Connected to HMRC ({status?.connection?.kind})</span>
                  <button type="button" onClick={disconnect} className="text-xs text-slate-500 hover:text-rose-600 underline">Disconnect</button>
                </div>

                {/* Obligation picker */}
                <div>
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Open obligation to file</p>
                    <div className="flex items-center gap-2">
                      {status?.environment === 'sandbox' && (
                        <select
                          value={testScenario}
                          onChange={e => { setTestScenario(e.target.value); setObligations(null); setSelectedKey(''); }}
                          title="Sandbox test scenario"
                          className="text-[11px] border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 bg-white outline-none"
                        >
                          {HMRC_OBLIGATION_SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      )}
                      <button type="button" onClick={loadObligations} disabled={oblLoading} className="text-[11px] text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"><RefreshCw size={10} className={oblLoading ? 'animate-spin' : ''} /> Refresh</button>
                    </div>
                  </div>
                  {oblLoading ? (
                    <p className="text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading from HMRC…</p>
                  ) : !obligations || obligations.length === 0 ? (
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">No open obligations returned by HMRC for this VRN.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {obligations.map(o => (
                        <li key={o.periodKey}>
                          <label className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-sm ${selectedKey === o.periodKey ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                            <input type="radio" name="obligation" checked={selectedKey === o.periodKey} onChange={() => setSelectedKey(o.periodKey)} />
                            <span className="flex-1">
                              <span className="text-slate-800">{uk(o.start)} → {uk(o.end)}</span>
                              <span className="block text-[11px] text-slate-400">Due {uk(o.due)} · period key {o.periodKey}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Boxes being submitted — computed for the SELECTED obligation period */}
                {selectedObl && (() => {
                  const b = oblBoxes ?? boxes;
                  return (
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <div className="px-3 py-1.5 bg-slate-50 flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Figures to submit</span>
                        <span className="text-[10px] text-slate-400">for {uk(selectedObl.start)} → {uk(selectedObl.end)}{oblBoxesLoading ? ' · computing…' : ''}</span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-slate-50">
                          {([['Box 1 — VAT due (sales)', b.box1], ['Box 4 — VAT reclaimed', b.box4], ['Box 5 — Net VAT', b.box5], ['Box 6 — Sales ex VAT', b.box6], ['Box 7 — Purchases ex VAT', b.box7]] as [string, number][]).map(([l, v]) => (
                            <tr key={l}><td className="px-3 py-1 text-slate-600">{l}</td><td className="px-3 py-1 text-right tabular-nums text-slate-800">{money(v)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* Filing options */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 space-y-1.5">
                  <label className="flex items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={postJournal} onChange={e => setPostJournal(e.target.checked)} className="mt-0.5" />
                    <span><span className="font-medium">Post the VAT closing journal</span> — clears the VAT control accounts and moves the net to Creditors: Net VAT due on the balance sheet.</span>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={lockPeriod} onChange={e => setLockPeriod(e.target.checked)} className="mt-0.5" />
                    <span><span className="font-medium">Lock the VAT period</span> — entries dated in this period can still be posted as late entries (their VAT carries into the next return).</span>
                  </label>
                </div>

                {/* Declaration */}
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={finalised} onChange={e => setFinalised(e.target.checked)} className="mt-0.5" />
                  <span>I confirm the information is true and complete. Once submitted it cannot be changed (a correction is a separate adjustment).</span>
                </label>

                <button type="button" onClick={submit} disabled={!canSubmit} className="w-full inline-flex items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {submitting ? 'Submitting…' : `Submit return to HMRC${status?.environment ? ` (${status.environment})` : ''}`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
