'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Calculator, Sparkles, Loader2, Check, Users, ScanText, ArrowUpRight } from 'lucide-react';
import { fmtMoney } from './data';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import CgtScanReview from './CgtScanReview';
import {
  cgtCalcSummary, cgtGrossGain, cgtTaxpayerGain, cgtTaxpayerShare, cgtSuggestReliefs, CGT_AEA,
} from './calc';
import { coOwnersFromDisposals, findCoOwnerReturn, pushToCoOwnerReturn, type CoOwnerGroup } from './cgtCoOwner';
import type { CgtCalcState, CgtCalcDisposal, CgtOwner, CgtRelief, ReturnTypeId, TaxReturn } from './types';

const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const ASSET_CLASSES: { value: CgtCalcDisposal['assetClass']; label: string }[] = [
  { value: 'residential', label: 'Residential property' },
  { value: 'listed', label: 'Listed shares & securities' },
  { value: 'unlisted', label: 'Unlisted shares & securities' },
  { value: 'crypto', label: 'Cryptoassets' },
  { value: 'other', label: 'Other assets' },
];

/** One turn of the AI "SMITH Review" of the whole working. */
async function fetchCgtReview(payload: { taxYear: string; disposals: unknown[]; summary: unknown }): Promise<string[]> {
  const r = await fetch('/api/tax-studio/cgt-review', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const ct = r.headers.get('content-type') ?? '';
  const d = ct.includes('application/json') ? await r.json().catch(() => ({})) : {};
  if (!r.ok) throw new Error((d as { error?: string }).error ?? 'SMITH is unavailable right now.');
  return Array.isArray((d as { notes?: unknown }).notes) ? (d as { notes: string[] }).notes : [];
}

// Small inline inputs
function NumField({ label, value, onChange, help }: { label: string; value?: number; onChange: (v: number) => void; help?: string }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10.5px] font-medium text-[var(--text-muted)]" title={help}>{label}</label>
      <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-white px-1.5">
        <span className="text-[11px] text-[var(--text-muted)]">£</span>
        <input type="number" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)} className="w-full bg-transparent py-1 text-right text-[12px] outline-none" />
      </div>
    </div>
  );
}
function PlainNum({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10.5px] font-medium text-[var(--text-muted)]">{label}</label>
      <input type="number" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)} className="input-base w-full py-1 text-[12px]" />
    </div>
  );
}

export default function CgtCalculator({ state, taxYear, taxpayerName, returnType, onChange, onClose }: {
  state: CgtCalcState;
  taxYear: string;
  taxpayerName: string;
  returnType?: ReturnTypeId;
  onChange: (s: CgtCalcState) => void;
  onClose: () => void;
}) {
  const disposals = state.disposals ?? [];
  const summary = cgtCalcSummary(state);
  const [reviewing, setReviewing] = useState(false);
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const coOwners = coOwnersFromDisposals(disposals);

  const patch = (u: Partial<CgtCalcState>) => onChange({ ...state, ...u });
  const updDisposal = (id: string, u: Partial<CgtCalcDisposal>) => patch({ disposals: disposals.map(d => d.id === id ? { ...d, ...u } : d) });
  const addDisposal = () => patch({ disposals: [...disposals, { id: rid('d'), description: '', assetClass: 'residential', proceeds: 0 }] });
  const removeDisposal = (id: string) => patch({ disposals: disposals.filter(d => d.id !== id) });
  const addScanned = (ds: CgtCalcDisposal[]) => patch({ disposals: [...disposals, ...ds] });

  async function runReview() {
    setReviewing(true); setReviewErr(null);
    try {
      const notes = await fetchCgtReview({ taxYear, disposals, summary });
      patch({ reviewNotes: notes, reviewedAt: new Date().toISOString() });
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : 'SMITH is unavailable right now.');
    } finally { setReviewing(false); }
  }

  // ── Co-owner push — a co-owner's share of a jointly-owned disposal → their return ──
  const [coBusy, setCoBusy] = useState<string | null>(null);
  const [coMsg, setCoMsg] = useState<string | null>(null);
  const [coConfirm, setCoConfirm] = useState<{ group: CoOwnerGroup; existing: TaxReturn | null } | null>(null);

  async function pushCoOwner(group: CoOwnerGroup) {
    if (!returnType) { setCoMsg('Pushing to a co-owner’s return is only available from a live return.'); return; }
    setCoBusy(group.clientId); setCoMsg(null);
    try {
      const { ret, hasCgt } = await findCoOwnerReturn(group.clientId, taxYear);
      if (hasCgt && ret) { setCoConfirm({ group, existing: ret }); return; }
      const { created } = await pushToCoOwnerReturn({ group, taxYear, returnType, existing: ret, mode: 'replace' });
      setCoMsg(`${created ? 'Created a new return for' : 'Added to'} ${group.name}’s ${taxYear} return — their ${fmtMoney(group.shareGain)} share.`);
    } catch (e) { setCoMsg(e instanceof Error ? e.message : 'Could not push to the co-owner’s return.'); }
    finally { setCoBusy(null); }
  }
  async function doCoPush(mode: 'replace' | 'add') {
    if (!coConfirm || !returnType) return;
    const { group, existing } = coConfirm;
    setCoBusy(group.clientId); setCoConfirm(null);
    try {
      await pushToCoOwnerReturn({ group, taxYear, returnType, existing, mode });
      setCoMsg(`${mode === 'replace' ? 'Replaced' : 'Added to'} ${group.name}’s ${taxYear} return — their ${fmtMoney(group.shareGain)} share.`);
    } catch (e) { setCoMsg(e instanceof Error ? e.message : 'Could not push to the co-owner’s return.'); }
    finally { setCoBusy(null); }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="flex items-center gap-2 text-[15px] font-bold text-[var(--text-primary)]"><Calculator size={16} className="text-[var(--accent)]" /> Capital gains calculator</p>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        {/* Summary bar */}
        <div className="grid grid-cols-2 gap-2 border-b border-black/5 bg-black/[0.015] px-5 py-3 sm:grid-cols-5">
          {[
            ['Total gains', summary.totalGains],
            ['Losses used', summary.lossesInYearUsed + summary.lossesBfUsed],
            ['Losses c/f', summary.lossesCarriedForward],
            ['Taxable (after £' + CGT_AEA.toLocaleString() + ')', summary.taxableGains],
            ['Est. CGT', summary.estCgt],
          ].map(([lbl, val]) => (
            <div key={lbl as string}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{lbl}</p>
              <p className="text-[15px] font-bold text-[var(--text-primary)]">{fmtMoney(val as number)}</p>
            </div>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {/* Settings */}
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[var(--border)] bg-white/60 p-3 sm:grid-cols-2">
            <NumField label="Capital losses brought forward (available)" value={state.lossesBroughtForward} onChange={v => patch({ lossesBroughtForward: v })} help="Unused capital losses from earlier years." />
            <NumField label="BADR / ER gains claimed to date (lifetime)" value={state.badrLifetimeUsed} onChange={v => patch({ badrLifetimeUsed: v })} help="Gains already claimed under Business Asset Disposal Relief / Entrepreneurs' Relief in earlier years — counts toward the £1m lifetime limit. Default £0." />
            <p className="col-span-full text-[10.5px] text-[var(--text-muted)]">BADR lifetime remaining: <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(summary.badrLifetimeRemaining)}</span> of £1,000,000.</p>
          </div>

          {/* Disposals */}
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Disposals {disposals.length > 0 && <span className="text-[var(--accent)]">({disposals.length})</span>}</p>
          {disposals.length === 0 && <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">No disposals yet — add each asset sold and SMITH totals the gains onto the SA108 form.</p>}
          <div className="space-y-2.5">
            {disposals.map((d, i) => <DisposalCard key={d.id} d={d} idx={i} taxpayerName={taxpayerName} onChange={u => updDisposal(d.id, u)} onRemove={() => removeDisposal(d.id)} />)}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button onClick={addDisposal} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add disposal</button>
            <button onClick={() => setScanOpen(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><ScanText size={13} /> Scan documents</button>
          </div>
          {scanOpen && <CgtScanReview taxYear={taxYear} taxpayerName={taxpayerName} onApply={addScanned} onClose={() => setScanOpen(false)} />}

          {/* Co-owners — push each co-owner's share to their own return */}
          {coOwners.length > 0 && (
            <div className="mt-5 rounded-xl border border-[var(--border)] bg-white/60 p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-primary)]"><Users size={13} className="text-[var(--accent)]" /> Co-owners</p>
              <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">Push each co-owner’s share to their own self-assessment return so the same calculation isn’t done twice.</p>
              <div className="mt-2 space-y-1.5">
                {coOwners.map(g => (
                  <div key={g.clientId} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">{g.name}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">{g.disposals.length} disposal{g.disposals.length === 1 ? '' : 's'} · <span className="font-semibold text-[var(--text-primary)]">{g.shareGain < 0 ? `Loss ${fmtMoney(-g.shareGain)}` : fmtMoney(g.shareGain)}</span></span>
                    <button onClick={() => pushCoOwner(g)} disabled={coBusy === g.clientId || !returnType} className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-0.5 text-[10.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                      {coBusy === g.clientId ? <><Loader2 size={11} className="animate-spin" /> Pushing…</> : <><ArrowUpRight size={11} /> Push to their return</>}
                    </button>
                  </div>
                ))}
              </div>
              {!returnType && <p className="mt-1.5 text-[10.5px] text-amber-600">Link a co-owner to a client (in a disposal’s ownership) and open this from a live return to enable the push.</p>}
              {coMsg && <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">{coMsg}</p>}
            </div>
          )}

          {coConfirm && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => setCoConfirm(null)}>
              <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                <p className="text-[15px] font-bold text-[var(--text-primary)]">Add to {coConfirm.group.name}’s return</p>
                <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{coConfirm.group.name}’s {taxYear} return already has capital gains. Replace it with their share of these disposals, or add on top of what’s there?</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button onClick={() => setCoConfirm(null)} className="btn-secondary">Cancel</button>
                  <button onClick={() => doCoPush('add')} className="btn-secondary bg-white">Add to existing</button>
                  <button onClick={() => doCoPush('replace')} className="btn-primary">Replace</button>
                </div>
              </div>
            </div>
          )}

          {/* SMITH Review */}
          <div className="mt-5 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.03] p-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-primary)]"><Sparkles size={13} className="text-[var(--accent)]" /> SMITH Review</p>
              <button onClick={runReview} disabled={reviewing || disposals.length === 0} className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                {reviewing ? <><Loader2 size={12} className="animate-spin" /> Reviewing…</> : <>Review my calculation</>}
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">SMITH checks your disposals for reliefs and issues the rules might have missed (odd cases, elections, timing).</p>
            {reviewErr && <p className="mt-1.5 text-[11px] text-rose-600">{reviewErr}</p>}
            {state.reviewNotes && state.reviewNotes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {state.reviewNotes.map((n, j) => <li key={j} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" /> {n}</li>)}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          <p className="text-[11px] text-[var(--text-muted)]">Changes save automatically and total onto the SA108 form.</p>
          <button onClick={onClose} className="btn-primary"><Check size={15} /> Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DisposalCard({ d, idx, taxpayerName, onChange, onRemove }: {
  d: CgtCalcDisposal; idx: number; taxpayerName: string; onChange: (u: Partial<CgtCalcDisposal>) => void; onRemove: () => void;
}) {
  const gross = cgtGrossGain(d);
  const share = cgtTaxpayerShare(d);
  const net = cgtTaxpayerGain(d);
  const owners = d.owners ?? [];
  const suggestions = cgtSuggestReliefs(d);
  const reliefs = d.reliefs ?? [];
  const suggestedNew = suggestions.filter(s => !reliefs.some(r => r.kind === s.kind));

  const setReliefs = (rs: CgtRelief[]) => onChange({ reliefs: rs });
  const acceptSuggestion = (s: { kind: CgtRelief['kind']; label: string; amount: number; note: string }) =>
    setReliefs([...reliefs, { id: rid('r'), kind: s.kind, label: s.label, amount: s.amount, note: s.note, accepted: true, suggested: true }]);
  const addManualRelief = () => setReliefs([...reliefs, { id: rid('r'), kind: 'other', label: 'Other relief', amount: 0, accepted: true }]);

  const setOwners = (os: CgtOwner[]) => onChange({ owners: os });
  const initOwners = () => setOwners([
    { id: rid('o'), name: taxpayerName || 'You', sharePct: 50, isTaxpayer: true },
    { id: rid('o'), name: '', sharePct: 50 },
  ]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/70 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input value={d.description} placeholder={`Disposal ${idx + 1} — e.g. 14 Rowan Rd`} onChange={e => onChange({ description: e.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <select value={d.assetClass} onChange={e => onChange({ assetClass: e.target.value as CgtCalcDisposal['assetClass'] })} className="input-base py-1 text-[11.5px]">
          {ASSET_CLASSES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <button onClick={onRemove} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumField label="Proceeds" value={d.proceeds} onChange={v => onChange({ proceeds: v })} />
        <NumField label="Acquisition cost" value={d.acquisitionCost} onChange={v => onChange({ acquisitionCost: v })} />
        <NumField label="Buying/selling costs" value={d.incidentalCosts} onChange={v => onChange({ incidentalCosts: v })} />
        <NumField label="Improvement costs" value={d.improvementCosts} onChange={v => onChange({ improvementCosts: v })} />
      </div>

      {/* Ownership */}
      <div className="mt-2.5 rounded-lg border border-[var(--border)] bg-black/[0.015] p-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><Users size={11} /> Ownership</p>
          {owners.length === 0 && <button onClick={initOwners} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">Split with co-owner(s)</button>}
        </div>
        {owners.length === 0 ? (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Owned 100% by {taxpayerName || 'the taxpayer'}. Split it if the asset is jointly owned (e.g. with a spouse).</p>
        ) : (
          <div className="mt-1.5 space-y-1.5">
            {owners.map((o, oi) => (
              <div key={o.id} className="flex flex-wrap items-center gap-1.5">
                {o.isTaxpayer ? (
                  <span className="min-w-0 flex-1 truncate rounded-md bg-[var(--accent)]/10 px-2 py-1 text-[11.5px] font-semibold text-[var(--accent)]">{taxpayerName || 'You'} (this return)</span>
                ) : (
                  <div className="min-w-0 flex-1"><ClientSearchInput value={o.clientId ?? ''} valueName={o.name} placeholder="Link co-owner's client…" onChange={(id, name, ref) => setOwners(owners.map(x => x.id === o.id ? { ...x, clientId: id, clientRef: ref, name: name || x.name } : x))} /></div>
                )}
                <div className="flex items-center rounded-md border border-[var(--border)] bg-white px-1.5">
                  <input type="number" value={o.sharePct || ''} onChange={e => setOwners(owners.map(x => x.id === o.id ? { ...x, sharePct: Number(e.target.value) || 0 } : x))} className="w-12 bg-transparent py-1 text-right text-[12px] outline-none" />
                  <span className="text-[11px] text-[var(--text-muted)]">%</span>
                </div>
                {!o.isTaxpayer && <button onClick={() => setOwners(owners.filter(x => x.id !== o.id))} className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-rose-500"><Trash2 size={12} /></button>}
              </div>
            ))}
            <div className="flex items-center justify-between">
              <button onClick={() => setOwners([...owners, { id: rid('o'), name: '', sharePct: 0 }])} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">+ Add owner</button>
              <span className={`text-[10.5px] ${owners.reduce((a, o) => a + (o.sharePct || 0), 0) === 100 ? 'text-[var(--text-muted)]' : 'text-amber-600'}`}>Total {owners.reduce((a, o) => a + (o.sharePct || 0), 0)}%</span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">Co-owners you link to a client can have their share pushed to their own return (coming next).</p>
          </div>
        )}
      </div>

      {/* Residential / PRR + BADR flags */}
      {d.assetClass === 'residential' && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="col-span-2 flex items-center gap-1.5 self-end text-[11px] font-medium text-[var(--text-muted)] sm:col-span-1"><input type="checkbox" checked={!!d.wasMainResidence} onChange={e => onChange({ wasMainResidence: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" /> Was your main home</label>
          {d.wasMainResidence && <>
            <PlainNum label="Months lived in" value={d.occupationMonths} onChange={v => onChange({ occupationMonths: v })} />
            <PlainNum label="Months owned" value={d.ownershipMonths} onChange={v => onChange({ ownershipMonths: v })} />
            <label className="flex items-center gap-1.5 self-end text-[11px] font-medium text-[var(--text-muted)]"><input type="checkbox" checked={!!d.wasLet} onChange={e => onChange({ wasLet: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" /> Was let out</label>
          </>}
        </div>
      )}
      {(d.assetClass === 'unlisted' || d.assetClass === 'other') && (
        <label className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]"><input type="checkbox" checked={!!d.claimBadr} onChange={e => onChange({ claimBadr: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" /> Claim Business Asset Disposal Relief (14% rate)</label>
      )}

      {/* Reliefs */}
      <div className="mt-2.5">
        {suggestedNew.map(s => (
          <div key={s.kind} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5">
            <Sparkles size={12} className="shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-semibold text-[var(--text-primary)]">{s.label}{s.amount > 0 ? ` — ${fmtMoney(s.amount)}` : ''}</p>
              <p className="text-[10.5px] text-emerald-800">{s.note}</p>
            </div>
            <button onClick={() => acceptSuggestion(s)} className="shrink-0 rounded-md bg-emerald-600 px-2 py-0.5 text-[10.5px] font-bold text-white hover:opacity-90">Accept</button>
          </div>
        ))}
        {reliefs.map(r => (
          <div key={r.id} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent)]/25 bg-[var(--accent)]/[0.04] px-2.5 py-1.5">
            <Check size={12} className="shrink-0 text-[var(--accent)]" />
            <input value={r.label} onChange={e => setReliefs(reliefs.map(x => x.id === r.id ? { ...x, label: e.target.value } : x))} className="min-w-0 flex-1 bg-transparent text-[11.5px] font-semibold text-[var(--text-primary)] outline-none" />
            {r.kind !== 'badr' && (
              <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-white px-1.5">
                <span className="text-[11px] text-[var(--text-muted)]">£</span>
                <input type="number" value={r.amount || ''} onChange={e => setReliefs(reliefs.map(x => x.id === r.id ? { ...x, amount: Number(e.target.value) || 0 } : x))} className="w-20 bg-transparent py-0.5 text-right text-[12px] outline-none" />
              </div>
            )}
            {r.kind === 'badr' && <span className="rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--accent)]">14% rate</span>}
            <button onClick={() => setReliefs(reliefs.filter(x => x.id !== r.id))} className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-rose-500"><Trash2 size={12} /></button>
          </div>
        ))}
        <button onClick={addManualRelief} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">+ Add a relief</button>
      </div>

      {/* Per-disposal result */}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-black/5 pt-2 text-[11.5px]">
        <span className="text-[var(--text-muted)]">Whole-asset gain <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(gross)}</span></span>
        {share !== 100 && <span className="text-[var(--text-muted)]">Your {share}% share</span>}
        <span className={`font-bold ${net < 0 ? 'text-rose-600' : 'text-[var(--text-primary)]'}`}>{net < 0 ? `Loss ${fmtMoney(-net)}` : `Gain ${fmtMoney(net)}`}</span>
      </div>
    </div>
  );
}
