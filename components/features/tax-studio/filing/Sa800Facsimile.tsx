'use client';

// SA800 Partnership Tax Return — box-for-box facsimile of the HMRC SA800 (2026)
// form, rendered in the filing preview. Uses the shared self-assessment primitives
// (TEAL theme). Figures come from computeSa800; box numbers are the HMRC ones.

import { FormThemeContext, TEAL_THEME, Page, Panel, Teal, SubHead, Note, Money, Cells, Line, Tick, toDDMMYYYY } from './formPrimitives';
import { computeSa800, computeSa801, computeSa804 } from '../calc';
import type { TaxReturn, Sa800Data } from '../types';

const n = (v?: number) => v || 0;

export default function Sa800Facsimile({ ret }: { ret: TaxReturn }): JSX.Element {
  const sa: Sa800Data = ret.sa800 ?? { trading: {}, statement: { partners: [] } };
  const t = sa.trading;
  const c = computeSa800(sa, ret.taxYear, { periodStart: sa.periodStart, periodEnd: sa.periodEnd });
  const full = (t.accountsMode ?? 'full') === 'full';
  const cp = computeSa801(sa.property);
  const cs = computeSa804(sa.savings);
  const foot = (tag: string) => ({ code: 'SA800' as const, footerLeft: `SA800 2026 PTR Page ${tag}`, footerRight: 'HMRC 12/25' });

  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      {/* ── Page 1 — masthead ── */}
      <Page tag="1" {...foot('1')}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-bold" style={{ color: TEAL_THEME.panelBorder }}>Partnership Tax Return 2026</h2>
            <p className="text-[11px] text-black">Tax year 6 April 2025 to 5 April 2026 (2025–26)</p>
          </div>
        </div>
        <Teal>Partnership</Teal>
        <Panel>
          <Line n="Name" label="Name of business" value={sa.businessName || ret.clientName} />
          <Cells n="Tax reference" label="Partnership Unique Taxpayer Reference (UTR)" groups={[10]} value={ret.utr ?? ''} />
        </Panel>
        <Note>The nominated partner must complete and send this return by 31 January 2027 if filing online.</Note>
      </Page>

      {/* ── Page 2 — partnership details + questions ── */}
      <Page tag="2" {...foot('2')}>
        <Teal>Partnership details</Teal>
        <Panel>
          <Line n="3.2" label="Description of partnership trade or profession" value={sa.tradeDescription} />
          <Cells n="3.4" label="Accounting period — start" groups={[2, 2, 4]} sep="" value={toDDMMYYYY(sa.periodStart).replace(/\//g, '')} />
          <Cells n="3.5" label="Accounting period — end" groups={[2, 2, 4]} sep="" value={toDDMMYYYY(sa.periodEnd).replace(/\//g, '')} />
          <TickRow n="3.7" label="Partnership started after 5 April 2025" on={sa.startedInYear} />
          <TickRow n="3.8" label="Partnership ceased after 5 April 2025 but before 6 April 2026" on={sa.ceasedInYear} />
          <TickRow n="3.9" label="Traditional accounting used (not cash basis)" on={sa.traditionalAccounting} />
        </Panel>
        <Teal>Which of these did the partnership have?</Teal>
        <Panel>
          <TickRow n="Q1" label="Rent or other income from UK property (SA801)" on={sa.hasUkProperty} />
          <TickRow n="Q2" label="Foreign income (SA802)" on={sa.hasForeign} />
          <TickRow n="Q3" label="A trade or profession" on={sa.hasTrade} />
          <TickRow n="Q4" label="Disposed of chargeable assets (SA803)" on={sa.hasDisposals} />
          <TickRow n="Q5" label="A company / non-resident partner" on={sa.hasCompanyOrNonResPartner} />
          <TickRow n="Q7" label="Other income (SA804 / box 7.9A)" on={sa.hasOtherIncome} />
        </Panel>
      </Page>

      {/* ── Page 3 — capital allowances + 3-line account ── */}
      <Page tag="3" {...foot('3')}>
        <Teal>Capital allowances — summary</Teal>
        <Panel>
          <Money n="3.22" label="Total capital allowances" value={c.capitalAllowances} />
          <Money n="3.23" label="Total balancing charges" value={c.balancingCharges} />
        </Panel>
        {!full && (
          <>
            <Teal>Income and expenses — annual turnover below £90,000</Teal>
            <Panel>
              <Money n="3.24" label="Turnover including other business receipts" value={n(t.turnover3line)} />
              <Money n="3.25" label="Expenses allowable for tax" value={n(t.expenses3line)} />
              <Money n="3.26" label="Net profit for this period (box 3.24 minus box 3.25)" value={c.netProfitPerAccounts} />
            </Panel>
          </>
        )}
      </Page>

      {/* ── Page 4 — full P&L (turnover £90k–£15m) ── */}
      {full && (
        <Page tag="4" {...foot('4')}>
          <Teal>Income and expenses for this accounting period</Teal>
          <Panel>
            <Money n="3.29" label="Sales / business income (turnover)" value={n(t.sales)} />
            <Money n="3.46" label="Cost of sales" value={n(t.costOfSales)} />
            <Money n="3.47" label="Construction industry subcontractor costs" value={n(t.subcontractorCosts)} />
            <Money n="3.48" label="Other direct costs" value={n(t.otherDirectCosts)} />
            <Money n="3.49" label="Gross profit / (loss)" value={c.grossProfit} />
            <Money n="3.50" label="Other income / profits" value={n(t.otherIncome)} />
          </Panel>
          <SubHead>Expenses</SubHead>
          <Panel>
            <Money n="3.51" label="Employee costs" value={n(t.employeeCosts)} />
            <Money n="3.52" label="Premises costs" value={n(t.premisesCosts)} />
            <Money n="3.53" label="Repairs" value={n(t.repairs)} />
            <Money n="3.54" label="General administrative expenses" value={n(t.adminCosts)} />
            <Money n="3.55" label="Motor expenses" value={n(t.motorExpenses)} />
            <Money n="3.56" label="Travel and subsistence" value={n(t.travel)} />
            <Money n="3.57" label="Advertising, promotion and entertainment" value={n(t.advertising)} />
            <Money n="3.58" label="Legal and professional costs" value={n(t.legalProfessional)} />
            <Money n="3.59" label="Bad debts" value={n(t.badDebts)} />
            <Money n="3.60" label="Interest and alternative finance payments" value={n(t.interest)} />
            <Money n="3.61" label="Other finance charges" value={n(t.otherFinance)} />
            <Money n="3.62" label="Depreciation and loss / (profit) on sale" value={n(t.depreciation)} />
            <Money n="3.63" label="Other expenses including partnership charges" value={n(t.otherExpenses)} />
            <Money n="3.64" label="Total expenses" value={c.totalExpenses} />
          </Panel>
          <SubHead>Tax adjustments to net profit or loss</SubHead>
          <Panel>
            <Money n="3.66" label="Disallowable expenses" value={c.disallowable} />
            <Money n="3.67" label="Goods for own use and other adjustments" value={n(t.goodsOwnUse)} />
            <Money n="3.70" label="Capital allowances (from box 3.22)" value={c.capitalAllowances} />
            <Money n="3.73" label="Net business profit for tax purposes" value={c.netProfitForTax} />
          </Panel>
        </Page>
      )}

      {/* ── Page 5 — taxable profit + CIS + charges ── */}
      <Page tag="5" {...foot('5')}>
        <Teal>Taxable profit or loss for this accounting period</Teal>
        <Panel>
          <Money n="3.82" label="Adjustment on change of basis" value={n(t.basisAdjustment)} />
          <Money n="3.83" label="Net profit for this accounting period (if loss, enter 0)" value={c.profit} />
          <Money n="3.84" label="Allowable loss for this accounting period (if profit, enter 0)" value={c.loss} />
        </Panel>
        <Teal>Subcontractors and tax taken off</Teal>
        <Panel>
          <Money n="3.97" label="Deductions on payment and deduction statements (CIS)" value={n(t.cisDeductions)} />
          <Money n="3.98" label="Other tax taken off trading income" value={n(t.taxTakenOff)} />
        </Panel>
        <Teal>Partnership trade charges</Teal>
        <Panel>
          <Money n="3.117" label="Net partnership charges paid in the period" value={n(t.netPartnershipCharges)} />
        </Panel>
      </Page>

      {/* ── Pages 6–7 — Partnership Statement ── */}
      <Page tag="6" {...foot('6')}>
        <Teal>Partnership Statement ({sa.statement.full ? 'full' : 'short'})</Teal>
        <Panel>
          <Line n="Nature" label="Nature of trade" value={sa.statement.natureOfTrade} />
          <Money n="11" label="Profit from a trade or profession (from box 3.83)" value={c.profit} />
          <Money n="12" label="Loss from a trade or profession (from box 3.84)" value={c.loss} />
        </Panel>
        {c.partnerShares.map((p, i) => {
          const partner = sa.statement.partners[i];
          return (
            <div key={p.id}>
              <SubHead>Partner {i + 1}</SubHead>
              <Panel>
                <Line n="6" label="Name of partner" value={p.name} />
                <Cells n="3" label="Partner's Unique Taxpayer Reference (UTR)" groups={[10]} value={partner?.utr ?? ''} />
                <Money n="11" label="Share of profit" value={p.profitShare} />
                {sa.statement.full && p.loss > 0 && <Money n="12" label="Share of loss" value={p.loss} />}
                {sa.statement.full && p.basisAdj !== 0 && <Money n="11A" label="Share of change-of-basis adjustment" value={p.basisAdj} />}
                {sa.statement.full && p.untaxedSavings > 0 && <Money n="24" label="Share of untaxed interest" value={p.untaxedSavings} />}
                {sa.statement.full && p.cis > 0 && <Money n="24A" label="Share of CIS deductions" value={p.cis} />}
                {sa.statement.full && p.charges > 0 && <Money n="29" label="Share of partnership charges" value={p.charges} />}
                {sa.statement.full && p.property > 0 && <Money n="19" label="Share of UK property income" value={p.property} />}
                {sa.statement.full && p.taxedInterest > 0 && <Money n="22" label="Share of taxed interest" value={p.taxedInterest} />}
                {sa.statement.full && p.dividends > 0 && <Money n="22A" label="Share of UK dividends" value={p.dividends} />}
                {sa.statement.full && p.otherIncome > 0 && <Money n="15" label="Share of other income" value={p.otherIncome} />}
                {sa.statement.full && p.otherTaxedIncome > 0 && <Money n="23" label="Share of other taxed income" value={p.otherTaxedIncome} />}
                {sa.statement.full && p.taxDeducted > 0 && <Money n="25" label="Share of tax deducted" value={p.taxDeducted} />}
                {sa.statement.full && p.residentialFinance > 0 && <Money n="26" label="Share of residential finance costs" value={p.residentialFinance} />}
              </Panel>
            </div>
          );
        })}
      </Page>

      {/* ── Page 8 — other income + declaration ── */}
      <Page tag="8" {...foot('8')}>
        <Teal>Other information</Teal>
        <Panel>
          <Money n="7.9A" label="Untaxed interest from UK banks / building societies" value={n(sa.untaxedInterest)} />
        </Panel>
        <Teal>Declaration</Teal>
        <Note>I, the nominated partner, declare that the information given on this Partnership Tax Return is correct and complete to the best of my knowledge and belief.</Note>
        <Panel>
          <Line n="Name" label="Nominated partner" value={ret.preparedBy} />
        </Panel>
      </Page>

      {/* ── SA801 — Partnership UK property (supplementary) ── */}
      {sa.hasUkProperty && (
        <Page tag="PL2" code="SA801" footerLeft="SA801 2026 Page PL 2" footerRight="HMRC 12/25">
          <h2 className="mb-2 text-[16px] font-bold" style={{ color: TEAL_THEME.panelBorder }}>Partnership UK property</h2>
          <Teal>Income</Teal>
          <Panel>
            <Money n="1.21" label="Rents and other income from UK property" value={n(sa.property?.rents)} />
            <Money n="1.22" label="Tax deducted" value={n(sa.property?.taxDeducted)} />
            <Money n="1.23" label="Chargeable premiums" value={n(sa.property?.chargeablePremiums)} />
            <Money n="1.23A" label="Reverse premiums" value={n(sa.property?.reversePremiums)} />
            <Money n="1.24" label="Total income (boxes 1.21 + 1.23 + 1.23A)" value={cp.totalIncome} />
          </Panel>
          <Teal>Expenses</Teal>
          <Panel>
            <Money n="1.25" label="Rent, rates, insurance and ground rents" value={n(sa.property?.rentRatesInsurance)} />
            <Money n="1.26" label="Repairs and maintenance" value={n(sa.property?.repairs)} />
            <Money n="1.27" label="Non-residential property finance costs" value={n(sa.property?.financeCostsNonResi)} />
            <Money n="1.28" label="Legal and professional costs" value={n(sa.property?.legalProfessional)} />
            <Money n="1.29" label="Cost of services provided, including wages" value={n(sa.property?.costOfServices)} />
            <Money n="1.30" label="Other expenses" value={n(sa.property?.otherExpenses)} />
            <Money n="1.31" label="Total expenses (boxes 1.25 to 1.30)" value={cp.totalExpenses} />
            <Money n="1.32" label="Net profit (box 1.24 minus box 1.31)" value={cp.netProfit} />
          </Panel>
          <Teal>Tax adjustments</Teal>
          <Panel>
            <Money n="1.33" label="Private use" value={n(sa.property?.privateUse)} />
            <Money n="1.34" label="Balancing charges" value={n(sa.property?.balancingCharges)} />
            <Money n="1.35" label="Total additions (boxes 1.33 + 1.34)" value={cp.additions} />
            <Money n="1.35A" label="Annual Investment Allowance" value={n(sa.property?.aia)} />
            <Money n="1.35B" label="Electric charge-point allowance" value={n(sa.property?.chargePointAllowance)} />
            <Money n="1.35C" label="Structures and Buildings Allowance" value={n(sa.property?.sba)} />
            <Money n="1.35D" label="Freeports and Investment Zones SBA" value={n(sa.property?.freeportsSba)} />
            <Money n="1.35E" label="Zero-emission car allowance" value={n(sa.property?.zeroEmissionCar)} />
            <Money n="1.36" label="All other capital allowances" value={n(sa.property?.otherCapitalAllowances)} />
            <Money n="1.37" label="Costs of replacing domestic items" value={n(sa.property?.replacingDomesticItems)} />
            <Money n="1.38" label="Total deductions" value={cp.deductions} />
            <Money n="1.39" label="Profit or loss for the return period (→ PS Full box 19)" value={cp.profitForPeriod} />
            <Money n="1.40" label="Residential property finance costs (→ box 26)" value={n(sa.property?.residentialFinanceCosts)} />
          </Panel>
        </Page>
      )}

      {/* ── SA804 — Partnership savings, investments and other income ── */}
      {sa.hasOtherIncome && (
        <Page tag="PS1" code="SA804" footerLeft="SA804 2026 Page PS 1" footerRight="HMRC 12/25">
          <h2 className="mb-2 text-[16px] font-bold" style={{ color: TEAL_THEME.panelBorder }}>Partnership savings, investments and other income</h2>
          <Teal>Interest with no UK tax deducted (→ box 13)</Teal>
          <Panel>
            <Money n="7.3" label="Untaxed UK interest and alternative finance receipts" value={n(sa.savings?.untaxedInterest)} />
            <Money n="7.4" label="National Savings and Investments" value={n(sa.savings?.nationalSavings)} />
            <Money n="7.5" label="Other income from UK savings and investments" value={n(sa.savings?.otherUntaxedSavings)} />
            <Money n="7.6" label="Total (boxes 7.3 + 7.4 + 7.5)" value={cs.untaxedInterest} />
          </Panel>
          <Teal>Interest with UK tax deducted (→ box 22, tax → box 25)</Teal>
          <Panel>
            <Money n="7.8" label="Taxed interest — tax deducted" value={n(sa.savings?.taxedInterestTax)} />
            <Money n="7.9" label="Taxed interest — gross before tax" value={n(sa.savings?.taxedInterestGross)} />
            <Money n="7.15" label="Other taxed income — tax deducted" value={n(sa.savings?.otherTaxedTax)} />
            <Money n="7.16" label="Other taxed income — gross before tax" value={n(sa.savings?.otherTaxedGross)} />
            <Money n="7.18" label="Total taxed (gross)" value={cs.taxedInterestGross} />
          </Panel>
          <Teal>Dividends (→ box 22A)</Teal>
          <Panel>
            <Money n="7.19" label="Dividends from UK companies" value={n(sa.savings?.dividendsUk)} />
            <Money n="7.20" label="Dividend distributions from UK unit trusts / OEICs" value={n(sa.savings?.dividendDistributions)} />
            <Money n="7.21" label="Stock dividends from UK companies" value={n(sa.savings?.stockDividends)} />
            <Money n="7.22" label="Bonus issues / redeemable shares / loans written off" value={n(sa.savings?.bonusIssues)} />
            <Money n="7.23" label="Total dividends" value={cs.dividends} />
          </Panel>
          <Teal>Other income (→ boxes 15 / 16 / 23)</Teal>
          <Panel>
            <Money n="7.26" label="Other income — profit" value={n(sa.savings?.otherIncomeProfit)} />
            <Money n="7.27" label="Other income — loss" value={n(sa.savings?.otherIncomeLoss)} />
            <Money n="7.29" label="Other taxed income — tax deducted" value={n(sa.savings?.otherTaxedIncomeTax)} />
            <Money n="7.30" label="Other taxed income — gross" value={n(sa.savings?.otherTaxedIncomeGross)} />
          </Panel>
        </Page>
      )}
    </FormThemeContext.Provider>
  );
}

/** A labelled tick box row (SA800 uses right-aligned Yes/No ticks). */
function TickRow({ n: num, label, on }: { n: React.ReactNode; label: string; on?: boolean }) {
  return (
    <div className="flex items-center gap-2 border-t border-black/5 py-1 text-[11px] first:border-t-0">
      <span className="w-8 shrink-0 text-[9px] font-bold text-slate-500">{num}</span>
      <span className="flex-1 text-black">{label}</span>
      <Tick on={on} />
    </div>
  );
}
