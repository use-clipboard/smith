'use client';

// SA800 Partnership Tax Return — Review & Adjust. Mirrors StageReviewCt600: the
// user completes (or the linked Accounts Studio / Bookkeeping data auto-fills) the
// partnership's trading result, then allocates the profit to the partners via the
// Partnership Statement. Box numbers are the HMRC SA800 (2026) ones.

import { useState } from 'react';
import { ArrowRight, Building2, Calculator, Users, Plus, Trash2, ListTree, Send, Loader2, CheckCircle2, Home, PiggyBank, Globe } from 'lucide-react';
import { StudioCard } from '../primitives';
import { computeSa800, computeSa801, computeSa804, computeSa802 } from '../calc';
import { fmtMoney } from '../data';
import { findPartnerReturn, pushPartnerShare } from '../sa800PartnerFeed';
import CapitalAllowancesCalculator from '../CapitalAllowancesCalculator';
import Sa800LinkCard from '../Sa800LinkCard';
import type { TaxReturn, Sa800Data, Sa800Trading, Sa800Partner, Sa801Property, Sa804Savings, Sa802Foreign } from '../types';

type Tab = 'details' | 'trading' | 'property' | 'savings' | 'foreign' | 'partners';
const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

export default function StageReviewSa800({ ret, patch, advance }: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const sa = ret.sa800 ?? { trading: {}, statement: { partners: [] } };
  const [tab, setTab] = useState<Tab>('details');
  const [caOpen, setCaOpen] = useState(false);

  const setData = (u: Partial<Sa800Data>) => patch(r => ({ ...r, sa800: { ...(r.sa800 as Sa800Data), ...u } }));
  const setTrading = (u: Partial<Sa800Trading>) => patch(r => {
    const s = r.sa800 as Sa800Data;
    return { ...r, sa800: { ...s, trading: { ...s.trading, ...u } } };
  });
  const setPartners = (partners: Sa800Partner[]) => patch(r => {
    const s = r.sa800 as Sa800Data;
    return { ...r, sa800: { ...s, statement: { ...s.statement, partners } } };
  });
  const setProperty = (u: Partial<Sa801Property>) => patch(r => {
    const s = r.sa800 as Sa800Data;
    return { ...r, sa800: { ...s, property: { ...s.property, ...u } } };
  });
  const setSavings = (u: Partial<Sa804Savings>) => patch(r => {
    const s = r.sa800 as Sa800Data;
    return { ...r, sa800: { ...s, savings: { ...s.savings, ...u } } };
  });
  const setForeign = (u: Partial<Sa802Foreign>) => patch(r => {
    const s = r.sa800 as Sa800Data;
    return { ...r, sa800: { ...s, foreign: { ...s.foreign, ...u } } };
  });

  const c = computeSa800(sa, ret.taxYear, { periodStart: sa.periodStart, periodEnd: sa.periodEnd });
  const t = sa.trading;
  const full = (t.accountsMode ?? 'full') === 'full';

  const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
    { id: 'details', label: 'Details', icon: Building2 },
    { id: 'trading', label: 'Trading', icon: ListTree },
    ...(sa.hasUkProperty ? [{ id: 'property' as Tab, label: 'UK property', icon: Home }] : []),
    ...(sa.hasOtherIncome ? [{ id: 'savings' as Tab, label: 'Savings & income', icon: PiggyBank }] : []),
    ...(sa.hasForeign ? [{ id: 'foreign' as Tab, label: 'Foreign', icon: Globe }] : []),
    { id: 'partners', label: `Partners${sa.statement.partners.length ? ` (${sa.statement.partners.length})` : ''}`, icon: Users },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Sa800LinkCard
        clientId={ret.clientId}
        taxYear={ret.taxYear}
        existingPartners={sa.statement.partners}
        onImportTrading={u => setTrading(u)}
        onImportPartners={partners => setPartners(partners)}
        onImportProperty={u => patch(r => { const s = r.sa800 as Sa800Data; return { ...r, sa800: { ...s, hasUkProperty: true, property: { ...s.property, ...u } } }; })}
        onPeriod={(start, end) => { if (!sa.periodStart && !sa.periodEnd) setData({ periodStart: start, periodEnd: end }); }}
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-white p-1">
        {TABS.map(x => {
          const on = x.id === tab;
          return (
            <button key={x.id} data-review-tab={x.label} onClick={() => setTab(x.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${on ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-black/5'}`}>
              <x.icon size={13} /> {x.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          {tab === 'details' && (
            <StudioCard className="space-y-5 p-5">
              <Section title="Partnership details">
                <TextField label="Name of business" value={sa.businessName ?? ''} onChange={v => setData({ businessName: v })} wide />
                <TextField label="Description of trade or profession" value={sa.tradeDescription ?? ''} onChange={v => setData({ tradeDescription: v })} wide />
                <TextField label="Accounting period start" value={sa.periodStart ?? ''} onChange={v => setData({ periodStart: v })} type="date" box="3.4" />
                <TextField label="Accounting period end" value={sa.periodEnd ?? ''} onChange={v => setData({ periodEnd: v })} type="date" box="3.5" />
                <Check label="Traditional accounting (not cash basis)" box="3.9" checked={!!sa.traditionalAccounting} onChange={v => setData({ traditionalAccounting: v })} />
                <Check label="Partnership started this year" box="3.7Q" checked={!!sa.startedInYear} onChange={v => setData({ startedInYear: v })} />
                <Check label="Partnership ceased this year" box="3.8Q" checked={!!sa.ceasedInYear} onChange={v => setData({ ceasedInYear: v })} />
              </Section>
              <Section title="What income did the partnership have? (supplementary pages)">
                <Check label="Trade or profession (Q3)" checked={sa.hasTrade ?? true} onChange={v => setData({ hasTrade: v })} />
                <Check label="UK property (Q1 → SA801)" checked={!!sa.hasUkProperty} onChange={v => setData({ hasUkProperty: v })} />
                <Check label="Foreign income (Q2 → SA802)" checked={!!sa.hasForeign} onChange={v => setData({ hasForeign: v })} />
                <Check label="Disposed of chargeable assets (Q4 → SA803)" checked={!!sa.hasDisposals} onChange={v => setData({ hasDisposals: v })} />
                <Check label="Other income / untaxed interest (Q7)" checked={!!sa.hasOtherIncome} onChange={v => setData({ hasOtherIncome: v })} />
                <Check label="A company / non-resident partner (Q5)" checked={!!sa.hasCompanyOrNonResPartner} onChange={v => setData({ hasCompanyOrNonResPartner: v })} />
              </Section>
              {sa.hasOtherIncome && (
                <Section title="Other income">
                  <Field label="Untaxed interest from UK banks / building societies" value={n(sa.untaxedInterest)} box="7.9A" onChange={v => setData({ untaxedInterest: v })} />
                </Section>
              )}
            </StudioCard>
          )}

          {tab === 'trading' && (
            <StudioCard className="space-y-5 p-5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Accounts basis</span>
                <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[12px] font-semibold">
                  <button onClick={() => setTrading({ accountsMode: 'full' })} className={`rounded-md px-2.5 py-1 ${full ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}>Full P&amp;L (£90k–£15m)</button>
                  <button onClick={() => setTrading({ accountsMode: '3line' })} className={`rounded-md px-2.5 py-1 ${!full ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}>3-line (&lt; £90k)</button>
                </div>
              </div>

              {full ? (
                <>
                  <Section title="Income">
                    <Field label="Sales / business income (turnover)" value={n(t.sales)} box="3.29" onChange={v => setTrading({ sales: v })} />
                    <Field label="Cost of sales" value={n(t.costOfSales)} box="3.46" onChange={v => setTrading({ costOfSales: v })} />
                    <Field label="Subcontractor costs" value={n(t.subcontractorCosts)} box="3.47" onChange={v => setTrading({ subcontractorCosts: v })} />
                    <Field label="Other direct costs" value={n(t.otherDirectCosts)} box="3.48" onChange={v => setTrading({ otherDirectCosts: v })} />
                    <Field label="Gross profit" value={c.grossProfit} box="3.49" calc />
                    <Field label="Other income / profits" value={n(t.otherIncome)} box="3.50" onChange={v => setTrading({ otherIncome: v })} />
                  </Section>
                  <Section title="Expenses">
                    <Field label="Employee costs" value={n(t.employeeCosts)} box="3.51" onChange={v => setTrading({ employeeCosts: v })} />
                    <Field label="Premises costs" value={n(t.premisesCosts)} box="3.52" onChange={v => setTrading({ premisesCosts: v })} />
                    <Field label="Repairs" value={n(t.repairs)} box="3.53" onChange={v => setTrading({ repairs: v })} />
                    <Field label="General admin" value={n(t.adminCosts)} box="3.54" onChange={v => setTrading({ adminCosts: v })} />
                    <Field label="Motor expenses" value={n(t.motorExpenses)} box="3.55" onChange={v => setTrading({ motorExpenses: v })} />
                    <Field label="Travel and subsistence" value={n(t.travel)} box="3.56" onChange={v => setTrading({ travel: v })} />
                    <Field label="Advertising / promotion" value={n(t.advertising)} box="3.57" onChange={v => setTrading({ advertising: v })} />
                    <Field label="Legal and professional" value={n(t.legalProfessional)} box="3.58" onChange={v => setTrading({ legalProfessional: v })} />
                    <Field label="Bad debts" value={n(t.badDebts)} box="3.59" onChange={v => setTrading({ badDebts: v })} />
                    <Field label="Interest / finance payments" value={n(t.interest)} box="3.60" onChange={v => setTrading({ interest: v })} />
                    <Field label="Other finance charges" value={n(t.otherFinance)} box="3.61" onChange={v => setTrading({ otherFinance: v })} />
                    <Field label="Depreciation / loss on sale" value={n(t.depreciation)} box="3.62" onChange={v => setTrading({ depreciation: v })} />
                    <Field label="Other expenses" value={n(t.otherExpenses)} box="3.63" onChange={v => setTrading({ otherExpenses: v })} />
                    <Field label="Total expenses" value={c.totalExpenses} box="3.64" calc />
                  </Section>
                </>
              ) : (
                <Section title="3-line account">
                  <Field label="Turnover / business receipts" value={n(t.turnover3line)} box="3.24" onChange={v => setTrading({ turnover3line: v })} />
                  <Field label="Allowable expenses" value={n(t.expenses3line)} box="3.25" onChange={v => setTrading({ expenses3line: v })} />
                  <Field label="Net profit" value={c.netProfitPerAccounts} box="3.26" calc />
                </Section>
              )}

              <Section title="Tax adjustments">
                <Field label="Disallowable expenses" value={n(t.disallowableTotal)} box="3.66" onChange={v => setTrading({ disallowableTotal: v })} />
                <Field label="Goods for own use / other additions" value={n(t.goodsOwnUse)} box="3.67" onChange={v => setTrading({ goodsOwnUse: v })} />
                <Field label="Capital allowances" value={c.capitalAllowances} box="3.22" onChange={v => setTrading({ capitalAllowances: v })} onCalc={() => setCaOpen(true)} />
                <Field label="Balancing charges" value={c.balancingCharges} box="3.23" onChange={v => setTrading({ balancingCharges: v })} />
              </Section>

              <Section title="Page 5 — CIS & charges">
                <Field label="Adjustment on change of basis" value={n(t.basisAdjustment)} box="3.82" onChange={v => setTrading({ basisAdjustment: v })} />
                <Field label="CIS deductions" value={n(t.cisDeductions)} box="3.97" onChange={v => setTrading({ cisDeductions: v })} />
                <Field label="Other tax taken off trading income" value={n(t.taxTakenOff)} box="3.98" onChange={v => setTrading({ taxTakenOff: v })} />
                <Field label="Net partnership charges" value={n(t.netPartnershipCharges)} box="3.117" onChange={v => setTrading({ netPartnershipCharges: v })} />
              </Section>
            </StudioCard>
          )}

          {tab === 'property' && (() => {
            const p = sa.property ?? {};
            const cp = computeSa801(p);
            return (
              <StudioCard className="space-y-5 p-5">
                <Section title="Income (UK property)">
                  <Field label="Rents and other income" value={n(p.rents)} box="1.21" onChange={v => setProperty({ rents: v })} />
                  <Field label="Chargeable premiums" value={n(p.chargeablePremiums)} box="1.23" onChange={v => setProperty({ chargeablePremiums: v })} />
                  <Field label="Reverse premiums" value={n(p.reversePremiums)} box="1.23A" onChange={v => setProperty({ reversePremiums: v })} />
                  <Field label="Total income" value={cp.totalIncome} box="1.24" calc />
                  <Field label="Tax deducted" value={n(p.taxDeducted)} box="1.22" onChange={v => setProperty({ taxDeducted: v })} />
                </Section>
                <Section title="Expenses">
                  <Field label="Rent, rates, insurance, ground rents" value={n(p.rentRatesInsurance)} box="1.25" onChange={v => setProperty({ rentRatesInsurance: v })} />
                  <Field label="Repairs and maintenance" value={n(p.repairs)} box="1.26" onChange={v => setProperty({ repairs: v })} />
                  <Field label="Non-residential finance costs" value={n(p.financeCostsNonResi)} box="1.27" onChange={v => setProperty({ financeCostsNonResi: v })} />
                  <Field label="Legal and professional costs" value={n(p.legalProfessional)} box="1.28" onChange={v => setProperty({ legalProfessional: v })} />
                  <Field label="Cost of services (incl. wages)" value={n(p.costOfServices)} box="1.29" onChange={v => setProperty({ costOfServices: v })} />
                  <Field label="Other expenses" value={n(p.otherExpenses)} box="1.30" onChange={v => setProperty({ otherExpenses: v })} />
                  <Field label="Total expenses" value={cp.totalExpenses} box="1.31" calc />
                  <Field label="Net profit" value={cp.netProfit} box="1.32" calc />
                </Section>
                <Section title="Tax adjustments">
                  <Field label="Private use" value={n(p.privateUse)} box="1.33" onChange={v => setProperty({ privateUse: v })} />
                  <Field label="Balancing charges" value={n(p.balancingCharges)} box="1.34" onChange={v => setProperty({ balancingCharges: v })} />
                  <Field label="Annual Investment Allowance" value={n(p.aia)} box="1.35A" onChange={v => setProperty({ aia: v })} />
                  <Field label="Electric charge-point allowance" value={n(p.chargePointAllowance)} box="1.35B" onChange={v => setProperty({ chargePointAllowance: v })} />
                  <Field label="Structures & Buildings Allowance" value={n(p.sba)} box="1.35C" onChange={v => setProperty({ sba: v })} />
                  <Field label="Freeports/IZ SBA" value={n(p.freeportsSba)} box="1.35D" onChange={v => setProperty({ freeportsSba: v })} />
                  <Field label="Zero-emission car allowance" value={n(p.zeroEmissionCar)} box="1.35E" onChange={v => setProperty({ zeroEmissionCar: v })} />
                  <Field label="All other capital allowances" value={n(p.otherCapitalAllowances)} box="1.36" onChange={v => setProperty({ otherCapitalAllowances: v })} />
                  <Field label="Costs of replacing domestic items" value={n(p.replacingDomesticItems)} box="1.37" onChange={v => setProperty({ replacingDomesticItems: v })} />
                  <Field label="Residential finance costs" value={n(p.residentialFinanceCosts)} box="1.40" onChange={v => setProperty({ residentialFinanceCosts: v })} />
                  <Field label="Profit for return period" value={cp.profitForPeriod} box="1.39" calc />
                </Section>
              </StudioCard>
            );
          })()}

          {tab === 'savings' && (() => {
            const s = sa.savings ?? {};
            const cs = computeSa804(s);
            return (
              <StudioCard className="space-y-5 p-5">
                <Section title="Untaxed UK interest (→ box 13)">
                  <Field label="Untaxed UK interest" value={n(s.untaxedInterest)} box="7.3" onChange={v => setSavings({ untaxedInterest: v })} />
                  <Field label="National Savings & Investments" value={n(s.nationalSavings)} box="7.4" onChange={v => setSavings({ nationalSavings: v })} />
                  <Field label="Other UK savings income" value={n(s.otherUntaxedSavings)} box="7.5" onChange={v => setSavings({ otherUntaxedSavings: v })} />
                  <Field label="Total untaxed interest" value={cs.untaxedInterest} box="7.6" calc />
                </Section>
                <Section title="Taxed UK interest (→ box 22)">
                  <Field label="Taxed interest — gross" value={n(s.taxedInterestGross)} box="7.9" onChange={v => setSavings({ taxedInterestGross: v })} />
                  <Field label="Taxed interest — tax deducted" value={n(s.taxedInterestTax)} box="7.8" onChange={v => setSavings({ taxedInterestTax: v })} />
                  <Field label="Other taxed income — gross" value={n(s.otherTaxedGross)} box="7.16" onChange={v => setSavings({ otherTaxedGross: v })} />
                  <Field label="Other taxed income — tax" value={n(s.otherTaxedTax)} box="7.15" onChange={v => setSavings({ otherTaxedTax: v })} />
                  <Field label="Total taxed (gross)" value={cs.taxedInterestGross} box="7.18" calc />
                </Section>
                <Section title="Dividends (→ box 22A)">
                  <Field label="Dividends from UK companies" value={n(s.dividendsUk)} box="7.19" onChange={v => setSavings({ dividendsUk: v })} />
                  <Field label="Dividend distributions (unit trusts/OEICs)" value={n(s.dividendDistributions)} box="7.20" onChange={v => setSavings({ dividendDistributions: v })} />
                  <Field label="Stock dividends" value={n(s.stockDividends)} box="7.21" onChange={v => setSavings({ stockDividends: v })} />
                  <Field label="Bonus issues / loans written off" value={n(s.bonusIssues)} box="7.22" onChange={v => setSavings({ bonusIssues: v })} />
                  <Field label="Total dividends" value={cs.dividends} box="7.23" calc />
                </Section>
                <Section title="Other income (→ boxes 15/16/23)">
                  <Field label="Other income — profit" value={n(s.otherIncomeProfit)} box="7.26" onChange={v => setSavings({ otherIncomeProfit: v })} />
                  <Field label="Other income — loss" value={n(s.otherIncomeLoss)} box="7.27" onChange={v => setSavings({ otherIncomeLoss: v })} />
                  <Field label="Other taxed income — gross" value={n(s.otherTaxedIncomeGross)} box="7.30" onChange={v => setSavings({ otherTaxedIncomeGross: v })} />
                  <Field label="Other taxed income — tax" value={n(s.otherTaxedIncomeTax)} box="7.29" onChange={v => setSavings({ otherTaxedIncomeTax: v })} />
                </Section>
              </StudioCard>
            );
          })()}

          {tab === 'foreign' && (() => {
            const f = sa.foreign ?? {};
            const cf = computeSa802(f);
            return (
              <StudioCard className="space-y-5 p-5">
                <Section title="Foreign savings & dividends (→ boxes 14 / 14A)">
                  <Field label="Foreign savings/interest income" value={n(f.savingsIncome)} box="2.6" onChange={v => setForeign({ savingsIncome: v })} />
                  <Field label="Foreign tax on savings" value={n(f.savingsForeignTax)} onChange={v => setForeign({ savingsForeignTax: v })} />
                  <Field label="Foreign dividend income" value={n(f.dividendsIncome)} box="2.6A" onChange={v => setForeign({ dividendsIncome: v })} />
                  <Field label="Foreign tax on dividends" value={n(f.dividendsForeignTax)} onChange={v => setForeign({ dividendsForeignTax: v })} />
                </Section>
                <Section title="Foreign property — income & expenses">
                  <Field label="Total rents & other receipts" value={n(f.propRents)} box="2.11" onChange={v => setForeign({ propRents: v })} />
                  <Field label="Rent, rates, insurance" value={n(f.propRentRates)} box="2.12" onChange={v => setForeign({ propRentRates: v })} />
                  <Field label="Repairs and maintenance" value={n(f.propRepairs)} box="2.13" onChange={v => setForeign({ propRepairs: v })} />
                  <Field label="Non-residential finance costs" value={n(f.propFinanceNonResi)} box="2.14" onChange={v => setForeign({ propFinanceNonResi: v })} />
                  <Field label="Legal and professional" value={n(f.propLegal)} box="2.15" onChange={v => setForeign({ propLegal: v })} />
                  <Field label="Cost of services" value={n(f.propServices)} box="2.16" onChange={v => setForeign({ propServices: v })} />
                  <Field label="Other expenses" value={n(f.propOther)} box="2.17" onChange={v => setForeign({ propOther: v })} />
                </Section>
                <Section title="Foreign property — adjustments">
                  <Field label="Private use" value={n(f.propPrivateUse)} box="2.20" onChange={v => setForeign({ propPrivateUse: v })} />
                  <Field label="Balancing charges" value={n(f.propBalancingCharges)} box="2.21" onChange={v => setForeign({ propBalancingCharges: v })} />
                  <Field label="Electric charge-point allowance" value={n(f.propChargePoint)} box="2.21A" onChange={v => setForeign({ propChargePoint: v })} />
                  <Field label="Structures & Buildings Allowance" value={n(f.propSba)} box="2.21B" onChange={v => setForeign({ propSba: v })} />
                  <Field label="Zero-emission car allowance" value={n(f.propZeroEmission)} box="2.21C" onChange={v => setForeign({ propZeroEmission: v })} />
                  <Field label="All other capital allowances" value={n(f.propOtherCA)} box="2.23" onChange={v => setForeign({ propOtherCA: v })} />
                  <Field label="Costs of replacing domestic items" value={n(f.propReplacingDomestic)} box="2.24" onChange={v => setForeign({ propReplacingDomestic: v })} />
                  <Field label="Adjusted profit (box 17)" value={cf.propertyProfit} box="2.26" calc />
                </Section>
                <Section title="Other foreign (→ boxes 21 / 27 / 28)">
                  <Field label="Offshore-fund disposals" value={n(f.offshoreFundDisposals)} box="2.9" onChange={v => setForeign({ offshoreFundDisposals: v })} />
                  <Field label="Foreign tax on property" value={n(f.propForeignTax)} box="2.30" onChange={v => setForeign({ propForeignTax: v })} />
                  <Field label="Residential finance costs" value={n(f.residentialFinance)} box="2.10A" onChange={v => setForeign({ residentialFinance: v })} />
                  <Field label="Total foreign tax (box 28)" value={cf.foreignTax} box="2.8" calc />
                </Section>
              </StudioCard>
            );
          })()}

          {tab === 'partners' && (
            <PartnersTab ret={ret} sa={sa} shares={c.partnerShares} setPartners={setPartners}
              setStatement={u => patch(r => { const s = r.sa800 as Sa800Data; return { ...r, sa800: { ...s, statement: { ...s.statement, ...u } } }; })} />
          )}
        </div>

        <Sa800ComputationCard c={c} />
      </div>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">Continue to approval <ArrowRight size={15} /></button>
      </div>

      {caOpen && (
        <CapitalAllowancesCalculator
          mode="trader"
          period={{ start: sa.periodStart, end: sa.periodEnd }}
          clientId={ret.clientId}
          state={t.capitalAllowancesCalc}
          onApply={(state, result) => { setTrading({ capitalAllowancesCalc: state, capitalAllowances: result.total, balancingCharges: result.balancingCharge }); setCaOpen(false); }}
          onClose={() => setCaOpen(false)}
        />
      )}
    </div>
  );
}

const n = (v?: number) => v || 0;

function PartnersTab({ ret, sa, shares, setPartners, setStatement }: {
  ret: TaxReturn;
  sa: Sa800Data;
  shares: ReturnType<typeof computeSa800>['partnerShares'];
  setPartners: (p: Sa800Partner[]) => void;
  setStatement: (u: Partial<Sa800Data['statement']>) => void;
}): JSX.Element {
  const partners = sa.statement.partners;
  const full = !!sa.statement.full;
  const upd = (id: string, u: Partial<Sa800Partner>) => setPartners(partners.map(p => p.id === id ? { ...p, ...u } : p));
  const add = () => setPartners([...partners, { id: rid('ptr'), sharePct: 0 }]);
  const del = (id: string) => setPartners(partners.filter(p => p.id !== id));
  const empty = { profitShare: 0, loss: 0, basisAdj: 0, untaxedSavings: 0, cis: 0, charges: 0, property: 0, taxedInterest: 0, dividends: 0, otherIncome: 0, otherTaxedIncome: 0, taxDeducted: 0, residentialFinance: 0, foreignSavings: 0, foreignDividends: 0, foreignProperty: 0, foreignPropertyLoss: 0, offshoreFund: 0, foreignResiFinance: 0, foreignTax: 0 };
  const shareRow = (id: string) => shares.find(s => s.id === id) ?? empty;

  return (
    <StudioCard className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Statement</span>
        <div className="flex rounded-lg border border-[var(--border)] p-0.5 text-[12px] font-semibold">
          <button onClick={() => setStatement({ full: false })} className={`rounded-md px-2.5 py-1 ${!sa.statement.full ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}>Short</button>
          <button onClick={() => setStatement({ full: true })} className={`rounded-md px-2.5 py-1 ${sa.statement.full ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)]'}`}>Full</button>
        </div>
        <span className="text-[10.5px] text-[var(--text-muted)]">{sa.statement.full ? 'Allocates every income stream to each partner' : 'Trade profit + untaxed interest only'}</span>
      </div>
      <Section title="Partnership Statement">
        <TextField label="Nature of trade" value={sa.statement.natureOfTrade ?? ''} onChange={v => setStatement({ natureOfTrade: v })} wide />
      </Section>
      <div className="space-y-3">
        {partners.map((p, i) => (
          <div key={p.id} className="rounded-xl border border-[var(--border)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <input value={p.name ?? ''} placeholder={`Partner ${i + 1} name`} onChange={e => upd(p.id, { name: e.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
              <button onClick={() => del(p.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <MiniField label="UTR (box 3)" value={p.utr ?? ''} onChange={v => upd(p.id, { utr: v })} />
              <MiniField label="NINO" value={p.nino ?? ''} onChange={v => upd(p.id, { nino: v })} />
              <MiniNum label="Profit share %" value={p.sharePct ?? 0} onChange={v => upd(p.id, { sharePct: v })} />
            </div>
            <div className="mt-2 space-y-0.5 rounded-lg bg-[var(--accent)]/5 px-3 py-1.5 text-[12px]">
              <AllocRow label="Profit (box 11)" value={shareRow(p.id).profitShare} strong />
              {full && shareRow(p.id).loss > 0 && <AllocRow label="Loss (box 12)" value={shareRow(p.id).loss} />}
              {full && shareRow(p.id).basisAdj !== 0 && <AllocRow label="Change-of-basis adjustment (box 11A)" value={shareRow(p.id).basisAdj} />}
              {full && shareRow(p.id).untaxedSavings > 0 && <AllocRow label="Untaxed interest (box 24)" value={shareRow(p.id).untaxedSavings} />}
              {full && shareRow(p.id).cis > 0 && <AllocRow label="CIS deductions (box 24A)" value={shareRow(p.id).cis} />}
              {full && shareRow(p.id).charges > 0 && <AllocRow label="Partnership charges (box 29)" value={shareRow(p.id).charges} />}
              {full && shareRow(p.id).property > 0 && <AllocRow label="UK property income (box 19)" value={shareRow(p.id).property} />}
              {full && shareRow(p.id).taxedInterest > 0 && <AllocRow label="Taxed interest (box 22)" value={shareRow(p.id).taxedInterest} />}
              {full && shareRow(p.id).dividends > 0 && <AllocRow label="UK dividends (box 22A)" value={shareRow(p.id).dividends} />}
              {full && shareRow(p.id).otherIncome > 0 && <AllocRow label="Other income (box 15)" value={shareRow(p.id).otherIncome} />}
              {full && shareRow(p.id).otherTaxedIncome > 0 && <AllocRow label="Other taxed income (box 23)" value={shareRow(p.id).otherTaxedIncome} />}
              {full && shareRow(p.id).taxDeducted > 0 && <AllocRow label="Tax deducted (box 25)" value={shareRow(p.id).taxDeducted} />}
              {full && shareRow(p.id).residentialFinance > 0 && <AllocRow label="Residential finance costs (box 26)" value={shareRow(p.id).residentialFinance} />}
              {full && shareRow(p.id).foreignSavings > 0 && <AllocRow label="Foreign savings (box 14)" value={shareRow(p.id).foreignSavings} />}
              {full && shareRow(p.id).foreignDividends > 0 && <AllocRow label="Foreign dividends (box 14A)" value={shareRow(p.id).foreignDividends} />}
              {full && shareRow(p.id).foreignProperty > 0 && <AllocRow label="Foreign property (box 17)" value={shareRow(p.id).foreignProperty} />}
              {full && shareRow(p.id).offshoreFund > 0 && <AllocRow label="Offshore-fund disposals (box 21)" value={shareRow(p.id).offshoreFund} />}
              {full && shareRow(p.id).foreignTax > 0 && <AllocRow label="Foreign tax (box 28)" value={shareRow(p.id).foreignTax} />}
            </div>
          </div>
        ))}
        <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add partner</button>
      </div>
      <PartnerFeed ret={ret} partners={partners} shares={shares} />
    </StudioCard>
  );
}

// ── SA104 partner feed — push each partner's share into their SA100 ───────────
function PartnerFeed({ ret, partners, shares }: {
  ret: TaxReturn;
  partners: Sa800Partner[];
  shares: ReturnType<typeof computeSa800>['partnerShares'];
}): JSX.Element | null {
  const [status, setStatus] = useState<Record<string, 'sending' | 'sent' | 'created' | 'error'>>({});
  const linked = partners.filter(p => p.clientId);
  if (!linked.length) return null;
  const shareOf = (id: string) => shares.find(s => s.id === id)?.profitShare ?? 0;

  async function send(p: Sa800Partner) {
    if (!p.clientId) return;
    setStatus(s => ({ ...s, [p.id]: 'sending' }));
    try {
      const existing = await findPartnerReturn(p.clientId, ret.taxYear);
      const { created } = await pushPartnerShare({ sa800Ret: ret, push: { partnerId: p.id, clientId: p.clientId, name: p.name ?? 'Partner', share: shareOf(p.id) }, existing });
      setStatus(s => ({ ...s, [p.id]: created ? 'created' : 'sent' }));
    } catch {
      setStatus(s => ({ ...s, [p.id]: 'error' }));
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.04] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><Send size={13} /> Feed each partner&apos;s share to their SA100 (SA104)</p>
      <div className="space-y-1.5">
        {linked.map(p => {
          const st = status[p.id];
          return (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-white/70 px-3 py-1.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">{p.name || 'Partner'}</span>
              <span className="shrink-0 font-semibold text-[var(--accent)]">{fmtMoney(shareOf(p.id))}</span>
              <button onClick={() => send(p)} disabled={st === 'sending'} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                {st === 'sending' ? <><Loader2 size={12} className="animate-spin" /> Sending</>
                  : st === 'sent' ? <><CheckCircle2 size={12} /> Updated</>
                  : st === 'created' ? <><CheckCircle2 size={12} /> Created</>
                  : st === 'error' ? 'Retry'
                  : <><Send size={12} /> Send to SA100</>}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-muted)]">Adds an SA104 Partnership page (box 8 = the partner&apos;s share) to their Self Assessment return for {ret.taxYear}, creating the return if they don&apos;t have one yet.</p>
    </div>
  );
}

function Sa800ComputationCard({ c }: { c: ReturnType<typeof computeSa800> }): JSX.Element {
  return (
    <StudioCard className="h-fit space-y-1 p-5 lg:sticky lg:top-4">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><Calculator size={13} /> Computation</p>
      <Row label="Net profit per accounts" value={fmtMoney(c.netProfitPerAccounts)} />
      {c.disallowable > 0 && <Row label="Add: disallowable" value={fmtMoney(c.disallowable)} />}
      {c.balancingCharges > 0 && <Row label="Add: balancing charges" value={fmtMoney(c.balancingCharges)} />}
      {c.capitalAllowances > 0 && <Row label="Less: capital allowances" value={`(${fmtMoney(c.capitalAllowances)})`} />}
      <div className="my-2 rounded-xl bg-[var(--accent)]/5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">{c.loss > 0 ? 'Allowable loss (3.84)' : 'Net profit for tax (3.83)'}</span>
          <span className="text-[15px] font-extrabold text-[var(--accent)]">{fmtMoney(c.loss > 0 ? c.loss : c.profit)}</span>
        </div>
      </div>
      <Row label="Allocated to partners" value={fmtMoney(c.allocatedProfit)} bold />
      {Math.abs(c.unallocated) > 1 && <Row label={c.unallocated > 0 ? 'Unallocated' : 'Over-allocated'} value={fmtMoney(Math.abs(c.unallocated))} />}
      {c.notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-black/5 pt-2">
          {c.notes.map((note, i) => <li key={i} className="text-[10.5px] leading-snug text-[var(--text-muted)]">{note}</li>)}
        </ul>
      )}
    </StudioCard>
  );
}

// ── Small field primitives (mirror StageReviewCt600) ─────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}
function NumIn({ value, onChange, readOnly }: { value: number; onChange: (v: number) => void; readOnly?: boolean }) {
  return (
    <input type="number" value={value === 0 ? '' : value} readOnly={readOnly} tabIndex={readOnly ? -1 : undefined}
      onChange={e => { if (readOnly) return; onChange(Number(e.target.value) || 0); }}
      className={`input-base py-1 text-right text-[12.5px]${readOnly ? ' cursor-not-allowed bg-slate-50 text-[var(--text-muted)]' : ''}`} />
  );
}
function Field({ label, value, onChange, calc, box, onCalc }: { label: string; value: number; onChange?: (v: number) => void; calc?: boolean; box?: string; onCalc?: () => void }) {
  return (
    <div data-editbox={box || undefined}>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {label}
        {onCalc && <button type="button" onClick={onCalc} className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded bg-[var(--accent)]/10 px-1 py-px text-[9px] font-bold text-[var(--accent)] hover:bg-[var(--accent)]/20"><Calculator size={10} /> Calc</button>}
      </label>
      {calc ? (
        <div className="input-base flex items-center justify-end border-[var(--accent)]/20 bg-[var(--accent)]/5 py-1 text-right text-[12.5px] font-semibold text-[var(--accent)]">{fmtMoney(value)}</div>
      ) : <NumIn value={value} onChange={onChange ?? (() => {})} />}
      {box && <p className="mt-0.5 text-[9px] font-medium text-slate-400">[Box {box}]</p>}
    </div>
  );
}
function TextField({ label, value, onChange, wide, type, box }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean; type?: string; box?: string }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : ''} data-editbox={box || undefined}>
      <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">{label}{box && <span className="ml-1 text-slate-400">[{box}]</span>}</label>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />
    </div>
  );
}
function Check({ label, checked, onChange, box }: { label: string; checked: boolean; onChange: (v: boolean) => void; box?: string }) {
  return (
    <label className="col-span-2 flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-2 text-[11px] font-medium text-[var(--text-muted)] sm:col-span-3">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      {label}{box && <span className="ml-auto rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>}
    </label>
  );
}
function MiniField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-[var(--text-muted)]">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12px]" />
    </div>
  );
}
function MiniNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-[var(--text-muted)]">{label}</label>
      <input type="number" value={value === 0 ? '' : value} onChange={e => onChange(Number(e.target.value) || 0)} className="input-base py-1 text-right text-[12px]" />
    </div>
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
function AllocRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'text-[12px] font-semibold text-[var(--text-secondary)]' : 'text-[11px] text-[var(--text-muted)]'}>{label}</span>
      <span className={strong ? 'text-[12.5px] font-bold text-[var(--accent)]' : 'text-[12px] font-semibold text-[var(--text-primary)]'}>{fmtMoney(value)}</span>
    </div>
  );
}
