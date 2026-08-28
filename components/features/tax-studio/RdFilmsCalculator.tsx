'use client';

// R&D / Films / Creative Enhanced Expenditure calculator (CT600) — multi-entry.
//
// A company can have several claims: R&D plus a creative claim, or multiple
// productions (each film / game / production is its own expenditure credit, at
// its own rate). Each entry is calculated separately and the results aggregate
// to the CT600 trading boxes (RDEC → box 530, AVEC/VGEC → box 541, SME / ERIS /
// creative additional deduction → boxes 660/665).
//
// R&D: merged RDEC 20% · ERIS (R&D-intensive SME, 86% deduction + 14.5% payable)
//   · legacy SME 86% · legacy RDEC 20%.  Creative: AVEC (film/HETV 34%,
//   animation/children's 39%) · VGEC 34% · Theatre/Orchestra/Museums deduction.
// Rates are shown on every line — verify against the latest HMRC / Capium figures.

import { useState } from 'react';
import { X, Sparkles, Beaker, Plus, Trash2 } from 'lucide-react';
import { fmtMoney } from './data';
import type { Ct600RdCalc, Ct600RdEntry } from './types';

export interface RdFilmsResult {
  scheme: NonNullable<Ct600RdEntry['scheme']>;
  qualifying: number;
  rate: number;
  additionalDeduction: number; // → rdOrFilmsRelief (SME / ERIS / creative deduction)
  rdecCredit: number;          // → rdec (merged / legacy RDEC)
  avecCredit: number;          // → avec
  vgecCredit: number;          // → vgec
  payableCredit: number;       // payable credit (loss-making SME / ERIS)
  netBenefit: number;
  cappedByPaye: boolean;
}
export interface RdFilmsTotals { rdec: number; avec: number; vgec: number; additionalDeduction: number; payableCredit: number; qualifying: number }

const CT_MAIN = 0.25;
const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const SCHEMES: { value: NonNullable<Ct600RdEntry['scheme']>; label: string; group: string; hint: string }[] = [
  { value: 'merged',   label: 'R&D — Merged scheme (RDEC, from Apr 2024)', group: 'Research & Development', hint: '20% taxable expenditure credit' },
  { value: 'eris',     label: 'R&D — ERIS (R&D-intensive SME)',            group: 'Research & Development', hint: '86% additional deduction + 14.5% payable credit' },
  { value: 'sme',      label: 'R&D — Legacy SME (pre-Apr 2024)',           group: 'Research & Development', hint: '86% additional deduction; 10% payable (14.5% if intensive)' },
  { value: 'rdec',     label: 'R&D — Legacy RDEC',                          group: 'Research & Development', hint: '20% taxable expenditure credit' },
  { value: 'avec',     label: 'Creative — Audio-Visual (AVEC)',            group: 'Creative sector', hint: 'Film / high-end TV 34%, animation / children’s TV 39%' },
  { value: 'vgec',     label: 'Creative — Video Games (VGEC)',             group: 'Creative sector', hint: '34% expenditure credit' },
  { value: 'creative', label: 'Creative — Theatre / Orchestra / Museums',  group: 'Creative sector', hint: 'Additional deduction at the sector rate' },
];
const schemeMeta = (v?: Ct600RdEntry['scheme']) => SCHEMES.find(s => s.value === v);

export function computeRdFilmsEntry(e: Ct600RdEntry | undefined): RdFilmsResult {
  const q = Math.round(Math.max(0, e?.qualifyingExpenditure ?? 0));
  const scheme = e?.scheme ?? 'merged';
  const round = (n: number) => Math.round(n);
  const base: RdFilmsResult = { scheme, qualifying: q, rate: 0, additionalDeduction: 0, rdecCredit: 0, avecCredit: 0, vgecCredit: 0, payableCredit: 0, netBenefit: 0, cappedByPaye: false };
  const payeCap = e?.payeNic != null ? 20_000 + 3 * Math.max(0, e.payeNic) : Infinity;
  const applyCap = (v: number): [number, boolean] => (v > payeCap ? [round(payeCap), true] : [round(v), false]);

  switch (scheme) {
    case 'merged':
    case 'rdec': {
      const rate = 20; const rdecCredit = round(q * rate / 100);
      return { ...base, rate, rdecCredit, netBenefit: round(rdecCredit * (1 - CT_MAIN)) };
    }
    case 'eris': {
      const rate = 86; const additionalDeduction = round(q * rate / 100);
      const surrender = e?.surrenderableLoss ?? q + additionalDeduction;
      const [payableCredit, cappedByPaye] = e?.lossMaking ? applyCap(surrender * 0.145) : [0, false];
      return { ...base, rate, additionalDeduction, payableCredit, cappedByPaye, netBenefit: payableCredit };
    }
    case 'sme': {
      const rate = 86; const additionalDeduction = round(q * rate / 100);
      const surrender = e?.surrenderableLoss ?? q + additionalDeduction;
      const [payableCredit, cappedByPaye] = e?.lossMaking ? applyCap(surrender * 0.10) : [0, false];
      return { ...base, rate, additionalDeduction, payableCredit, cappedByPaye, netBenefit: payableCredit };
    }
    case 'avec': {
      const rate = e?.avecType === 'animation-children' ? 39 : 34; const avecCredit = round(q * rate / 100);
      return { ...base, rate, avecCredit, netBenefit: round(avecCredit * (1 - CT_MAIN)) };
    }
    case 'vgec': {
      const rate = 34; const vgecCredit = round(q * rate / 100);
      return { ...base, rate, vgecCredit, netBenefit: round(vgecCredit * (1 - CT_MAIN)) };
    }
    case 'creative': {
      const rate = e?.rate ?? 45; const additionalDeduction = round(q * rate / 100);
      return { ...base, rate, additionalDeduction };
    }
  }
}

// The entries for a calc — migrating a legacy single-entry state into a list.
export function rdEntries(state: Ct600RdCalc | undefined): Ct600RdEntry[] {
  if (state?.entries && state.entries.length) return state.entries;
  if (state && (state.scheme || state.qualifyingExpenditure)) return [{
    id: 'legacy', scheme: state.scheme, qualifyingExpenditure: state.qualifyingExpenditure,
    avecType: state.avecType, rate: state.rate ?? state.creativeRate, lossMaking: state.lossMaking,
    surrenderableLoss: state.surrenderableLoss, payeNic: state.payeNic,
  }];
  return [];
}

export function computeRdFilms(state: Ct600RdCalc | undefined): { lines: { entry: Ct600RdEntry; result: RdFilmsResult }[]; totals: RdFilmsTotals } {
  const lines = rdEntries(state).map(entry => ({ entry, result: computeRdFilmsEntry(entry) }));
  const totals = lines.reduce<RdFilmsTotals>((t, { result }) => ({
    rdec: t.rdec + result.rdecCredit, avec: t.avec + result.avecCredit, vgec: t.vgec + result.vgecCredit,
    additionalDeduction: t.additionalDeduction + result.additionalDeduction,
    payableCredit: t.payableCredit + result.payableCredit, qualifying: t.qualifying + result.qualifying,
  }), { rdec: 0, avec: 0, vgec: 0, additionalDeduction: 0, payableCredit: 0, qualifying: 0 });
  return { lines, totals };
}

export default function RdFilmsCalculator({ state, onApply, onClose }: {
  state: Ct600RdCalc | undefined;
  onApply: (state: Ct600RdCalc, totals: RdFilmsTotals) => void;
  onClose: () => void;
}): JSX.Element {
  const [entries, setEntries] = useState<Ct600RdEntry[]>(() => {
    const existing = rdEntries(state);
    return existing.length ? existing.map(e => ({ ...e, id: e.id || rid('rd') })) : [{ id: rid('rd'), scheme: 'merged', qualifyingExpenditure: 0 }];
  });
  const { lines, totals } = computeRdFilms({ entries });

  const add = () => setEntries(es => [...es, { id: rid('rd'), scheme: 'merged', qualifyingExpenditure: 0 }]);
  const upd = (id: string, u: Partial<Ct600RdEntry>) => setEntries(es => es.map(e => e.id === id ? { ...e, ...u } : e));
  const del = (id: string) => setEntries(es => es.filter(e => e.id !== id));

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Beaker size={16} /></div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">R&amp;D / Films Enhanced Expenditure</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Add each claim — R&amp;D and creative-sector productions calculate separately.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
          {lines.map(({ entry: e, result: r }, i) => {
            const isRnd = e.scheme === 'merged' || e.scheme === 'eris' || e.scheme === 'sme' || e.scheme === 'rdec';
            const showPayable = e.scheme === 'eris' || e.scheme === 'sme';
            return (
              <div key={e.id} className="rounded-xl border border-[var(--border)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input value={e.description ?? ''} placeholder={`Claim ${i + 1} — e.g. ${isRnd ? 'R&D 2025' : 'Film — Project X'}`} onChange={ev => upd(e.id, { description: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
                  <button onClick={() => del(e.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Scheme</label>
                    <select value={e.scheme} onChange={ev => upd(e.id, { scheme: ev.target.value as Ct600RdEntry['scheme'] })} className="input-base py-1.5 text-[12.5px] font-medium">
                      <optgroup label="Research & Development">{SCHEMES.filter(s => s.group === 'Research & Development').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</optgroup>
                      <optgroup label="Creative sector">{SCHEMES.filter(s => s.group === 'Creative sector').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</optgroup>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Qualifying expenditure</label>
                    <input type="number" value={e.qualifyingExpenditure === 0 ? '' : e.qualifyingExpenditure} placeholder="0.00" onChange={ev => upd(e.id, { qualifyingExpenditure: Number(ev.target.value) || 0 })} className="input-base py-1.5 text-right text-[12.5px]" />
                  </div>
                  {e.scheme === 'avec' && (
                    <div>
                      <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Production type</label>
                      <select value={e.avecType ?? 'film-hetv'} onChange={ev => upd(e.id, { avecType: ev.target.value as Ct600RdEntry['avecType'] })} className="input-base py-1.5 text-[12.5px]">
                        <option value="film-hetv">Film / high-end TV — 34%</option>
                        <option value="animation-children">Animation / children&apos;s TV — 39%</option>
                      </select>
                    </div>
                  )}
                  {e.scheme === 'creative' && (
                    <div>
                      <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Deduction rate (%)</label>
                      <input type="number" value={e.rate ?? 45} onChange={ev => upd(e.id, { rate: Number(ev.target.value) || 0 })} className="input-base py-1.5 text-right text-[12.5px]" />
                    </div>
                  )}
                </div>
                {showPayable && (
                  <div className="mt-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[11.5px] font-medium text-[var(--text-secondary)]">
                      <input type="checkbox" checked={!!e.lossMaking} onChange={ev => upd(e.id, { lossMaking: ev.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" /> Loss-making — surrender the loss for a payable credit
                    </label>
                    {e.lossMaking && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input type="number" value={e.surrenderableLoss ?? ''} placeholder="Surrenderable loss" onChange={ev => upd(e.id, { surrenderableLoss: ev.target.value === '' ? undefined : Number(ev.target.value) })} className="input-base py-1 text-right text-[12px]" />
                        <input type="number" value={e.payeNic ?? ''} placeholder="Relevant PAYE/NIC" onChange={ev => upd(e.id, { payeNic: ev.target.value === '' ? undefined : Number(ev.target.value) })} className="input-base py-1 text-right text-[12px]" />
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between rounded-lg bg-[var(--accent)]/5 px-3 py-1.5 text-[12px]">
                  <span className="text-[var(--text-muted)]">{schemeMeta(e.scheme)?.hint}</span>
                  <span className="font-bold text-[var(--accent)]">
                    {r.rdecCredit > 0 ? `RDEC ${fmtMoney(r.rdecCredit)}` : r.avecCredit > 0 ? `AVEC ${fmtMoney(r.avecCredit)}` : r.vgecCredit > 0 ? `VGEC ${fmtMoney(r.vgecCredit)}` : `Deduction ${fmtMoney(r.additionalDeduction)}`}
                    {showPayable && e.lossMaking && r.payableCredit > 0 ? ` · payable ${fmtMoney(r.payableCredit)}` : ''}
                  </span>
                </div>
              </div>
            );
          })}
          <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add claim</button>

          {lines.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-black/[0.015] px-4 py-3 text-[12px]">
              <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Totals to the return</p>
              {totals.rdec > 0 && <Row label="Taxable R&D expenditure credit (RDEC) — box 530" value={totals.rdec} />}
              {totals.avec > 0 && <Row label="Audio-Visual expenditure credit (AVEC) — box 541" value={totals.avec} />}
              {totals.vgec > 0 && <Row label="Video Games expenditure credit (VGEC) — box 541" value={totals.vgec} />}
              {totals.additionalDeduction > 0 && <Row label="Additional deduction (R&D / creative) — box 660/665" value={totals.additionalDeduction} strong />}
              {totals.payableCredit > 0 && <Row label="Payable credit" value={totals.payableCredit} />}
              <p className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">On {fmtMoney(totals.qualifying)} total qualifying expenditure across {lines.length} claim{lines.length === 1 ? '' : 's'}. Verify the rates against the latest HMRC / Capium figures.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="btn-secondary bg-white">Cancel</button>
          <button onClick={() => onApply({ entries }, totals)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90">
            <Sparkles size={14} /> Apply to return
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={strong ? 'text-[12px] font-semibold text-[var(--text-primary)]' : 'text-[11.5px] text-[var(--text-secondary)]'}>{label}</span>
      <span className={strong ? 'text-[13px] font-bold text-[var(--text-primary)]' : 'text-[12.5px] font-semibold text-[var(--text-primary)]'}>{fmtMoney(value)}</span>
    </div>
  );
}
