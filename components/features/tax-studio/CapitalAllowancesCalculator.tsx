'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, Plus, Trash2, Calculator } from 'lucide-react';
import { fmtMoney } from './data';
import { computeCapitalAllowances, type CapitalAllowancesResult } from './calc';
import type { CapitalAllowancesState, CapexAddition, CapexDisposal } from './types';

const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const TREATMENTS: { value: CapexAddition['treatment']; label: string }[] = [
  { value: 'aia', label: 'AIA — 100%' },
  { value: 'fya', label: 'First-year — 100%' },
  { value: 'main', label: 'Main pool — 18%' },
  { value: 'special', label: 'Special rate — 6%' },
];

// Capital Allowances Calculator — pools (18%/6%) + AIA + FYA, small-pools
// write-off and balancing charges. Brought-forward TWDV rolls in from last year;
// closing TWDV is stored for next year. Applying writes the SA103F boxes.
export default function CapitalAllowancesCalculator({ state, onApply, onClose }: {
  state: CapitalAllowancesState | undefined;
  onApply: (state: CapitalAllowancesState, result: CapitalAllowancesResult) => void;
  onClose: () => void;
}) {
  const [st, setSt] = useState<CapitalAllowancesState>(() => ({
    mainPoolBfwd: state?.mainPoolBfwd ?? 0,
    specialPoolBfwd: state?.specialPoolBfwd ?? 0,
    additions: (state?.additions ?? []).map(a => ({ ...a })),
    disposals: (state?.disposals ?? []).map(d => ({ ...d })),
  }));
  const r = computeCapitalAllowances(st);

  const setBfwd = (k: 'mainPoolBfwd' | 'specialPoolBfwd', v: number) => setSt(s => ({ ...s, [k]: v }));
  const addAddition = () => setSt(s => ({ ...s, additions: [...(s.additions ?? []), { id: rid('ca'), cost: 0, treatment: 'aia' }] }));
  const updAddition = (id: string, u: Partial<CapexAddition>) => setSt(s => ({ ...s, additions: (s.additions ?? []).map(a => a.id === id ? { ...a, ...u } : a) }));
  const delAddition = (id: string) => setSt(s => ({ ...s, additions: (s.additions ?? []).filter(a => a.id !== id) }));
  const addDisposal = () => setSt(s => ({ ...s, disposals: [...(s.disposals ?? []), { id: rid('cd'), pool: 'main', proceeds: 0 }] }));
  const updDisposal = (id: string, u: Partial<CapexDisposal>) => setSt(s => ({ ...s, disposals: (s.disposals ?? []).map(d => d.id === id ? { ...d, ...u } : d) }));
  const delDisposal = (id: string) => setSt(s => ({ ...s, disposals: (s.disposals ?? []).filter(d => d.id !== id) }));

  function apply() {
    onApply({ ...st, mainPoolCfwd: r.mainPoolCfwd, specialPoolCfwd: r.specialPoolCfwd }, r);
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]"><Calculator size={15} className="text-[var(--accent)]" /> Capital Allowances Calculator</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Pools, AIA and first-year allowances — closing balances carry forward to next year.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
          {/* Brought-forward pools */}
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Pools brought forward (TWDV)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Main pool b/fwd (18%)" value={st.mainPoolBfwd ?? 0} onChange={v => setBfwd('mainPoolBfwd', v)} />
              <Field label="Special-rate pool b/fwd (6%)" value={st.specialPoolBfwd ?? 0} onChange={v => setBfwd('specialPoolBfwd', v)} />
            </div>
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Rolled in automatically from last year's closing balances when the trade is carried forward.</p>
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
                <div className="grid grid-cols-[1fr_90px_140px_70px_28px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  <span>Description</span><span className="text-right">Cost</span><span>Treatment</span><span className="text-right">Bus %</span><span></span>
                </div>
                {(st.additions ?? []).map(a => (
                  <div key={a.id} className="grid grid-cols-[1fr_90px_140px_70px_28px] items-center gap-2">
                    <input value={a.description ?? ''} placeholder="e.g. Van" onChange={e => updAddition(a.id, { description: e.target.value })} className="input-base py-1 text-[12px]" />
                    <input type="number" value={a.cost || ''} placeholder="0" onChange={e => updAddition(a.id, { cost: Number(e.target.value) || 0 })} className="input-base py-1 text-right text-[12px]" />
                    <select value={a.treatment} onChange={e => updAddition(a.id, { treatment: e.target.value as CapexAddition['treatment'] })} className="input-base py-1 text-[12px]">
                      {TREATMENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <input type="number" value={a.businessUsePct ?? ''} placeholder="100" onChange={e => updAddition(a.id, { businessUsePct: e.target.value === '' ? undefined : Number(e.target.value) })} className="input-base py-1 text-right text-[12px]" />
                    <button onClick={() => delAddition(a.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Business-use % applies to AIA / first-year assets (sole-trader private use). Put private-use pooled assets on AIA/first-year to restrict correctly.</p>
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
        </div>

        {/* Result */}
        <div className="border-t border-black/5 bg-[var(--accent)]/[0.03] px-5 py-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-4">
            <Line label="AIA (box 49)" value={r.aia} />
            <Line label="First-year (box 55)" value={r.fya} />
            <Line label="Main WDA 18% (box 50)" value={r.wdaMain} note={r.mainSmallPool ? 'small pool' : undefined} />
            <Line label="Special WDA 6% (box 51)" value={r.wdaSpecial} note={r.specialSmallPool ? 'small pool' : undefined} />
            <Line label="Total allowances (box 57)" value={r.total} bold />
            <Line label="Balancing charge (box 59)" value={r.balancingCharge} tone={r.balancingCharge > 0 ? 'amber' : undefined} />
            <Line label="Main pool c/fwd" value={r.mainPoolCfwd} />
            <Line label="Special pool c/fwd" value={r.specialPoolCfwd} />
          </div>
          {r.aiaCapped && <p className="mt-1.5 text-[10.5px] font-semibold text-amber-700">AIA spend exceeds the £1,000,000 limit — the claim has been capped.</p>}
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
