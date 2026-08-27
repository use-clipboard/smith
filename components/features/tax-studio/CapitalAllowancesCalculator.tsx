'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Plus, Trash2, Calculator, Coins, HelpCircle } from 'lucide-react';
import { fmtMoney } from './data';
import { computeCapitalAllowances, capitalAllowancesWarnings, carClassify, type CapitalAllowancesResult } from './calc';
import type { CapitalAllowancesState, CapexAddition, CapexDisposal, SbaAsset, SingleAssetPool } from './types';

const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const TREATMENTS_TRADER: { value: CapexAddition['treatment']; label: string }[] = [
  { value: 'aia', label: 'AIA — 100%' },
  { value: 'fya', label: 'First-year — 100%' },
  { value: 'fya40', label: '40% FYA (from Jan 2026)' },
  { value: 'main', label: 'Main pool' },
  { value: 'special', label: 'Special rate — 6%' },
];
const TREATMENTS_COMPANY: { value: CapexAddition['treatment']; label: string }[] = [
  { value: 'aia', label: 'AIA — 100%' },
  { value: 'full', label: 'Full expensing — 100%' },
  { value: 'fya', label: 'First-year — 100% (zero-emission)' },
  { value: 'fya40', label: '40% FYA (from Jan 2026)' },
  { value: 'sr-fya', label: 'Special-rate FYA — 50%' },
  { value: 'main', label: 'Main pool' },
  { value: 'special', label: 'Special rate — 6%' },
];
const ASSET_TYPES: { value: NonNullable<CapexAddition['assetType']>; label: string }[] = [
  { value: 'plant', label: 'Plant / equipment' },
  { value: 'car', label: 'Car' },
  { value: 'van', label: 'Van' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'lorry', label: 'Lorry / truck' },
  { value: 'other', label: 'Other commercial' },
];
const CAR_DERIVED: Record<'fya100' | 'main' | 'special', string> = {
  fya100: '→ 100% FYA (zero-emission)',
  main: '→ Main pool',
  special: '→ Special rate',
};

// Capital Allowances Calculator — pools (18%/6%), AIA, first-year allowances
// (incl. full expensing + 50% special-rate FYA for companies), Structures &
// Buildings Allowance, single-asset pools (sole-trader private use), small-pools
// write-off, balancing charges/allowances, cessation and period proration.
// Brought-forward TWDVs roll in from last year; closing TWDVs are stored for next.
export default function CapitalAllowancesCalculator({ state, onApply, onClose, mode = 'trader', period }: {
  state: CapitalAllowancesState | undefined;
  onApply: (state: CapitalAllowancesState, result: CapitalAllowancesResult) => void;
  onClose: () => void;
  mode?: 'company' | 'trader';
  period?: { start?: string; end?: string };
}) {
  const company = mode === 'company';
  const [st, setSt] = useState<CapitalAllowancesState>(() => ({
    mainPoolBfwd: state?.mainPoolBfwd ?? 0,
    specialPoolBfwd: state?.specialPoolBfwd ?? 0,
    additions: (state?.additions ?? []).map(a => ({ ...a })),
    disposals: (state?.disposals ?? []).map(d => ({ ...d })),
    sbaAssets: (state?.sbaAssets ?? []).map(a => ({ ...a })),
    singleAssetPools: (state?.singleAssetPools ?? []).map(p => ({ ...p })),
    cessation: state?.cessation ?? false,
    mainWdaClaimPct: state?.mainWdaClaimPct,
    specialWdaClaimPct: state?.specialWdaClaimPct,
  }));
  const r = computeCapitalAllowances(st, { mode, periodStart: period?.start, periodEnd: period?.end });
  const warnings = capitalAllowancesWarnings(st, { mode, periodStart: period?.start, periodEnd: period?.end }, r);
  const treatments = company ? TREATMENTS_COMPANY : TREATMENTS_TRADER;

  const setBfwd = (k: 'mainPoolBfwd' | 'specialPoolBfwd', v: number) => setSt(s => ({ ...s, [k]: v }));
  const addAddition = () => setSt(s => ({ ...s, additions: [...(s.additions ?? []), { id: rid('ca'), cost: 0, treatment: 'aia' }] }));
  const updAddition = (id: string, u: Partial<CapexAddition>) => setSt(s => ({ ...s, additions: (s.additions ?? []).map(a => a.id === id ? { ...a, ...u } : a) }));
  const delAddition = (id: string) => setSt(s => ({ ...s, additions: (s.additions ?? []).filter(a => a.id !== id) }));
  const addDisposal = () => setSt(s => ({ ...s, disposals: [...(s.disposals ?? []), { id: rid('cd'), pool: 'main', proceeds: 0 }] }));
  const updDisposal = (id: string, u: Partial<CapexDisposal>) => setSt(s => ({ ...s, disposals: (s.disposals ?? []).map(d => d.id === id ? { ...d, ...u } : d) }));
  const delDisposal = (id: string) => setSt(s => ({ ...s, disposals: (s.disposals ?? []).filter(d => d.id !== id) }));
  const addSba = () => setSt(s => ({ ...s, sbaAssets: [...(s.sbaAssets ?? []), { id: rid('sba'), cost: 0, rate: 3 }] }));
  const updSba = (id: string, u: Partial<SbaAsset>) => setSt(s => ({ ...s, sbaAssets: (s.sbaAssets ?? []).map(a => a.id === id ? { ...a, ...u } : a) }));
  const delSba = (id: string) => setSt(s => ({ ...s, sbaAssets: (s.sbaAssets ?? []).filter(a => a.id !== id) }));
  const addSingle = () => setSt(s => ({ ...s, singleAssetPools: [...(s.singleAssetPools ?? []), { id: rid('sap'), rate: 'main', businessUsePct: 100 }] }));
  const updSingle = (id: string, u: Partial<SingleAssetPool>) => setSt(s => ({ ...s, singleAssetPools: (s.singleAssetPools ?? []).map(p => p.id === id ? { ...p, ...u } : p) }));
  const delSingle = (id: string) => setSt(s => ({ ...s, singleAssetPools: (s.singleAssetPools ?? []).filter(p => p.id !== id) }));

  function apply() {
    const singleAssetPools = (st.singleAssetPools ?? []).map(p => ({ ...p, twdvCfwd: r.singlePoolsCfwd.find(x => x.id === p.id)?.twdvCfwd ?? 0 }));
    onApply({ ...st, mainPoolCfwd: r.mainPoolCfwd, specialPoolCfwd: r.specialPoolCfwd, singleAssetPools }, r);
  }

  const addCols = company
    ? 'grid-cols-[1fr_72px_92px_46px_144px_34px_48px]'
    : 'grid-cols-[1fr_72px_88px_46px_130px_34px_48px_48px]';
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]"><Calculator size={15} className="text-[var(--accent)]" /> Capital Allowances Calculator</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">{company ? 'Pools, AIA, full expensing, SBA — closing balances carry forward.' : 'Pools, AIA and first-year allowances — closing balances carry forward.'}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* Brought-forward pools */}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Pools brought forward (TWDV)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Main pool b/fwd (TWDV)" value={st.mainPoolBfwd ?? 0} onChange={v => setBfwd('mainPoolBfwd', v)} />
              <Field label="Special-rate pool b/fwd (6%)" value={st.specialPoolBfwd ?? 0} onChange={v => setBfwd('specialPoolBfwd', v)} />
            </div>
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Rolled in automatically from last year&apos;s closing balances when the {company ? 'return' : 'trade'} is carried forward.{r.prorated && ` Period is ${r.periodDays} days — writing-down allowances and the AIA cap are prorated.`}</p>
          </div>

          {/* Additions */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Additions in the year</p>
              <button onClick={addAddition} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><Plus size={12} /> Add asset</button>
            </div>
            {(st.additions ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11.5px] text-[var(--text-muted)]">No additions — add assets bought this year.</p>
            ) : (
              <div className="space-y-1.5">
                <div className={`grid ${addCols} gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]`}>
                  <span>Description</span><span className="text-right">Cost</span><span>Type</span><span className="text-right">CO₂</span><span>Treatment</span><span className="text-center">New</span>{!company && <span className="text-right">Bus %</span>}<span></span>
                </div>
                {(st.additions ?? []).map(a => {
                  const isCar = a.assetType === 'car';
                  const carDeriv = isCar ? CAR_DERIVED[carClassify(a.co2, a.newUnused, period?.end || '')] : null;
                  return (
                  <div key={a.id} className="space-y-1">
                  <div className={`grid ${addCols} items-center gap-2${a.disposed ? ' opacity-50' : ''}`}>
                    <input value={a.description ?? ''} placeholder={company ? 'e.g. Plant & machinery' : 'e.g. Van'} onChange={e => updAddition(a.id, { description: e.target.value })} className="input-base py-1 text-[12px]" />
                    <input type="number" value={a.cost || ''} placeholder="0" onChange={e => updAddition(a.id, { cost: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                    <select value={a.assetType ?? 'plant'} onChange={e => updAddition(a.id, { assetType: e.target.value as CapexAddition['assetType'] })} className="input-base px-1 py-1 text-[11.5px]">
                      {ASSET_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input type="number" value={a.co2 ?? ''} placeholder={isCar ? '0' : '—'} disabled={!isCar} onChange={e => updAddition(a.id, { co2: e.target.value === '' ? undefined : Number(e.target.value) })} className={`input-base py-1 text-right text-[12px]${isCar ? '' : ' cursor-not-allowed bg-slate-50 text-slate-300'}`} />
                    {isCar
                      ? <span className="truncate text-[11px] font-semibold text-[var(--accent)]" title={`${carDeriv} — cars can't take AIA / full expensing / FYA40`}>{carDeriv}</span>
                      : <select value={a.treatment} onChange={e => updAddition(a.id, { treatment: e.target.value as CapexAddition['treatment'] })} className="input-base px-1 py-1 text-[11.5px]">
                          {treatments.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>}
                    <input type="checkbox" checked={a.newUnused !== false} onChange={e => updAddition(a.id, { newUnused: e.target.checked })} className="mx-auto h-3.5 w-3.5 accent-[var(--accent)]" title="New & unused (required for full expensing / FYA)" />
                    {!company && <input type="number" value={a.businessUsePct ?? ''} placeholder="100" onChange={e => updAddition(a.id, { businessUsePct: e.target.value === '' ? undefined : Number(e.target.value) })} className="input-base py-1 text-right text-[12px]" />}
                    <div className="flex items-center justify-end gap-0.5">
                      <button onClick={() => updAddition(a.id, { disposed: !a.disposed })} title={a.disposed ? 'Undo disposal' : 'Mark as disposed'} className={`flex h-7 w-7 items-center justify-center rounded-lg ${a.disposed ? 'bg-amber-50 text-amber-600' : 'text-[var(--text-muted)] hover:bg-[var(--accent)]/5 hover:text-[var(--accent)]'}`}><Coins size={13} /></button>
                      <button onClick={() => delAddition(a.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  {a.disposed && (
                    <div className="flex flex-wrap items-center gap-2 pl-2 text-[11px]">
                      <span className="font-semibold text-amber-700">Disposed</span>
                      <input type="date" value={a.disposalDate ?? ''} onChange={e => updAddition(a.id, { disposalDate: e.target.value || undefined })} className="input-base py-1 text-[11.5px]" />
                      <span className="text-[var(--text-muted)]">Proceeds</span>
                      <input type="number" value={a.proceeds ?? ''} placeholder="0" onChange={e => updAddition(a.id, { proceeds: Number(e.target.value) || 0 })} className="input-base w-24 py-1 text-right text-[11.5px]" />
                      <span className="text-[10px] text-[var(--text-muted)]">Capped at cost; a relieved asset gives a balancing charge.</span>
                    </div>
                  )}
                  {a.broughtForward && !a.disposed && <p className="pl-2 text-[10px] font-medium text-slate-400">Brought forward — held for a future disposal (no new allowance this year).</p>}
                  </div>
                  );
                })}
              </div>
            )}
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Cars follow the CO₂ / new-unused decision tree (no AIA, full expensing or 40% FYA); vans and commercial vehicles are ordinary plant. New &amp; unused is required for full expensing / 40% / 50% / 100% FYA. {company
              ? 'Full expensing = 100% on new main-pool P&M (uncapped); 50% special-rate FYA gives half now, half into the special pool next period.'
              : 'Business-use % applies to AIA / first-year assets; a car with private use belongs in a single-asset pool below.'}</p>
          </div>

          {/* Disposals */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Disposals in the year</p>
              <button onClick={addDisposal} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><Plus size={12} /> Add disposal</button>
            </div>
            {(st.disposals ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11.5px] text-[var(--text-muted)]">No disposals this year.</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_140px_90px_28px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <span>Description</span><span>Pool</span><span className="text-right">Proceeds</span><span></span>
                </div>
                {(st.disposals ?? []).map(d => (
                  <div key={d.id} className="grid grid-cols-[1fr_140px_90px_28px] items-center gap-2">
                    <input value={d.description ?? ''} placeholder="e.g. Old van" onChange={e => updDisposal(d.id, { description: e.target.value })} className="input-base py-1 text-[12px]" />
                    <select value={d.pool} onChange={e => updDisposal(d.id, { pool: e.target.value as CapexDisposal['pool'] })} className="input-base py-1 text-[12px]">
                      <option value="main">Main pool</option>
                      <option value="special">Special rate</option>
                    </select>
                    <input type="number" value={d.proceeds || ''} placeholder="0" onChange={e => updDisposal(d.id, { proceeds: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                    <button onClick={() => delDisposal(d.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Structures & Buildings Allowance */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Structures &amp; Buildings Allowance (3%)</p>
              <button onClick={addSba} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><Plus size={12} /> Add building</button>
            </div>
            {(st.sbaAssets ?? []).length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11.5px] text-[var(--text-muted)]">No SBA — add qualifying construction/renovation cost.</p>
            ) : (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_100px_70px_130px_28px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <span>Description</span><span className="text-right">Qual. cost</span><span className="text-right">Rate %</span><span>In use from</span><span></span>
                </div>
                {(st.sbaAssets ?? []).map(a => (
                  <div key={a.id} className="grid grid-cols-[1fr_100px_70px_130px_28px] items-center gap-2">
                    <input value={a.description ?? ''} placeholder="e.g. Office fit-out" onChange={e => updSba(a.id, { description: e.target.value })} className="input-base py-1 text-[12px]" />
                    <input type="number" value={a.cost || ''} placeholder="0" onChange={e => updSba(a.id, { cost: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                    <input type="number" value={a.rate ?? 3} onChange={e => updSba(a.id, { rate: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                    <input type="date" value={a.firstUseDate ?? ''} onChange={e => updSba(a.id, { firstUseDate: e.target.value || undefined })} className="input-base py-1 text-[12px]" />
                    <button onClick={() => delSba(a.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">3% straight-line on qualifying construction cost, from first qualifying use — prorated by days in the period.</p>
          </div>

          {/* Single-asset pools (sole-trader private use) */}
          {!company && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Single-asset pools (private use)</p>
                <button onClick={addSingle} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><Plus size={12} /> Add asset</button>
              </div>
              {(st.singleAssetPools ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11.5px] text-[var(--text-muted)]">For assets with private use (e.g. a car) — WDA restricted by business-use %.</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_90px_90px_110px_60px_90px_28px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span>Description</span><span className="text-right">TWDV b/f</span><span className="text-right">Add cost</span><span>Rate</span><span className="text-right">Bus %</span><span className="text-right">Disposal</span><span></span>
                  </div>
                  {(st.singleAssetPools ?? []).map(p => (
                    <div key={p.id} className="grid grid-cols-[1fr_90px_90px_110px_60px_90px_28px] items-center gap-2">
                      <input value={p.description ?? ''} placeholder="e.g. Car (private use)" onChange={e => updSingle(p.id, { description: e.target.value })} className="input-base py-1 text-[12px]" />
                      <input type="number" value={p.twdvBfwd || ''} placeholder="0" onChange={e => updSingle(p.id, { twdvBfwd: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                      <input type="number" value={p.additionCost || ''} placeholder="0" onChange={e => updSingle(p.id, { additionCost: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                      <select value={p.rate} onChange={e => updSingle(p.id, { rate: e.target.value as SingleAssetPool['rate'] })} className="input-base py-1 text-[12px]">
                        <option value="main">18%</option>
                        <option value="special">6%</option>
                      </select>
                      <input type="number" value={p.businessUsePct ?? ''} placeholder="100" onChange={e => updSingle(p.id, { businessUsePct: e.target.value === '' ? undefined : Number(e.target.value) })} className="input-base py-1 text-right text-[12px]" />
                      <input type="number" value={p.disposed ? (p.proceeds || '') : ''} placeholder="—" onChange={e => { const v = e.target.value; updSingle(p.id, v === '' ? { disposed: false, proceeds: 0 } : { disposed: true, proceeds: Number(v) || 0 }); }} className="input-base py-1 text-right text-[12px]" />
                      <button onClick={() => delSingle(p.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cessation */}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2 text-[11.5px] font-medium text-[var(--text-secondary)]">
            <input type="checkbox" checked={!!st.cessation} onChange={e => setSt(s => ({ ...s, cessation: e.target.checked }))} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            Final period (cessation) — write off remaining pools as balancing allowances (no WDA)
          </label>

          {/* Claim strategy — WDA is a claim; it can be reduced to preserve allowances. */}
          {!st.cessation && (r.maxWdaMain > 0 || r.maxWdaSpecial > 0) && (
            <div className="rounded-lg border border-[var(--border)] bg-black/[0.015] px-3 py-2.5">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Claim strategy — writing-down allowances</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[11.5px] text-[var(--text-muted)]">Main pool claim</span>
                  <input type="number" min={0} max={100} value={st.mainWdaClaimPct ?? 100} onChange={e => setSt(s => ({ ...s, mainWdaClaimPct: e.target.value === '' ? undefined : Number(e.target.value) }))} className="input-base w-16 py-1 text-right text-[12px]" />
                  <span className="text-[11px] text-[var(--text-muted)]">% · max {fmtMoney(r.maxWdaMain)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-[11.5px] text-[var(--text-muted)]">Special pool claim</span>
                  <input type="number" min={0} max={100} value={st.specialWdaClaimPct ?? 100} onChange={e => setSt(s => ({ ...s, specialWdaClaimPct: e.target.value === '' ? undefined : Number(e.target.value) }))} className="input-base w-16 py-1 text-right text-[12px]" />
                  <span className="text-[11px] text-[var(--text-muted)]">% · max {fmtMoney(r.maxWdaSpecial)}</span>
                </div>
              </div>
              <p className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">Capital allowances are claims — reduce the WDA to preserve allowances (e.g. to keep a sole trader’s personal allowance). The un-claimed part stays in the pool for future years.</p>
            </div>
          )}

          {/* Review flags */}
          {warnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Review &amp; tips</p>
              {warnings.map((w, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-[11px] leading-snug ${w.level === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : w.level === 'tip' ? 'border-[var(--accent)]/20 bg-[var(--accent)]/[0.04] text-[var(--accent)]' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  <span className="mt-px shrink-0">{w.level === 'warn' ? '⚠️' : w.level === 'tip' ? '💡' : 'ℹ️'}</span>
                  <span>{w.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Per-asset breakdown (transparent register output) */}
          {r.perAsset.length > 0 && (
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><HelpCircle size={12} /> Per-asset breakdown</p>
              <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                {r.perAsset.map((ln, i) => (
                  <div key={ln.id + '-' + i} className={`px-3 py-2 ${i > 0 ? 'border-t border-[var(--border)]' : ''} ${ln.disposed ? 'bg-amber-50/50' : ''}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] font-semibold text-[var(--text-primary)]">{ln.description}<span className="ml-1 font-normal text-[var(--text-muted)]">· {ln.classification}</span></span>
                      <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-[var(--text-primary)]">{ln.disposed ? (ln.balancing ? `charge +${fmtMoney(ln.balancing)}` : 'to pool') : fmtMoney(ln.currentYear)}</span>
                    </div>
                    <p className="text-[10.5px] leading-snug text-[var(--text-muted)]"><span className="font-semibold text-[var(--text-secondary)]">{ln.allowanceType}</span> — {ln.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Result */}
        <div className="border-t border-black/5 bg-[var(--accent)]/[0.03] px-5 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
            <Line label="AIA" value={r.aia} note={r.aiaCapped ? 'capped' : undefined} />
            {company && r.fullExpensing > 0 && <Line label="Full expensing" value={r.fullExpensing} />}
            {r.fya > 0 && <Line label="First-year (100%)" value={r.fya} />}
            {r.fya40 > 0 && <Line label="40% FYA" value={r.fya40} />}
            {company && r.sr50 > 0 && <Line label="Special-rate FYA (50%)" value={r.sr50} />}
            <Line label={`Main WDA ${r.mainRatePct}%`} value={r.wdaMain} note={r.mainSmallPool ? 'small pool' : undefined} />
            <Line label="Special WDA 6%" value={r.wdaSpecial} note={r.specialSmallPool ? 'small pool' : undefined} />
            {r.sba > 0 && <Line label="SBA 3%" value={r.sba} />}
            {!company && r.singleAsset > 0 && <Line label="Single-asset pools" value={r.singleAsset} />}
            {r.balancingAllowance > 0 && <Line label="Balancing allowance" value={r.balancingAllowance} />}
            <Line label="Total allowances" value={r.total} bold />
            <Line label="Balancing charge" value={r.balancingCharge} tone={r.balancingCharge > 0 ? 'amber' : undefined} />
            <Line label="Main pool c/fwd" value={r.mainPoolCfwd} />
            <Line label="Special pool c/fwd" value={r.specialPoolCfwd} />
          </div>
          {r.straddles2026 && <p className="mt-1.5 text-[10.5px] font-semibold text-[var(--accent)]">Period straddles the 2026 rate change — main-pool WDA blended to {r.mainRatePct}% (18% before / 14% after).</p>}
          {r.aiaCapped && <p className="mt-1.5 text-[10.5px] font-semibold text-amber-700">AIA spend exceeds the {fmtMoney(r.aiaLimit)} limit{r.prorated ? ' (prorated for the period)' : ''} — the claim has been capped.</p>}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={apply} className="btn-primary"><Check size={14} /> Apply to return</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">{label}</label>
      <input type="number" value={value === 0 ? '' : value} placeholder="0" onChange={e => onChange(Number(e.target.value) || 0)} className="input-base py-1 text-right text-[12.5px]" />
    </div>
  );
}
function Line({ label, value, bold, note, tone }: { label: string; value: number; bold?: boolean; note?: string; tone?: 'amber' }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[var(--text-muted)]">{label}{note && <span className="ml-1 text-[10px] text-[var(--accent)]">({note})</span>}</span>
      <span className={`font-${bold ? 'bold' : 'semibold'} ${tone === 'amber' ? 'text-amber-700' : 'text-[var(--text-primary)]'}`}>{fmtMoney(value)}</span>
    </div>
  );
}
