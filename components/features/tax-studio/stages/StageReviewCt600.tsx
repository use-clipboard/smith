'use client';

import { useState } from 'react';
import { Calculator, ArrowRight, Layers, Building2 } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeCt600 } from '../calc';
import { emptyCt600, fmtMoney } from '../data';
import type { TaxReturn, Ct600Data, Ct600Trading, Ct600Losses, Ct600LossStream } from '../types';

// ─── Local primitives (a trimmed-down mirror of StageReview's box widgets) ─────

function NumIn({ value, onChange, readOnly }: { value: number; onChange: (v: number) => void; readOnly?: boolean }) {
  return (
    <input
      type="number"
      value={value === 0 ? '' : value}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      onChange={e => { if (readOnly) return; onChange(Number(e.target.value) || 0); }}
      className={`input-base py-1 text-right text-[12.5px]${readOnly ? ' cursor-not-allowed bg-slate-50 text-[var(--text-muted)]' : ''}`}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

/** A labelled numeric box — editable by default, or a read-only blue computed box when `calc`. */
function Field({ label, value, onChange, calc, box }: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  calc?: boolean;
  box?: string;
}) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">{label}</label>
      {calc ? (
        <div className="input-base flex items-center justify-end py-1 text-right text-[12.5px] font-semibold text-[var(--accent)] bg-[var(--accent)]/5 border-[var(--accent)]/20">
          {fmtMoney(value)}
        </div>
      ) : (
        <NumIn value={value} onChange={onChange ?? (() => {})} />
      )}
      {box && <p className="mt-0.5 text-[9px] font-medium text-slate-400">[Box {box}]</p>}
    </div>
  );
}

/** Checkbox styled to sit in the grid — mirrors StageReview's BoxCheck. */
function Check({ label, checked, onChange, box }: { label: string; checked: boolean; onChange: (v: boolean) => void; box?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-2 text-[11px] font-medium text-[var(--text-muted)]">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      {label}{box && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">Box {box}</span>}
    </label>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[12px] ${bold ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
      <span className={`text-[12.5px] ${bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type LossStreamKey = keyof Ct600Losses;
type Tab = 'trading' | 'losses';
type SubTab = 'trading' | 'ntlr' | 'property' | 'intangibles' | 'management';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'trading', label: 'Trading profit/losses' },
  { id: 'ntlr', label: 'Non-trading loan relationship profits/deficits' },
  { id: 'property', label: 'Property business income/losses' },
  { id: 'intangibles', label: 'Non-trading losses on intangibles & Chargeable gains/losses' },
  { id: 'management', label: 'Management Expenses' },
];

export default function StageReviewCt600({ ret, patch, advance }: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const ct: Ct600Data = ret.ct600 ?? emptyCt600();
  const c = computeCt600(ct, ret.taxYear);

  const [tab, setTab] = useState<Tab>('trading');
  const [subTab, setSubTab] = useState<SubTab>('trading');

  const setCt = (u: (c: Ct600Data) => Ct600Data) => patch(r => ({ ...r, ct600: u(r.ct600 ?? emptyCt600()) }));
  const setTrading = (p: Partial<Ct600Trading>) => setCt(c0 => ({ ...c0, trading: { ...c0.trading, ...p } }));
  const setStream = <K extends LossStreamKey>(key: K, p: Partial<Ct600Losses[K]>) =>
    setCt(c0 => ({ ...c0, losses: { ...c0.losses, [key]: { ...c0.losses[key], ...p } } }));

  const t = ct.trading;
  const L = ct.losses;
  const n = (v?: number) => v ?? 0;

  // The recurring five-column loss row for a stream.
  function LossGrid({ title, streamKey, incomeComputed, bfBox, incomeBox, utilBox, grBox, cfBox }: {
    title: string;
    streamKey: LossStreamKey;
    incomeComputed?: number; // when set, the income-arising column shows a read-only computed box
    bfBox?: string; incomeBox?: string; utilBox?: string; grBox?: string; cfBox?: string;
  }) {
    const s: Ct600LossStream = L[streamKey];
    return (
      <div>
        <p className="mb-1.5 text-[13px] font-bold text-emerald-700">{title}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Field label="Loss brought forward" value={n(s.broughtForward)} box={bfBox}
            onChange={v => setStream(streamKey, { broughtForward: v } as Partial<Ct600Losses[LossStreamKey]>)} />
          {incomeComputed != null ? (
            <Field label="Income arising in this period" value={incomeComputed} calc box={incomeBox} />
          ) : (
            <Field label="Income arising in this period" value={n(s.incomeArising)} box={incomeBox}
              onChange={v => setStream(streamKey, { incomeArising: v } as Partial<Ct600Losses[LossStreamKey]>)} />
          )}
          <Field label="Loss utilised in this period" value={n(s.utilised)} box={utilBox}
            onChange={v => setStream(streamKey, { utilised: v } as Partial<Ct600Losses[LossStreamKey]>)} />
          <Field label="Surrender as group relief" value={n(s.groupRelief)} box={grBox}
            onChange={v => setStream(streamKey, { groupRelief: v } as Partial<Ct600Losses[LossStreamKey]>)} />
          <Field label="Loss carried forward" value={n(s.carriedForward)} box={cfBox}
            onChange={v => setStream(streamKey, { carriedForward: v } as Partial<Ct600Losses[LossStreamKey]>)} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StudioCard className="overflow-hidden">
        {/* Top-level tab bar */}
        <div className="flex flex-wrap gap-1.5 border-b border-black/5 px-4 py-3">
          {([
            { id: 'trading' as Tab, label: 'Trading & Professional Profits', icon: Building2 },
            { id: 'losses' as Tab, label: 'Losses & Excess Amount', icon: Layers },
          ]).map(x => {
            const on = x.id === tab;
            const Icon = x.icon;
            return (
              <button key={x.id} onClick={() => setTab(x.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${on ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/30 hover:text-[var(--text-secondary)]'}`}>
                <Icon size={13} className="shrink-0" />
                {x.label}
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {tab === 'trading' && (
            <div className="space-y-5">
              <Section title="Trading & Professional Profits">
                <Field label="Turnover" value={n(t.turnover)} onChange={v => setTrading({ turnover: v })} />
                <Field label="Profit/(loss) per account" value={n(t.profitPerAccount)} onChange={v => setTrading({ profitPerAccount: v })} />
                <Field label="Add Back" value={n(t.addBack)} onChange={v => setTrading({ addBack: v })} />
                <Field label="Adjustments" value={n(t.adjustments)} onChange={v => setTrading({ adjustments: v })} />
                <Field label="Disallowable Expenses" value={n(t.disallowableExpenses)} onChange={v => setTrading({ disallowableExpenses: v })} />
                <Field label="R&D or Films Expenditure" value={n(t.rdOrFilmsExpenditure)} onChange={v => setTrading({ rdOrFilmsExpenditure: v })} />
                <Field label="Income not credited to profit but assessable under trading profits" value={n(t.incomeNotCredited)} onChange={v => setTrading({ incomeNotCredited: v })} />
                <Field label="Balancing Charges" value={n(t.balancingCharges)} onChange={v => setTrading({ balancingCharges: v })} />
                <Field label="Taxable Research and Development Expenditure Credit (RDEC)" value={n(t.rdec)} onChange={v => setTrading({ rdec: v })} />
                <Field label="Taxable Audio Visual Expenditure Credit (AVEC)" value={n(t.avec)} onChange={v => setTrading({ avec: v })} />
                <Field label="Taxable Video Games Expenditure Credit (VGEC)" value={n(t.vgec)} onChange={v => setTrading({ vgec: v })} />
                <Field label="Income/(deficit) not assessed under trading profits" value={n(t.incomeNotAssessed)} onChange={v => setTrading({ incomeNotAssessed: v })} />
                <Field label="Expenditure not in accounts but allowable for taxation purposes" value={n(t.expenditureNotInAccounts)} onChange={v => setTrading({ expenditureNotInAccounts: v })} />
                <Field label="R&D or Films Relief" value={n(t.rdOrFilmsRelief)} onChange={v => setTrading({ rdOrFilmsRelief: v })} />
                <Field label="Capital Allowances" value={n(t.capitalAllowances)} onChange={v => setTrading({ capitalAllowances: v })} />
              </Section>

              <Section title="Trading result">
                <Field label="Profits/(Loss) before Tax Credit" value={c.taxableTradingProfit} calc />
                <Field label="R&D/Films Tax Credit — amount available to surrender for conversion" value={n(t.rdFilmsTaxCreditSurrender)} onChange={v => setTrading({ rdFilmsTaxCreditSurrender: v })} />
                <Field label="Profit/(Loss) after Tax Credits" value={c.taxableTradingProfit} calc />
                <Field label="Trading Losses Summary" value={n(L.trading.carriedForward)} calc />
              </Section>
            </div>
          )}

          {tab === 'losses' && (
            <div className="space-y-5">
              {/* Second-level sub-tabs (subtle underline style) */}
              <div className="flex flex-wrap gap-1 border-b border-black/5">
                {SUB_TABS.map(s => {
                  const on = s.id === subTab;
                  return (
                    <button key={s.id} onClick={() => setSubTab(s.id)}
                      className={`-mb-px border-b-2 px-3 py-2 text-[11.5px] font-semibold transition-colors ${on ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {subTab === 'trading' && (
                <div className="space-y-5">
                  <LossGrid title="Trading Income" streamKey="trading" />
                  <Section title="Trading loss detail">
                    <Field label="Losses arising before 1 Apr 2017" value={n(L.trading.incomeBefore2017)} onChange={v => setStream('trading', { incomeBefore2017: v })} />
                    <Field label="Losses arising on/after 1 Apr 2017" value={n(L.trading.incomeAfter2017)} onChange={v => setStream('trading', { incomeAfter2017: v })} />
                    <Field label="Loss brought back from a future AP" value={n(L.trading.broughtBackFromFuture)} onChange={v => setStream('trading', { broughtBackFromFuture: v })} />
                    <Field label="Carried forward — before 1 Apr 2017" value={n(L.trading.cfBefore2017)} onChange={v => setStream('trading', { cfBefore2017: v })} />
                    <Field label="Carried forward — on/after 1 Apr 2017" value={n(L.trading.cfAfter2017)} onChange={v => setStream('trading', { cfAfter2017: v })} />
                    <Field label="Loss carried back" value={n(L.trading.carriedBack)} onChange={v => setStream('trading', { carriedBack: v })} />
                  </Section>
                  <Section title="Losses brought forward to be set against">
                    <Field label="Trading profits" value={n(L.trading.bfSetTradingProfits)} box="160" onChange={v => setStream('trading', { bfSetTradingProfits: v })} />
                    <Field label="Investment income" value={n(L.trading.bfSetInvestmentIncome)} box="225" onChange={v => setStream('trading', { bfSetInvestmentIncome: v })} />
                    <Field label="Loss c/f claimed against total profits" value={n(L.trading.cfClaimedTotalProfits)} box="285" onChange={v => setStream('trading', { cfClaimedTotalProfits: v })} />
                    <Field label="Surrendered for group relief" value={n(L.trading.bfSurrenderedGroupRelief)} onChange={v => setStream('trading', { bfSurrenderedGroupRelief: v })} />
                  </Section>
                </div>
              )}

              {subTab === 'ntlr' && (
                <div className="space-y-5">
                  <LossGrid title="Non Trading Income" streamKey="ntlr"
                    incomeComputed={n(L.ntlr.incomeLoanRelationships) + n(L.ntlr.incomeNonLoanDerivatives)} />
                  <Section title="Income arising in AP">
                    <Field label="Loan relationships & derivative contracts" value={n(L.ntlr.incomeLoanRelationships)} box="170" onChange={v => setStream('ntlr', { incomeLoanRelationships: v })} />
                    <Field label="Non-loan relationships derivative contracts" value={n(L.ntlr.incomeNonLoanDerivatives)} box="175" onChange={v => setStream('ntlr', { incomeNonLoanDerivatives: v })} />
                    <Check label="Box 170 includes a carried-back loss from a future AP" box="172"
                      checked={!!L.ntlr.includesCarriedBackFuture} onChange={v => setStream('ntlr', { includesCarriedBackFuture: v })} />
                    <Field label="Loss carried back" value={n(L.ntlr.carriedBack)} onChange={v => setStream('ntlr', { carriedBack: v })} />
                  </Section>
                  <Section title="Losses brought forward to be set against">
                    <Field label="Non-trade profits" value={n(L.ntlr.bfSetNonTradeProfits)} box="230" onChange={v => setStream('ntlr', { bfSetNonTradeProfits: v })} />
                    <Field label="Total profits" value={n(L.ntlr.bfSetTotalProfits)} box="263" onChange={v => setStream('ntlr', { bfSetTotalProfits: v })} />
                  </Section>
                </div>
              )}

              {subTab === 'property' && (
                <div className="space-y-5">
                  <LossGrid title="UK land and buildings (Formerly Schedule A)" streamKey="property" bfBox="190" cfBox="250" />
                  <Section title="Losses Utilised">
                    <Field label="Losses of the current period" value={n(L.property.lossesCurrentPeriod)} onChange={v => setStream('property', { lossesCurrentPeriod: v })} />
                    <Field label="Losses brought forward utilised" value={n(L.property.lossesBroughtForwardUtil)} onChange={v => setStream('property', { lossesBroughtForwardUtil: v })} />
                  </Section>
                  <div className="space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Overseas income/losses</p>
                    <LossGrid title="Overseas trading losses" streamKey="overseasTrading" />
                    <LossGrid title="Overseas land & property" streamKey="overseasProperty" />
                  </div>
                </div>
              )}

              {subTab === 'intangibles' && (
                <div className="space-y-5">
                  <LossGrid title="Non-trading losses on intangible fixed assets" streamKey="intangibles" bfBox="195" cfBox="265" />
                  <LossGrid title="Other income" streamKey="otherIncome" bfBox="205" />
                  <LossGrid title="Chargeable gains/losses" streamKey="chargeableGains" bfBox="210" cfBox="215" />
                </div>
              )}

              {subTab === 'management' && (
                <div className="space-y-5">
                  <LossGrid title="Management Expenses" streamKey="managementExpenses" bfBox="245" />
                  <LossGrid title="Interest Distributions" streamKey="interestDistributions" />
                </div>
              )}
            </div>
          )}
        </div>
      </StudioCard>

      <Ct600ComputationCard c={c} />

      <div className="flex justify-end">
        <button onClick={advance} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-[var(--accent)]/90">
          Continue to approval <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Corporation-tax computation card ──────────────────────────────────────────

function Ct600ComputationCard({ c }: { c: ReturnType<typeof computeCt600> }): JSX.Element {
  return (
    <StudioCard className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]">
          <Calculator size={15} /> Tax computation
        </h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{c.taxYear}</span>
      </div>

      <Row label="Turnover" value={fmtMoney(c.turnover)} />
      <Row label="Taxable trading profit" value={fmtMoney(c.taxableTradingProfit)} />
      {c.nonTradingLoanProfit > 0 && <Row label="Non-trading loan profit" value={fmtMoney(c.nonTradingLoanProfit)} />}
      {c.propertyProfit > 0 && <Row label="Property profit" value={fmtMoney(c.propertyProfit)} />}
      {c.overseasProfit > 0 && <Row label="Overseas profit" value={fmtMoney(c.overseasProfit)} />}
      {c.intangiblesProfit > 0 && <Row label="Non-trading intangibles" value={fmtMoney(c.intangiblesProfit)} />}
      {c.chargeableGains > 0 && <Row label="Chargeable gains" value={fmtMoney(c.chargeableGains)} />}
      {c.otherIncome > 0 && <Row label="Other income" value={fmtMoney(c.otherIncome)} />}
      <Row label="Total profits" value={fmtMoney(c.totalProfits)} bold />
      {c.lossesReliefs > 0 && <Row label="Less: losses & reliefs" value={`(${fmtMoney(c.lossesReliefs)})`} />}

      <div className="my-2 rounded-xl bg-[var(--accent)]/5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">Profits chargeable to Corporation Tax</span>
          <span className="text-[15px] font-extrabold text-[var(--accent)]">{fmtMoney(c.pctct)}</span>
        </div>
        <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">Corporation Tax @ {c.ctRatePct.toFixed(1)}%</p>
      </div>

      {c.marginalRelief > 0 && <Row label="Marginal relief" value={`(${fmtMoney(c.marginalRelief)})`} />}

      <div className="mt-2 flex items-center justify-between border-t border-black/5 pt-2">
        <span className="text-[13px] font-bold text-[var(--text-primary)]">Corporation Tax</span>
        <span className="text-[19px] font-extrabold text-[var(--accent)]">{fmtMoney(c.corporationTax)}</span>
      </div>
      <p className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <span>Effective rate</span>
        <span>{(c.effectiveRate * 100).toFixed(1)}%</span>
      </p>

      <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">{c.notes[c.notes.length - 1]}</p>
    </StudioCard>
  );
}
