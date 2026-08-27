'use client';

// R&D / Films / Creative Enhanced Expenditure calculator (CT600).
//
// R&D reliefs:
//   • Merged scheme (RDEC) — 20% taxable expenditure credit (APs from 1 Apr 2024).
//   • ERIS — R&D-intensive loss-making SME: 86% additional deduction + 14.5%
//     payable credit on the surrenderable loss.
//   • Legacy SME (pre-Apr 2024) — 86% additional deduction; 10% payable (14.5% if
//     R&D-intensive).
//   • Legacy RDEC — 20% taxable expenditure credit.
// Creative-sector expenditure credits / reliefs:
//   • AVEC — Audio-Visual Expenditure Credit: film & high-end TV 34%, animation &
//     children's TV 39%.
//   • VGEC — Video Games Expenditure Credit 34%.
//   • Theatre / Orchestra / Museums additional deduction (rate entered).
//
// Rates are shown on every line so they can be checked against the latest HMRC /
// Capium figures — verify before relying on the numbers; they change most Aprils.

import { useState } from 'react';
import { X, Sparkles, Beaker } from 'lucide-react';
import { fmtMoney } from './data';
import type { Ct600RdCalc } from './types';

export interface RdFilmsResult {
  scheme: NonNullable<Ct600RdCalc['scheme']>;
  qualifying: number;
  rate: number;                // headline rate applied (%)
  additionalDeduction: number; // → rdOrFilmsRelief (SME / ERIS / creative deduction)
  rdecCredit: number;          // → rdec (merged / legacy RDEC)
  avecCredit: number;          // → avec
  vgecCredit: number;          // → vgec
  payableCredit: number;       // payable credit (loss-making SME / ERIS) — display
  netBenefit: number;          // rough net tax/cash benefit — display
  cappedByPaye: boolean;
}

// CT main rate used for the illustrative net-benefit figure on taxable credits.
const CT_MAIN = 0.25;

const SCHEMES: { value: NonNullable<Ct600RdCalc['scheme']>; label: string; group: string; hint: string }[] = [
  { value: 'merged',   label: 'R&D — Merged scheme (RDEC, from Apr 2024)', group: 'Research & Development', hint: '20% taxable expenditure credit' },
  { value: 'eris',     label: 'R&D — ERIS (R&D-intensive SME)',            group: 'Research & Development', hint: '86% additional deduction + 14.5% payable credit' },
  { value: 'sme',      label: 'R&D — Legacy SME (pre-Apr 2024)',           group: 'Research & Development', hint: '86% additional deduction; 10% payable (14.5% if intensive)' },
  { value: 'rdec',     label: 'R&D — Legacy RDEC',                          group: 'Research & Development', hint: '20% taxable expenditure credit' },
  { value: 'avec',     label: 'Creative — Audio-Visual (AVEC)',            group: 'Creative sector', hint: 'Film / high-end TV 34%, animation / children’s TV 39%' },
  { value: 'vgec',     label: 'Creative — Video Games (VGEC)',             group: 'Creative sector', hint: '34% expenditure credit' },
  { value: 'creative', label: 'Creative — Theatre / Orchestra / Museums',  group: 'Creative sector', hint: 'Additional deduction at the sector rate' },
];

export function computeRdFilms(state: Ct600RdCalc | undefined): RdFilmsResult {
  const q = Math.round(Math.max(0, state?.qualifyingExpenditure ?? 0));
  const scheme = state?.scheme ?? 'merged';
  const round = (n: number) => Math.round(n);
  const base: RdFilmsResult = { scheme, qualifying: q, rate: 0, additionalDeduction: 0, rdecCredit: 0, avecCredit: 0, vgecCredit: 0, payableCredit: 0, netBenefit: 0, cappedByPaye: false };

  // PAYE/NIC cap on a payable SME/ERIS credit: £20,000 + 300% of relevant PAYE/NIC.
  const payeCap = state?.payeNic != null ? 20_000 + 3 * Math.max(0, state.payeNic) : Infinity;
  const applyCap = (v: number): [number, boolean] => (v > payeCap ? [round(payeCap), true] : [round(v), false]);

  switch (scheme) {
    case 'merged':
    case 'rdec': {
      const rate = 20;
      const rdecCredit = round(q * rate / 100);
      return { ...base, rate, rdecCredit, netBenefit: round(rdecCredit * (1 - CT_MAIN)) };
    }
    case 'eris': {
      const rate = 86;
      const additionalDeduction = round(q * rate / 100);
      // Surrenderable loss defaults to the enhanced spend (q + 86%) if not given.
      const surrender = state?.surrenderableLoss ?? q + additionalDeduction;
      const [payableCredit, cappedByPaye] = state?.lossMaking ? applyCap(surrender * 0.145) : [0, false];
      return { ...base, rate, additionalDeduction, payableCredit, cappedByPaye, netBenefit: payableCredit };
    }
    case 'sme': {
      const rate = 86;
      const additionalDeduction = round(q * rate / 100);
      const payRate = state?.lossMaking ? 0.10 : 0; // 14.5% for intensive is handled via ERIS
      const surrender = state?.surrenderableLoss ?? q + additionalDeduction;
      const [payableCredit, cappedByPaye] = state?.lossMaking ? applyCap(surrender * payRate) : [0, false];
      return { ...base, rate, additionalDeduction, payableCredit, cappedByPaye, netBenefit: payableCredit };
    }
    case 'avec': {
      const rate = state?.avecType === 'animation-children' ? 39 : 34;
      const avecCredit = round(q * rate / 100);
      return { ...base, rate, avecCredit, netBenefit: round(avecCredit * (1 - CT_MAIN)) };
    }
    case 'vgec': {
      const rate = 34;
      const vgecCredit = round(q * rate / 100);
      return { ...base, rate, vgecCredit, netBenefit: round(vgecCredit * (1 - CT_MAIN)) };
    }
    case 'creative': {
      const rate = state?.rate ?? state?.creativeRate ?? 45;
      const additionalDeduction = round(q * rate / 100);
      return { ...base, rate, additionalDeduction };
    }
  }
}

export default function RdFilmsCalculator({ state, onApply, onClose }: {
  state: Ct600RdCalc | undefined;
  onApply: (state: Ct600RdCalc, result: RdFilmsResult) => void;
  onClose: () => void;
}): JSX.Element {
  const [st, setSt] = useState<Ct600RdCalc>(() => ({
    scheme: state?.scheme ?? 'merged',
    qualifyingExpenditure: state?.qualifyingExpenditure ?? 0,
    avecType: state?.avecType ?? 'film-hetv',
    rate: state?.rate,
    lossMaking: state?.lossMaking ?? false,
    surrenderableLoss: state?.surrenderableLoss,
    payeNic: state?.payeNic,
    creativeRate: state?.creativeRate ?? 45,
  }));
  const r = computeRdFilms(st);
  const set = (u: Partial<Ct600RdCalc>) => setSt(s => ({ ...s, ...u }));
  const isRnd = st.scheme === 'merged' || st.scheme === 'eris' || st.scheme === 'sme' || st.scheme === 'rdec';
  const showPayable = st.scheme === 'eris' || st.scheme === 'sme';
  const meta = SCHEMES.find(s => s.value === st.scheme);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Beaker size={16} /></div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">R&amp;D / Films Enhanced Expenditure</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Calculate the enhanced relief, credit or payable amount.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Scheme</label>
            <select value={st.scheme} onChange={e => set({ scheme: e.target.value as Ct600RdCalc['scheme'] })}
              className="input-base py-1.5 text-[13px] font-semibold">
              <optgroup label="Research & Development">
                {SCHEMES.filter(s => s.group === 'Research & Development').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </optgroup>
              <optgroup label="Creative sector">
                {SCHEMES.filter(s => s.group === 'Creative sector').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </optgroup>
            </select>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">{meta?.hint}</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Qualifying expenditure</label>
            <input type="number" value={st.qualifyingExpenditure === 0 ? '' : st.qualifyingExpenditure}
              onChange={e => set({ qualifyingExpenditure: Number(e.target.value) || 0 })}
              className="input-base py-1.5 text-right text-[13px]" placeholder="0.00" />
          </div>

          {st.scheme === 'avec' && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Production type</label>
              <select value={st.avecType ?? 'film-hetv'} onChange={e => set({ avecType: e.target.value as Ct600RdCalc['avecType'] })} className="input-base py-1.5 text-[13px]">
                <option value="film-hetv">Film / high-end TV — 34%</option>
                <option value="animation-children">Animation / children&apos;s TV — 39%</option>
              </select>
            </div>
          )}

          {st.scheme === 'creative' && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Additional-deduction rate (%)</label>
              <input type="number" value={st.rate ?? st.creativeRate ?? 45} onChange={e => set({ rate: Number(e.target.value) || 0 })} className="input-base py-1.5 text-right text-[13px]" />
              <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">e.g. Theatre 40% (non-touring) / 45% (touring); Orchestra 45%; Museums 40% / 45%.</p>
            </div>
          )}

          {showPayable && (
            <div className="space-y-3 rounded-xl border border-[var(--border)] bg-black/[0.015] px-3 py-3">
              <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
                <input type="checkbox" checked={!!st.lossMaking} onChange={e => set({ lossMaking: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                Loss-making — surrender the loss for a payable credit
              </label>
              {st.lossMaking && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Surrenderable loss</label>
                    <input type="number" value={st.surrenderableLoss ?? ''} placeholder="auto" onChange={e => set({ surrenderableLoss: e.target.value === '' ? undefined : Number(e.target.value) })} className="input-base py-1 text-right text-[12.5px]" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Relevant PAYE/NIC</label>
                    <input type="number" value={st.payeNic ?? ''} placeholder="no cap" onChange={e => set({ payeNic: e.target.value === '' ? undefined : Number(e.target.value) })} className="input-base py-1 text-right text-[12.5px]" />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl bg-[var(--accent)]/5 px-4 py-3 text-[12px]">
            {(st.scheme === 'merged' || st.scheme === 'rdec') && <Row label={`Taxable expenditure credit (${r.rate}%)`} value={r.rdecCredit} strong />}
            {st.scheme === 'avec' && <Row label={`Audio-Visual expenditure credit (${r.rate}%)`} value={r.avecCredit} strong />}
            {st.scheme === 'vgec' && <Row label={`Video Games expenditure credit (${r.rate}%)`} value={r.vgecCredit} strong />}
            {(st.scheme === 'sme' || st.scheme === 'eris' || st.scheme === 'creative') && <Row label={`Additional deduction (${r.rate}%)`} value={r.additionalDeduction} strong />}
            {showPayable && st.lossMaking && <Row label="Payable credit" value={r.payableCredit} />}
            {(r.rdecCredit > 0 || r.avecCredit > 0 || r.vgecCredit > 0) && <Row label="Net benefit (after CT @ 25%)" value={r.netBenefit} muted />}
            <p className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">On {fmtMoney(r.qualifying)} qualifying expenditure. {r.cappedByPaye && 'Payable credit capped by the PAYE/NIC limit. '}Verify the rate against the latest HMRC / Capium figures.</p>
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

  function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className={`${muted ? 'text-[11px] text-[var(--text-muted)]' : 'text-[12px] font-semibold text-[var(--text-primary)]'}`}>{label}</span>
        <span className={strong ? 'text-[16px] font-extrabold text-[var(--accent)]' : `${muted ? 'text-[12px] text-[var(--text-muted)]' : 'text-[13px] font-bold text-[var(--text-primary)]'}`}>{fmtMoney(value)}</span>
      </div>
    );
  }
}
