'use client';

// R&D / Films Enhanced Expenditure calculator (CT600).
//
// A first-cut calculator for the main reliefs:
//   • R&D SME scheme — 86% additional deduction on qualifying expenditure.
//   • R&D RDEC / merged scheme — 20% expenditure credit (taxable, above the line).
//   • Creative-sector reliefs — an additional deduction at a chosen rate.
// The result feeds the CT600 trading boxes (R&D/Films Relief, or Taxable RDEC).
// Scheme rules change frequently — verify against the latest HMRC rates.

import { useState } from 'react';
import { X, Sparkles, Beaker } from 'lucide-react';
import { fmtMoney } from './data';
import type { Ct600RdCalc } from './types';

export interface RdFilmsResult {
  scheme: 'sme' | 'rdec' | 'creative';
  qualifying: number;
  additionalDeduction: number; // → rdOrFilmsRelief
  rdecCredit: number;          // → rdec
}

const SCHEMES: { value: 'sme' | 'rdec' | 'creative'; label: string; hint: string }[] = [
  { value: 'sme',      label: 'R&D — SME scheme',            hint: '86% additional deduction on qualifying expenditure' },
  { value: 'rdec',     label: 'R&D — RDEC / merged scheme',  hint: '20% taxable expenditure credit' },
  { value: 'creative', label: 'Creative-sector relief',     hint: 'Additional deduction at the sector rate' },
];

export function computeRdFilms(state: Ct600RdCalc | undefined): RdFilmsResult {
  const q = Math.round(state?.qualifyingExpenditure ?? 0);
  const scheme = state?.scheme ?? 'sme';
  if (scheme === 'rdec') return { scheme, qualifying: q, additionalDeduction: 0, rdecCredit: Math.round(q * 0.20) };
  const rate = scheme === 'creative' ? (state?.creativeRate ?? 34) / 100 : 0.86;
  return { scheme, qualifying: q, additionalDeduction: Math.round(q * rate), rdecCredit: 0 };
}

export default function RdFilmsCalculator({ state, onApply, onClose }: {
  state: Ct600RdCalc | undefined;
  onApply: (state: Ct600RdCalc, result: RdFilmsResult) => void;
  onClose: () => void;
}): JSX.Element {
  const [st, setSt] = useState<Ct600RdCalc>(() => ({
    scheme: state?.scheme ?? 'sme',
    qualifyingExpenditure: state?.qualifyingExpenditure ?? 0,
    creativeRate: state?.creativeRate ?? 34,
  }));
  const r = computeRdFilms(st);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Beaker size={16} /></div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">R&amp;D / Films Enhanced Expenditure</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Calculate the enhanced relief or credit.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Scheme</label>
            <select value={st.scheme} onChange={e => setSt(s => ({ ...s, scheme: e.target.value as Ct600RdCalc['scheme'] }))}
              className="input-base py-1.5 text-[13px] font-semibold">
              {SCHEMES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">{SCHEMES.find(s => s.value === st.scheme)?.hint}</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Qualifying expenditure</label>
            <input type="number" value={st.qualifyingExpenditure === 0 ? '' : st.qualifyingExpenditure}
              onChange={e => setSt(s => ({ ...s, qualifyingExpenditure: Number(e.target.value) || 0 }))}
              className="input-base py-1.5 text-right text-[13px]" placeholder="0.00" />
          </div>

          {st.scheme === 'creative' && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Additional-deduction rate (%)</label>
              <input type="number" value={st.creativeRate ?? 34}
                onChange={e => setSt(s => ({ ...s, creativeRate: Number(e.target.value) || 0 }))}
                className="input-base py-1.5 text-right text-[13px]" />
            </div>
          )}

          <div className="rounded-xl bg-[var(--accent)]/5 px-4 py-3">
            {st.scheme === 'rdec' ? (
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">Taxable RDEC credit (20%)</span>
                <span className="text-[16px] font-extrabold text-[var(--accent)]">{fmtMoney(r.rdecCredit)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[var(--text-primary)]">Additional deduction</span>
                <span className="text-[16px] font-extrabold text-[var(--accent)]">{fmtMoney(r.additionalDeduction)}</span>
              </div>
            )}
            <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">On {fmtMoney(r.qualifying)} qualifying expenditure. Verify the rate against the latest HMRC rules.</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="btn-secondary bg-white">Cancel</button>
          <button onClick={() => onApply(st, r)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">
            <Sparkles size={14} /> Apply to return
          </button>
        </div>
      </div>
    </div>
  );
}
