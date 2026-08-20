// A faithful HTML facsimile of HMRC's CT600 (2026) Version 3 — the Company Tax
// Return — styled to match the official form and populated from the return's
// `ct600` data plus the corporation-tax computation. Built on the shared HMRC
// form primitives (teal headings, pale-teal £ boxes, tick boxes) used by the
// SA100 supplementary facsimiles. This is HMRC's functional layout (Open
// Government Licence), rendered to hold this client's figures like commercial
// tax software.

'use client';

import type React from 'react';
import type { TaxReturn } from '../types';
import { computeCt600, ct600PaymentDue, ct600FilingDue, computeCapitalAllowances } from '../calc';
import {
  FormThemeContext, TEAL_THEME, TEAL,
  Page, Panel, Teal, SubHead, Note, Label, BoxNum, Money, Tick, Line, Cells, HmrcLogo, toDDMMYYYY,
} from './formPrimitives';

// ── local helpers ────────────────────────────────────────────────────────────

// UK corporation-tax financial year of a date: FY runs 1 April → 31 March and is
// labelled by the calendar year it starts in (so 1 Apr 2024–31 Mar 2025 = "2024").
function fyOf(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

interface FyRow { fy: number; profit: number; ratePct: number; tax: number }

// Split the profits chargeable to CT across the financial years the accounting
// period straddles, apportioned by days — mirroring boxes 330–425 of the form.
function ct600FyRows(startIso: string | undefined, endIso: string | undefined, pctct: number, ratePct: number, tax: number): FyRow[] {
  if (!startIso || !endIso || pctct <= 0) {
    const fy = endIso ? fyOf(new Date(endIso)) : new Date().getFullYear();
    return [{ fy, profit: pctct, ratePct, tax }];
  }
  const start = new Date(startIso), end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [{ fy: fyOf(end), profit: pctct, ratePct, tax }];
  }
  const DAY = 86_400_000;
  const totalDays = Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  const rows: FyRow[] = [];
  let cur = new Date(start);
  while (cur <= end) {
    const fy = fyOf(cur);
    const fyEnd = new Date(fy + 1, 2, 31); // 31 March of fy+1
    const segEnd = end < fyEnd ? end : fyEnd;
    const days = Math.round((segEnd.getTime() - cur.getTime()) / DAY) + 1;
    const profit = (pctct * days) / totalDays;
    rows.push({ fy, profit, ratePct, tax: (tax * days) / totalDays });
    cur = new Date(segEnd.getTime() + DAY);
  }
  return rows;
}

const r0 = (n: number) => Math.round(n);

// ── the form ─────────────────────────────────────────────────────────────────

export default function Ct600Facsimile({ ret }: { ret: TaxReturn; editable?: boolean }) {
  const c = computeCt600(ret.ct600, ret.taxYear);
  const t = ret.ct600?.trading ?? {};
  const L = ret.ct600?.losses;
  const n = (v?: number) => v || 0;

  const periodFrom = toDDMMYYYY(ret.periodStart);
  const periodTo = toDDMMYYYY(ret.periodEnd);
  const paymentDue = ct600PaymentDue(ret.periodEnd);
  const filingDue = ct600FilingDue(ret.periodEnd);

  // Box 235 — profits before other deductions and reliefs (total profits here).
  const box235 = c.totalProfits;
  // Box 295 total deductions & reliefs; box 300 profits before donations/group relief.
  const box295 = c.lossesReliefs;
  const box300 = Math.max(0, box235 - box295);
  const fyRows = ct600FyRows(ret.periodStart, ret.periodEnd, c.pctct, c.ctRatePct, c.taxBeforeMarginalRelief);

  const rd = t.rdFilmsCalc;
  // Capital-allowances breakdown for boxes 690–775. Prefer the calculator's
  // working state (gives the AIA / main-pool / special-rate split); otherwise
  // fall back to the single applied total in box 705.
  const caState = t.capitalAllowancesCalc;
  const ca = caState ? computeCapitalAllowances(caState) : null;
  const caTotal = ca ? ca.total : n(t.capitalAllowances);
  const caBalCharge = ca ? ca.balancingCharge : n(t.balancingCharges);
  const caAdditions = (caState?.additions ?? []).reduce((a, x) => a + (x.cost || 0), 0);

  // Footer is identical on every CT600 sheet: form id · page · HMRC print date.
  const foot = (tag: string) => ({ code: 'CT600', footerLeft: 'CT600(2026) Version 3', footerCenter: `Page ${tag}`, footerRight: 'HMRC 04/26' });

  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      {/* ── Page 1 — Company information / About this return ── */}
      <Page {...foot('1')} tag="1">
        <div className="mb-3 flex items-start justify-between">
          <HmrcLogo />
          <div className="text-right">
            <h2 className="text-[22px] font-bold leading-none text-black">Company Tax Return</h2>
            <p className="mt-1.5 text-[12px] font-bold text-black">CT600 (2026) Version 3</p>
            <p className="mt-0.5 text-[10px] text-black">for accounting periods starting on or after 1 April 2015</p>
          </div>
        </div>
        <p className="mb-2 text-[13px] font-bold" style={{ color: TEAL }}>Your Company Tax Return</p>
        <Note>If we send the company a ‘Notice’ to deliver a Company Tax Return it has to comply by the filing date or we charge a penalty, even if there is no tax to pay.</Note>
        <Note>A return includes a Company Tax Return form, any supplementary pages, accounts, computations and any relevant information. The CT600 Guide tells you how the return must be formatted and delivered.</Note>

        <Teal>Company information</Teal>
        <Panel>
          <div className="grid grid-cols-2 gap-x-8">
            <Line n={1} label="Company name" value={ret.clientName} />
            <Cells n={2} label="Company registration number" groups={[8]} value={''} />
            <Cells n={3} label="Tax reference" groups={[10]} value={ret.utr || ''} />
            <Cells n={4} label="Type of company" groups={[2]} value={''} />
          </div>
          <SubHead>Put an ‘X’ in the appropriate boxes below</SubHead>
          <div className="grid grid-cols-2 gap-x-8 text-[10.5px] text-black">
            <div className="flex items-center gap-2"><BoxNum n={5} /> NI trading activity <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={6} /> SME <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={7} /> NI employer <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={8} /> Special circumstances <Tick /></div>
          </div>
        </Panel>

        <Teal>About this return</Teal>
        <Panel>
          <p className="mb-1 text-[10.5px] text-black">This is the tax return for the company named above, for the period below</p>
          <div className="grid grid-cols-2 gap-x-8">
            <Cells n={30} label="from DD MM YYYY" groups={[2, 2, 4]} value={periodFrom} />
            <Cells n={35} label="to DD MM YYYY" groups={[2, 2, 4]} value={periodTo} />
          </div>
          <SubHead>Put an ‘X’ in the appropriate boxes below</SubHead>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[10px] text-black">
            <div className="flex items-center gap-2"><BoxNum n={40} /> A repayment is due for this return period <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={45} /> Claim or relief affecting an earlier period <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={50} /> Making more than one return now <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={55} /> This return contains estimated figures <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={60} /> Company part of a group that is not small <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={65} /> Notice of disclosable avoidance schemes <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={70} /> Compensating adjustment claimed <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={75} /> Company qualifies for SME exemption <Tick /></div>
          </div>
        </Panel>
      </Page>

      {/* ── Page 2 — Accounts & computations / supplementary pages / turnover ── */}
      <Page {...foot('2')} tag="2">
        <p className="mb-1 text-[12px] font-bold text-black">About this return — continued</p>
        <Teal>Accounts and computations</Teal>
        <Panel>
          <div className="flex items-center gap-2 text-[10.5px] text-black"><BoxNum n={80} /> I attach accounts and computations for the period to which this return relates <Tick on /></div>
          <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-black"><BoxNum n={85} /> I attach accounts and computations for a different period <Tick /></div>
          <Label n={90}>If you’re not attaching the accounts and computations, explain why</Label>
          <Line lines={2} />
        </Panel>

        <Teal>Supplementary pages enclosed</Teal>
        <Panel>
          <div className="grid grid-cols-1 gap-y-1 text-[9.5px] text-black">
            {[
              [95, 'Loans and arrangements to participators by close companies — CT600A'],
              [100, 'Controlled foreign companies, foreign PE exemptions, hybrid mismatches — CT600B'],
              [105, 'Group and consortium — CT600C'],
              [110, 'Insurance — CT600D'],
              [115, 'Charities and Community Amateur Sports Clubs (CASCs) — CT600E'],
              [120, 'Tonnage tax — CT600F'],
              [125, 'Northern Ireland — CT600G'],
              [130, 'Cross-border royalties — CT600H'],
              [135, 'Supplementary charge in respect of ring fence trades — CT600I'],
              [140, 'Disclosure of Tax Avoidance Schemes — CT600J'],
              [142, 'Research and Development — CT600L'],
              [143, 'Freeports and Investment Zones — CT600M'],
              [96, 'Creative industries — CT600P'],
            ].map(([b, txt]) => (
              <div key={b} className="flex items-center gap-2"><BoxNum n={b} /> <span className="flex-1">{txt}</span> <Tick /></div>
            ))}
          </div>
        </Panel>

        <Teal>Tax calculation</Teal>
        <SubHead>Turnover</SubHead>
        <Panel>
          <Money n={145} label="Total turnover from trade" value={n(t.turnover)} />
          <div className="flex items-start gap-2 text-[10px] text-black"><BoxNum n={150} /> <span className="flex-1">Banks, building societies, insurance companies and other financial concerns — put an ‘X’ in this box if you do not have a recognised turnover and have not made an entry in box 145</span> <Tick /></div>
        </Panel>
      </Page>

      {/* ── Page 3 — Income / chargeable gains / profits before deductions ── */}
      <Page {...foot('3')} tag="3">
        <Teal>Income</Teal>
        <Panel>
          <Money n={155} label="Trading profits" value={Math.max(0, c.taxableTradingProfit)} />
          <Money n={160} label="Trading losses brought forward set against trading profits" value={n(L?.trading.bfSetTradingProfits)} />
          <Money n={170} label="Loan relationships and derivative contracts (financial instruments)" value={n(L?.ntlr.incomeLoanRelationships)} />
          <Money n={175} label="Annual payments not otherwise charged to Corporation Tax and from which Income Tax has not been deducted" value={n(L?.ntlr.incomeNonLoanDerivatives)} />
          <Money n={180} label="Non-exempt dividends or distributions from non-UK resident companies" value={0} />
          <Money n={185} label="Income from which Income Tax has been deducted" value={0} />
          <Money n={190} label="Income from a property business" value={c.propertyProfit} />
          <Money n={195} label="Non-trading gains on intangible fixed assets" value={c.intangiblesProfit} />
          <Money n={200} label="Tonnage tax profits" value={0} />
          <Money n={205} label="Income not falling under any other heading" value={c.otherIncome} />
        </Panel>
        <Teal>Chargeable gains</Teal>
        <Panel>
          <Money n={210} label="Gross chargeable gains" value={n(L?.chargeableGains.incomeArising)} />
          <Money n={215} label="Allowable losses including losses brought forward" value={n(L?.chargeableGains.utilised) + n(L?.chargeableGains.broughtForward)} />
          <Money n={220} label="Net chargeable gains — box 210 minus box 215" value={c.chargeableGains} />
        </Panel>
        <Teal>Profits before deductions and reliefs</Teal>
        <Panel>
          <Money n={225} label="Losses brought forward against certain investment income" value={n(L?.trading.bfSetInvestmentIncome)} />
          <Money n={230} label="Non-trade deficits on loan relationships and derivative contracts brought forward set against non-trading profits" value={n(L?.ntlr.bfSetNonTradeProfits)} />
          <Money n={235} label="Profits before other deductions and reliefs — net sum of boxes 165 to 205 and 220 minus sum of boxes 225 and 230" value={box235} />
        </Panel>
      </Page>

      {/* ── Page 4 — Deductions & reliefs / PCTCT / FY tax grid ── */}
      <Page {...foot('4')} tag="4">
        <Teal>Deductions and reliefs</Teal>
        <Panel>
          <Money n={240} label="Losses on unquoted shares" value={0} />
          <Money n={245} label="Management expenses" value={n(L?.managementExpenses.utilised) + n(L?.managementExpenses.broughtForward)} />
          <Money n={250} label="UK property business losses for this or previous accounting period" value={n(L?.property.lossesCurrentPeriod) + n(L?.property.lossesBroughtForwardUtil)} />
          <Money n={255} label="Capital allowances for the purposes of management of the business" value={0} />
          <Money n={260} label="Non-trade deficits for this accounting period from loan relationships and derivative contracts" value={0} />
          <Money n={263} label="Carried forward non-trade deficits from loan relationships and derivative contracts" value={n(L?.ntlr.bfSetTotalProfits)} />
          <Money n={265} label="Non-trading losses on intangible fixed assets" value={0} />
          <Money n={285} label="Trading losses carried forward and claimed against total profits" value={n(L?.trading.cfClaimedTotalProfits)} />
          <Money n={290} label="Non-trade capital allowances" value={0} />
          <Money n={295} label="Total of deductions and reliefs — total of boxes 240 to 275, 285 and 290" value={box295} />
        </Panel>
        <Panel>
          <Money n={300} label="Profits before qualifying donations and group relief — box 235 minus box 295" value={box300} />
          <Money n={305} label="Qualifying donations" value={0} />
          <Money n={310} label="Group relief" value={0} />
          <Money n={312} label="Group relief for carried forward losses" value={0} />
          <Money n={315} label="Profits chargeable to Corporation Tax — box 300 minus boxes 305, 310 and 312" value={c.pctct} />
        </Panel>

        <Teal>Tax calculation</Teal>
        <Panel>
          <div className="grid grid-cols-2 gap-x-8">
            <Cells n={326} label="Number of associated companies in this period" groups={[4]} value={''} />
            <div className="flex items-start gap-2 text-[10px] text-black"><BoxNum n={329} /> <span className="flex-1">Put an ‘X’ if the company is chargeable at the small profit rate or is entitled to marginal relief</span> <Tick on={c.marginalRelief > 0 || c.ctRatePct < 25} /></div>
          </div>
        </Panel>
        <p className="mb-1 text-[10.5px] font-bold text-black">Enter how much profit has to be charged and at what rate</p>
        <div className="mb-2 grid grid-cols-[70px_1fr_70px_1fr] gap-x-2 gap-y-1 text-[9.5px] font-bold text-black">
          <span>Financial year (yyyy)</span><span>Amount of profit</span><span>Rate of tax %</span><span>Tax</span>
        </div>
        {fyRows.slice(0, 2).map((row, idx) => (
          <div key={idx} className="mb-2 grid grid-cols-[70px_1fr_70px_1fr] items-end gap-x-2">
            <div className="flex items-center gap-1"><BoxNum n={idx === 0 ? 330 : 380} /><span className="text-[11px] font-medium text-black">{row.fy}</span></div>
            <Money n={idx === 0 ? 335 : 385} value={r0(row.profit)} cells={7} />
            <div className="flex items-center gap-1"><BoxNum n={idx === 0 ? 340 : 390} /><span className="text-[11px] font-medium text-black">{row.ratePct.toFixed(2)}</span></div>
            <Money n={idx === 0 ? 345 : 395} value={r0(row.tax)} cells={7} />
          </div>
        ))}
      </Page>

      {/* ── Page 5 — CT chargeable / reliefs in terms of tax / outstanding ── */}
      <Page {...foot('5')} tag="5">
        <p className="mb-1 text-[12px] font-bold text-black">Tax calculation — continued</p>
        <Panel>
          <Money n={430} label="Corporation Tax — total of boxes 345, 360, 375, 395, 410 and 425" value={c.taxBeforeMarginalRelief} />
          <Money n={435} label="Marginal relief" value={c.marginalRelief} />
          <Money n={440} label="Corporation Tax chargeable — box 430 minus box 435" value={c.corporationTax} />
        </Panel>
        <Teal>Reliefs and deductions in terms of tax</Teal>
        <Panel>
          <Money n={445} label="Community Investment Tax Relief" value={0} />
          <Money n={450} label="Double Taxation Relief" value={0} />
          <Money n={465} label="Advance Corporation Tax" value={0} />
          <Money n={470} label="Total reliefs and deduction in terms of tax — total of boxes 445, 450 and 465" value={0} />
        </Panel>
        <Teal>Calculation of tax outstanding or overpaid</Teal>
        <Panel>
          <Money n={475} label="Net Corporation Tax liability — box 440 minus box 470" value={c.corporationTax} />
          <Money n={480} label="Tax payable on loans and arrangements to participators" value={0} />
          <Money n={490} label="Controlled Foreign Companies (CFC) tax payable" value={0} />
          <Money n={495} label="Bank levy payable" value={0} />
          <Money n={496} label="Bank surcharge payable" value={0} />
          <Money n={497} label="Residential Property Developer Tax (RPDT) payable" value={0} />
        </Panel>
      </Page>

      {/* ── Page 6 — tax chargeable / self-assessment / tax reconciliation ── */}
      <Page {...foot('6')} tag="6">
        <p className="mb-1 text-[12px] font-bold text-black">Calculation of tax outstanding or overpaid — continued</p>
        <Panel>
          <Money n={500} label="CFC tax, bank levy, bank surcharge and RPDT payable — total of boxes 490, 495, 496 and 497" value={0} />
          <Money n={505} label="Supplementary charge (ring fence trades) payable" value={0} />
          <Money n={510} label="Tax chargeable — total of boxes 475, 480, 500, 501, 502 and 505" value={c.corporationTax} />
          <Money n={515} label="Income Tax deducted from gross income included in profits" value={0} />
          <Money n={520} label="Income Tax repayable to the company" value={0} />
          <Money n={525} label="Self-assessment of tax payable before restitution tax and coronavirus support scheme overpayments — box 510 minus box 515" value={c.corporationTax} />
          <Money n={528} label="Self-assessment of tax payable — total of boxes 525, 526 and 527" value={c.corporationTax} />
        </Panel>
        <Teal>Tax reconciliation</Teal>
        <Panel>
          <Money n={530} label="Research and Development credit" value={0} />
          <Money n={540} label="Creatives tax credit" value={0} />
          <Money n={541} label="Audio-Visual expenditure credit (AVEC) and Video Games expenditure credit (VGEC)" value={0} />
          <Money n={545} label="Total of R&D credit, creatives tax credit and AVEC/VGEC — total box 530 to 541" value={0} />
        </Panel>
      </Page>

      {/* ── Page 7 — reconciliation continued / indicators ── */}
      <Page {...foot('7')} tag="7">
        <p className="mb-1 text-[12px] font-bold text-black">Tax reconciliation — continued</p>
        <Panel>
          <Money n={595} label="Tax already paid (and not already repaid)" value={0} />
          <Money n={600} label="Tax outstanding — box 525 minus boxes 545, 560, 565 and 595" value={c.corporationTax} />
          <Money n={605} label="Tax overpaid including surplus or payable credits" value={0} />
          <Money n={610} label="Group tax refunds surrendered to this company" value={0} />
          <Money n={615} label="Research and Development expenditure credits surrendered to this company" value={0} />
        </Panel>
        <Teal>Indicators and information</Teal>
        <Panel>
          <Money n={620} label="Franked investment income / Exempt ABGH distributions" value={0} />
          <Cells n={625} label="Number of 51% group companies" groups={[4]} value={''} />
          <div className="mt-1 space-y-1 text-[9.5px] text-black">
            <div className="flex items-center gap-2"><BoxNum n={630} /> <span className="flex-1">Should have made instalment payments as a large company</span> <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={631} /> <span className="flex-1">Should have made instalment payments as a very large company</span> <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={635} /> <span className="flex-1">Is within a group payments arrangement for the period</span> <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={640} /> <span className="flex-1">Has written down or sold intangible assets</span> <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={645} /> <span className="flex-1">Has made cross-border royalty payments</span> <Tick /></div>
          </div>
        </Panel>
      </Page>

      {/* ── Page 8 — R&D / creatives enhanced expenditure & capital allowances ── */}
      <Page {...foot('8')} tag="8">
        <Teal>Information about enhanced expenditure and tax reliefs</Teal>
        <SubHead>Research and Development (R&D) or creatives enhanced expenditure and tax reliefs</SubHead>
        <Panel>
          <div className="space-y-1 text-[9.5px] text-black">
            <div className="flex items-center gap-2"><BoxNum n={650} /> <span className="flex-1">R&D claim made by a small or medium-sized enterprise (SME)</span> <Tick on={rd?.scheme === 'sme'} /></div>
            <div className="flex items-center gap-2"><BoxNum n={653} /> <span className="flex-1">Claim made by an R&D intensive SME</span> <Tick /></div>
            <div className="flex items-center gap-2"><BoxNum n={655} /> <span className="flex-1">Claim made by a large company (RDEC)</span> <Tick on={rd?.scheme === 'rdec'} /></div>
            <div className="flex items-center gap-2"><BoxNum n={657} /> <span className="flex-1">R&D additional information form has been submitted</span> <Tick /></div>
          </div>
          <div className="mt-2">
            <Money n={659} label="R&D expenditure qualifying for SME / R&D intensive SME relief" value={rd?.scheme === 'sme' ? n(rd?.qualifyingExpenditure) : 0} />
            <Money n={660} label="R&D enhanced expenditure" value={rd?.scheme === 'sme' ? n(t.rdOrFilmsRelief) : 0} />
            <Money n={663} label="Creatives core expenditure" value={rd?.scheme === 'creative' ? n(rd?.qualifyingExpenditure) : 0} />
            <Money n={665} label="Creatives additional deduction" value={rd?.scheme === 'creative' ? n(t.rdOrFilmsRelief) : 0} />
            <Money n={670} label="R&D enhanced expenditure and creatives additional deduction — total box 660 and box 665" value={n(t.rdOrFilmsRelief)} />
          </div>
        </Panel>
        <Teal>Capital allowances and balancing charges</Teal>
        <SubHead>Allowances and charges in the calculation of trading profits and losses</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <p className="mb-1 text-[9.5px] font-bold text-black">Capital allowances</p>
              <Money n={690} label="Annual investment allowance" value={ca ? ca.aia : 0} />
              <Money n={705} label="Machinery and plant — main pool" value={ca ? ca.wdaMain + ca.fya + ca.balancingAllowance : caTotal} />
              <Money n={695} label="Machinery and plant — special rate pool" value={ca ? ca.wdaSpecial : 0} />
              <Money n={711} label="Structures and buildings" value={0} />
            </div>
            <div>
              <p className="mb-1 text-[9.5px] font-bold text-black">Balancing charges</p>
              <Money n={692} label="Machinery and plant" value={caBalCharge} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── Page 9 — qualifying expenditure (light) ── */}
      <Page {...foot('9')} tag="9">
        <Teal>Qualifying expenditure</Teal>
        <Panel>
          <Money n={760} label="Machinery and plant on which first year allowance is claimed" value={0} />
          <Money n={765} label="Designated environmentally friendly machinery and plant" value={0} />
          <Money n={770} label="Machinery and plant on long-life assets and integral features" value={0} />
          <Money n={771} label="Structures and buildings" value={0} />
          <Money n={775} label="Other machinery and plant" value={caAdditions} />
        </Panel>
      </Page>

      {/* ── Page 10 — Losses, deficits and excess amounts ── */}
      <Page {...foot('10')} tag="10">
        <Teal>Losses, deficits and excess amounts</Teal>
        <SubHead>Amount arising</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <p className="mb-1 text-[9.5px] font-bold text-black">Amount</p>
              <Money n={780} label="Losses of trades carried on wholly or partly in the UK" value={n(L?.trading.carriedForward)} />
              <Money n={790} label="Losses of trades carried on wholly outside the UK" value={n(L?.overseasTrading.carriedForward)} />
              <Money n={795} label="Non-trade deficits on loan relationships and derivative contracts" value={n(L?.ntlr.carriedForward)} />
              <Money n={805} label="UK property business losses" value={n(L?.property.carriedForward)} />
              <Money n={830} label="Non-trading losses on intangible fixed assets" value={n(L?.intangibles.carriedForward)} />
              <Money n={850} label="Management expenses" value={n(L?.managementExpenses.carriedForward)} />
            </div>
            <div>
              <p className="mb-1 text-[9.5px] font-bold text-black">Maximum available for surrender as group relief</p>
              <Money n={785} label="" value={n(L?.trading.groupRelief)} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── Page 11 — Overpayments and repayments / bank details ── */}
      <Page {...foot('11')} tag="11">
        <Teal>Overpayments and repayments</Teal>
        <SubHead>Repayments for the period covered by this return</SubHead>
        <Panel>
          <Money n={865} label="Repayment of Corporation Tax" value={0} />
          <Money n={870} label="Repayment of Income Tax" value={0} />
          <Money n={875} label="Payable Research and Development tax credit" value={0} />
        </Panel>
        <Teal>Bank details (for a person to whom a repayment is to be made)</Teal>
        <Panel>
          <Line n={920} label="Name of bank or building society" />
          <div className="grid grid-cols-2 gap-x-8">
            <Cells n={925} label="Branch sort code" groups={[2, 2, 2]} sep="—" value={''} />
            <Cells n={930} label="Account number" groups={[8]} value={''} />
          </div>
          <Line n={935} label="Name of account" />
        </Panel>
      </Page>

      {/* ── Page 12 — Declaration ── */}
      <Page {...foot('12')} tag="12">
        <Teal>Declaration</Teal>
        <Note>I declare that the information I have given on this Company Tax Return and any supplementary pages is correct and complete to the best of my knowledge and belief. I understand that giving false information in the return, or concealing any part of the company’s profits or tax payable, can lead to both the company and me being prosecuted.</Note>
        <Panel>
          <Line n={975} label="Name" value={ret.preparedBy} />
          <div className="grid grid-cols-2 gap-x-8">
            <Cells n={980} label="Date DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(filingDue)} />
            <Line n={985} label="Status" value="Director" />
          </div>
        </Panel>
        <div className="mt-4 text-[10px] text-black">
          <p><span className="font-bold">Accounting period:</span> {periodFrom ? `${ret.periodStart} to ${ret.periodEnd}` : '—'}</p>
          <p className="mt-1"><span className="font-bold">Corporation Tax payable:</span> £{c.corporationTax.toLocaleString()}</p>
          <p className="mt-1"><span className="font-bold">Payment due:</span> {paymentDue || '—'} &nbsp;·&nbsp; <span className="font-bold">Filing due:</span> {filingDue || '—'}</p>
        </div>
      </Page>
    </FormThemeContext.Provider>
  );
}
