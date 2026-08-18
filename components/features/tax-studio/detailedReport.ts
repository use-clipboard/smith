// Tax Studio — "Detailed Report" builder.
//
// Expands every grouped figure on the SA100 tax computation into its constituent
// lines: employment pay/benefits/expenses itemised, self-employment expenses
// itemised, property expenses itemised, interest per account, dividends per
// holding, pensions, and reliefs. Pure data only — no React, no PDF. A separate
// renderer turns these `DetailSection[]` into a printable schedule.

import type {
  Sa100Income,
  EmploymentSource,
  TradeSource,
  PropertySource,
  PartnershipSource,
} from './types';
import {
  computeSa100Full,
  employmentBenefits,
  employmentExpenses,
  employmentTaxable,
  tradeNetProfit,
  tradeAdjustedProfit,
  tradeExpensesTotal,
  tradeCapitalAllowancesTotal,
  propertyExpensesTotal,
  propertyAdjustedProfit,
  propertyTaxableShare,
  partnershipTaxableProfit,
  partnershipTaxTakenTotal,
  foreignTotals,
  foreignRowIncome,
  disposalGainLoss,
  sa108Gains,
  sa108HasData,
  CGT_AEA,
  type Sa100Computation,
} from './calc';

export interface DetailRow {
  label: string;
  value?: number;                 // money in £; omit for pure note/header rows
  indent?: 0 | 1 | 2;             // nesting depth
  kind?: 'item' | 'subtotal' | 'total' | 'muted';  // styling hint; default 'item'
  paren?: boolean;                // render as a deduction e.g. (£1,234)
}
export interface DetailSection {
  title: string;
  subtitle?: string;
  rows: DetailRow[];
}

const r = (n: number | undefined): number => Math.round(n || 0);

// ── Label maps (typed against each source shape) ─────────────────────────────
const BENEFIT_LABELS: [keyof EmploymentSource, string][] = [
  ['benCar', 'Company cars and vans'],
  ['benFuel', 'Fuel for company cars/vans'],
  ['benMedical', 'Private medical & dental insurance'],
  ['benVouchers', 'Vouchers & credit cards'],
  ['benAssets', 'Goods & other assets'],
  ['benAccommodation', 'Accommodation'],
  ['benOther', 'Other benefits'],
  ['benExpPayments', 'Expenses payments & balancing charges'],
];
const EMP_EXP_LABELS: [keyof EmploymentSource, string][] = [
  ['expTravel', 'Business travel & subsistence'],
  ['expFixed', 'Fixed (flat-rate) deductions'],
  ['expProfessional', 'Professional fees & subscriptions'],
  ['expOther', 'Other expenses & capital allowances'],
];
const TRADE_EXP_LABELS: [keyof TradeSource, string][] = [
  ['expCostOfGoods', 'Cost of goods bought for resale'],
  ['expSubcontractors', 'Subcontractor costs (CIS)'],
  ['expWages', 'Wages, salaries & other staff costs'],
  ['expCarVanTravel', 'Car, van & travel expenses'],
  ['expPremises', 'Rent, rates, power & insurance'],
  ['expRepairs', 'Repairs & renewals'],
  ['expOffice', 'Phone, stationery & other office costs'],
  ['expAdvertising', 'Advertising & business entertainment'],
  ['expInterest', 'Interest on bank & other loans'],
  ['expBankCharges', 'Bank, credit card & other financial charges'],
  ['expBadDebts', 'Irrecoverable debts written off'],
  ['expProfessional', 'Accountancy, legal & other professional fees'],
  ['expDepreciation', 'Depreciation & loss/(profit) on sale of assets'],
  ['expOtherCosts', 'Other business expenses'],
];
const PROP_EXP_LABELS: [keyof PropertySource, string][] = [
  ['expPremises', 'Rent, rates, insurance & ground rents'],
  ['expRepairs', 'Property repairs & maintenance'],
  ['expLoanInterest', 'Loan interest & other financial costs'],
  ['expProfessional', 'Legal, management & other professional fees'],
  ['expServices', 'Costs of services provided'],
  ['expOther', 'Other allowable property expenses'],
];

// ── Section builders ─────────────────────────────────────────────────────────
function employmentSection(e: EmploymentSource): DetailSection | null {
  const rows: DetailRow[] = [];
  const pay = r(e.pay);
  const tips = r(e.tips);
  const benefits = r(employmentBenefits(e));
  const expenses = r(employmentExpenses(e));

  rows.push({ label: 'Gross pay', value: pay });
  if (tips > 0) rows.push({ label: 'Tips & other payments', value: tips });

  // Itemised benefits, else the single legacy aggregate.
  const itemisedBenefits = BENEFIT_LABELS
    .map(([k, label]) => ({ label, value: Number(e[k]) || 0 }))
    .filter(b => b.value > 0);
  if (itemisedBenefits.length) {
    for (const b of itemisedBenefits) rows.push({ label: b.label, value: r(b.value), indent: 1 });
  } else if (r(e.benefits) > 0) {
    rows.push({ label: 'Taxable benefits', value: r(e.benefits), indent: 1 });
  }
  if (benefits > 0) rows.push({ label: 'Total benefits', value: benefits, kind: 'subtotal' });
  rows.push({ label: 'Total pay and benefits', value: pay + tips + benefits, kind: 'subtotal' });

  const itemisedExpenses = EMP_EXP_LABELS
    .map(([k, label]) => ({ label, value: Number(e[k]) || 0 }))
    .filter(x => x.value > 0);
  for (const x of itemisedExpenses) rows.push({ label: x.label, value: r(x.value), indent: 1, paren: true });
  if (expenses > 0) rows.push({ label: 'Less: total allowable expenses', value: expenses, kind: 'subtotal', paren: true });

  rows.push({ label: 'Net taxable income', value: r(employmentTaxable(e)), kind: 'total' });
  if (r(e.taxDeducted) > 0) rows.push({ label: 'Tax already paid (PAYE)', value: r(e.taxDeducted), kind: 'muted' });

  return { title: `Employment: ${e.employer || 'Employment'}`, subtitle: e.payeRef ? `PAYE reference: ${e.payeRef}` : undefined, rows };
}

function tradeSection(t: TradeSource): DetailSection {
  const rows: DetailRow[] = [];
  const turnover = r(t.turnover);
  const otherIncome = r(t.otherBusinessIncome);
  const tia = r(t.tradingIncomeAllowance);

  rows.push({ label: 'Turnover', value: turnover });
  if (otherIncome > 0) rows.push({ label: 'Other business income', value: otherIncome });
  if (tia > 0) rows.push({ label: 'Trading income allowance', value: tia, paren: true });

  const itemisedExpenses = TRADE_EXP_LABELS
    .map(([k, label]) => ({ label, value: Number(t[k]) || 0 }))
    .filter(x => x.value > 0);
  for (const x of itemisedExpenses) rows.push({ label: x.label, value: r(x.value), indent: 1, paren: true });
  const expensesTotal = r(tradeExpensesTotal(t));
  if (expensesTotal > 0) rows.push({ label: 'Less: total allowable expenses', value: expensesTotal, kind: 'subtotal', paren: true });

  rows.push({ label: 'Net profit', value: r(tradeNetProfit(t)), kind: 'subtotal' });

  const capAllowances = r(tradeCapitalAllowancesTotal(t));
  if (capAllowances > 0) rows.push({ label: 'Less: capital allowances', value: capAllowances, indent: 1, paren: true });

  const adj = tradeAdjustedProfit(t) - tradeNetProfit(t) + tradeCapitalAllowancesTotal(t);
  if (Math.abs(adj) >= 1) {
    const neg = adj < 0;
    rows.push({
      label: neg ? 'Less: tax adjustments' : 'Add: tax adjustments (disallowables etc.)',
      value: r(Math.abs(adj)),
      paren: neg,
    });
  }

  rows.push({ label: 'Adjusted profit for tax', value: r(tradeAdjustedProfit(t)), kind: 'total' });

  return { title: `Self-employment: ${t.name || 'Self-employment'}`, subtitle: t.description || undefined, rows };
}

function partnershipSection(pt: PartnershipSource): DetailSection {
  const rows: DetailRow[] = [];
  rows.push({ label: 'Share of taxable profit', value: r(partnershipTaxableProfit(pt)), kind: 'total' });
  const taxTaken = r(partnershipTaxTakenTotal(pt));
  if (taxTaken > 0) rows.push({ label: 'Tax taken off', value: taxTaken, kind: 'muted' });
  return { title: `Partnership: ${pt.name || 'Partnership'}`, rows };
}

function propertySection(p: PropertySource): DetailSection {
  const rows: DetailRow[] = [];
  const rents = r(p.rents);
  const premiums = r(p.premiums);
  const reverse = r(p.reversePremiums);
  const pia = r(p.propertyIncomeAllowance);

  rows.push({ label: 'Rents and other property income', value: rents });
  if (premiums > 0) rows.push({ label: 'Lease premiums', value: premiums });
  if (reverse > 0) rows.push({ label: 'Reverse premiums & inducements', value: reverse });
  if (pia > 0) rows.push({ label: 'Property income allowance', value: pia, paren: true });

  const itemisedExpenses = PROP_EXP_LABELS
    .map(([k, label]) => ({ label, value: Number(p[k]) || 0 }))
    .filter(x => x.value > 0);
  for (const x of itemisedExpenses) rows.push({ label: x.label, value: r(x.value), indent: 1, paren: true });
  const expensesTotal = r(propertyExpensesTotal(p));
  if (expensesTotal > 0) rows.push({ label: 'Less: total allowable expenses', value: expensesTotal, kind: 'subtotal', paren: true });

  const adjusted = r(propertyAdjustedProfit(p));
  rows.push({ label: 'Adjusted profit for the year', value: adjusted, kind: 'subtotal' });

  const share = r(propertyTaxableShare(p));
  if (Math.abs(share - adjusted) >= 1) rows.push({ label: 'Taxpayer share', value: share, kind: 'total' });

  const finance = r(p.residentialFinanceCosts);
  if (finance > 0) rows.push({ label: 'Residential finance costs (20% reducer)', value: finance, kind: 'muted' });

  return { title: `UK property: ${p.address || 'Property'}`, rows };
}

function foreignSection(income: Sa100Income): DetailSection | null {
  const t = foreignTotals(income);
  if (r(t.interest) <= 0 && r(t.dividends) <= 0 && r(t.other) <= 0 && r(t.taxClaimed) <= 0) return null;
  const sa = income.foreign;
  const rows: DetailRow[] = [];

  // Foreign interest — itemised per country row where the structured SA106 data
  // exists, else the category total.
  const interestRows = (sa?.interest ?? []).filter(x => foreignRowIncome(x) !== 0);
  if (interestRows.length) {
    for (const it of interestRows) rows.push({ label: `Interest — ${it.country || 'foreign'}`, value: r(foreignRowIncome(it)), indent: 1 });
    rows.push({ label: 'Total foreign interest', value: r(t.interest), kind: 'subtotal' });
  } else if (r(t.interest) > 0) {
    rows.push({ label: 'Foreign interest', value: r(t.interest) });
  }

  // Foreign dividends (arising + remitted + income-of-a-person-abroad tables).
  const dividendRows = [...(sa?.dividends ?? []), ...(sa?.remittedDividends ?? []), ...(sa?.otherDividend ?? [])].filter(x => foreignRowIncome(x) !== 0);
  if (dividendRows.length) {
    for (const it of dividendRows) rows.push({ label: `Dividend — ${it.country || 'foreign'}`, value: r(foreignRowIncome(it)), indent: 1 });
    rows.push({ label: 'Total foreign dividends', value: r(t.dividends), kind: 'subtotal' });
  } else if (r(t.dividends) > 0) {
    rows.push({ label: 'Foreign dividends', value: r(t.dividends) });
  }

  // Pensions, remitted other income, other overseas income and foreign property.
  if (r(t.other) > 0) rows.push({ label: 'Foreign pensions & other income', value: r(t.other) });

  rows.push({ label: 'Total foreign income', value: r(t.interest + t.dividends + t.other), kind: 'total' });
  if (r(t.taxClaimed) > 0) rows.push({ label: 'Foreign tax paid (Foreign Tax Credit Relief claimed)', value: r(t.taxClaimed), kind: 'muted' });

  return { title: 'Foreign income', rows };
}

function cgtSection(income: Sa100Income, c: Sa100Computation): DetailSection | null {
  const rows: DetailRow[] = [];
  const disposals = income.capitalGains?.disposals ?? [];

  if (disposals.length) {
    let gains = 0, losses = 0;
    for (const d of disposals) {
      const { gain, loss } = disposalGainLoss(d);
      gains += gain; losses += loss;
      const net = gain - loss;
      rows.push({ label: d.description || 'Disposal', value: r(Math.abs(net)), indent: 1, paren: net < 0 });
    }
    rows.push({ label: 'Total gains', value: r(gains), kind: 'subtotal' });
    if (losses > 0) rows.push({ label: 'Less: in-year losses', value: r(losses), kind: 'subtotal', paren: true });
    const bf = r(income.capitalGains?.lossesBroughtForward);
    if (bf > 0) rows.push({ label: 'Less: brought-forward losses used', value: bf, indent: 1, paren: true });
  } else if (income.sa108 && sa108HasData(income.sa108)) {
    const g = sa108Gains(income.sa108);
    if (g.normalGains > 0) rows.push({ label: 'Gains (standard rate)', value: r(g.normalGains), indent: 1 });
    if (g.badrGains > 0) rows.push({ label: 'Gains qualifying for Business Asset Disposal / Investors’ Relief', value: r(g.badrGains), indent: 1 });
    rows.push({ label: 'Total gains', value: r(g.normalGains + g.badrGains), kind: 'subtotal' });
    if (g.inYearLosses > 0) rows.push({ label: 'Less: in-year losses', value: r(g.inYearLosses), kind: 'subtotal', paren: true });
    if (g.broughtForwardUsed > 0) rows.push({ label: 'Less: brought-forward losses used', value: r(g.broughtForwardUsed), indent: 1, paren: true });
  } else {
    const cg = income.capitalGains;
    const resi = r(cg?.residentialGains), other = r(cg?.otherGains), loss = r(cg?.losses);
    if (resi <= 0 && other <= 0) return null;
    if (resi > 0) rows.push({ label: 'Residential property gains', value: resi, indent: 1 });
    if (other > 0) rows.push({ label: 'Other gains', value: other, indent: 1 });
    rows.push({ label: 'Total gains', value: resi + other, kind: 'subtotal' });
    if (loss > 0) rows.push({ label: 'Less: allowable losses', value: loss, kind: 'subtotal', paren: true });
  }

  // Computed outputs — taxable gains are net of losses and the annual exempt amount.
  rows.push({ label: `Taxable gains (after £${CGT_AEA.toLocaleString('en-GB')} annual exempt amount)`, value: r(c.taxableGains), kind: 'subtotal' });
  rows.push({ label: 'Capital Gains Tax', value: r(c.capitalGainsTax), kind: 'total' });

  return { title: 'Capital gains', rows };
}

// ── Main builder ─────────────────────────────────────────────────────────────
export function buildDetailedReport(income: Sa100Income, taxYear = '2025/26'): DetailSection[] {
  const sections: DetailSection[] = [];
  const c = computeSa100Full(income, taxYear);

  // 1. Employment
  for (const e of income.employment ?? []) {
    const s = employmentSection(e);
    if (s && s.rows.length) sections.push(s);
  }

  // 2. Self-employment
  for (const t of income.selfEmployment ?? []) {
    sections.push(tradeSection(t));
  }

  // 3. Partnership
  for (const pt of income.partnerships ?? []) {
    sections.push(partnershipSection(pt));
  }

  // 4. UK property
  for (const p of income.property ?? []) {
    sections.push(propertySection(p));
  }

  // 5. Untaxed UK interest
  const savingsItems = income.savingsInterestItems ?? [];
  if (savingsItems.length) {
    const rows: DetailRow[] = [];
    let total = 0;
    for (const it of savingsItems) {
      const v = r(it.amount);
      total += v;
      rows.push({ label: it.description || 'Interest', value: v, indent: 1 });
    }
    rows.push({ label: 'Total untaxed UK interest', value: total, kind: 'total' });
    sections.push({ title: 'Untaxed UK interest', rows });
  }

  // 6. Taxed UK interest
  const taxedItems = income.taxedInterestItems ?? [];
  if (taxedItems.length) {
    const rows: DetailRow[] = [];
    let grossTotal = 0;
    let taxTotal = 0;
    for (const it of taxedItems) {
      const gross = r((it.net || 0) + (it.tax || 0));
      grossTotal += gross;
      taxTotal += r(it.tax);
      rows.push({ label: it.description || 'Interest', value: gross, indent: 1 });
    }
    rows.push({ label: 'Total taxed UK interest (gross)', value: grossTotal, kind: 'subtotal' });
    rows.push({ label: 'Tax deducted', value: taxTotal, kind: 'muted' });
    sections.push({ title: 'Taxed UK interest', rows });
  }

  // 7. Dividends
  {
    const rows: DetailRow[] = [];
    let total = 0;
    for (const d of income.dividendItems ?? []) {
      const v = r(d.amount);
      total += v;
      rows.push({ label: d.company || 'Dividend', value: v, indent: 1 });
    }
    for (const d of income.otherDividendsItems ?? []) {
      const v = r(d.amount);
      total += v;
      rows.push({ label: d.description || 'Other dividend', value: v, indent: 1 });
    }
    for (const d of income.foreignDividendsItems ?? []) {
      const v = r(d.amount);
      total += v;
      rows.push({ label: d.description || 'Foreign dividend', value: v, indent: 1 });
    }
    if (rows.length) {
      rows.push({ label: 'Total dividends', value: total, kind: 'total' });
      sections.push({ title: 'Dividends', rows });
    } else {
      // No itemised holdings — fall back to the scalar totals.
      const scalarRows: DetailRow[] = [];
      let scalarTotal = 0;
      const uk = r(income.dividends);
      const other = r(income.otherDividends);
      const foreign = r(income.foreignDividendsMain);
      if (uk > 0) { scalarRows.push({ label: 'Dividends from UK companies', value: uk, indent: 1 }); scalarTotal += uk; }
      if (other > 0) { scalarRows.push({ label: 'Other dividends', value: other, indent: 1 }); scalarTotal += other; }
      if (foreign > 0) { scalarRows.push({ label: 'Foreign dividends', value: foreign, indent: 1 }); scalarTotal += foreign; }
      if (scalarRows.length) {
        scalarRows.push({ label: 'Total dividends', value: scalarTotal, kind: 'total' });
        sections.push({ title: 'Dividends', rows: scalarRows });
      }
    }
  }

  // 7b. Foreign income
  const foreign = foreignSection(income);
  if (foreign) sections.push(foreign);

  // 8. Pensions & state benefits
  {
    const rows: DetailRow[] = [];
    let total = 0;

    const stateItems = income.statePensionItems ?? [];
    if (stateItems.length) {
      for (const it of stateItems) {
        const v = r(it.amount);
        total += v;
        rows.push({ label: it.description || 'State Pension', value: v, indent: 1 });
      }
    } else if (r(income.statePension) > 0) {
      const v = r(income.statePension);
      total += v;
      rows.push({ label: 'State Pension', value: v, indent: 1 });
    }

    const pensionItems = income.pensionsIncomeItems ?? [];
    if (pensionItems.length) {
      for (const it of pensionItems) {
        const v = r(it.amount);
        total += v;
        rows.push({ label: it.description || 'Other pensions', value: v, indent: 1 });
      }
    } else if (r(income.pensionsIncome) > 0) {
      const v = r(income.pensionsIncome);
      total += v;
      rows.push({ label: 'Other pensions', value: v, indent: 1 });
    }

    if (rows.length) {
      rows.push({ label: 'Total pensions & benefits', value: total, kind: 'total' });
      sections.push({ title: 'Pensions & state benefits', rows });
    }
  }

  // 9. Reliefs & deductions
  {
    const rows: DetailRow[] = [];

    const giftAidItems = income.giftAidItems ?? [];
    const giftAidTotal = giftAidItems.length
      ? giftAidItems.reduce((a, x) => a + (x.amount || 0), 0)
      : (income.giftAid || 0);
    if (r(giftAidTotal) > 0) {
      if (giftAidItems.length > 1) {
        for (const it of giftAidItems) {
          if (r(it.amount) > 0) rows.push({ label: it.description || 'Gift Aid donation', value: r(it.amount), indent: 1 });
        }
      }
      rows.push({ label: 'Gift Aid donations', value: r(giftAidTotal), kind: 'subtotal' });
    }

    const pcItems = income.pensionContributionsItems ?? [];
    const pcTotal = pcItems.length
      ? pcItems.reduce((a, x) => a + (x.amount || 0), 0)
      : (income.pensionContributions || 0);
    if (r(pcTotal) > 0) {
      if (pcItems.length > 1) {
        for (const it of pcItems) {
          if (r(it.amount) > 0) rows.push({ label: it.description || 'Pension contribution', value: r(it.amount), indent: 1 });
        }
      }
      rows.push({ label: 'Personal pension contributions', value: r(pcTotal), kind: 'subtotal' });
    }

    if (rows.length) sections.push({ title: 'Reliefs & deductions', rows });
  }

  // 9b. Capital gains
  const cgt = cgtSection(income, c);
  if (cgt) sections.push(cgt);

  // 10. Allowances & tax summary (always last)
  {
    const rows: DetailRow[] = [];
    rows.push({ label: 'Total income received', value: r(c.totalIncome), kind: 'subtotal' });
    rows.push({ label: 'Personal allowance', value: r(c.personalAllowance), paren: true });
    rows.push({ label: 'Total taxable income', value: r(c.taxableIncome), kind: 'subtotal' });
    rows.push({ label: 'Income tax', value: r(c.incomeTax) });
    if (r(c.class4Nic) > 0) rows.push({ label: 'Class 4 NIC', value: r(c.class4Nic) });
    if (r(c.studentLoan) > 0) rows.push({ label: 'Student loan', value: r(c.studentLoan) });
    if (r(c.hicbc) > 0) rows.push({ label: 'High Income Child Benefit Charge', value: r(c.hicbc) });
    if (r(c.capitalGainsTax) > 0) rows.push({ label: 'Capital gains tax', value: r(c.capitalGainsTax) });
    rows.push({ label: 'Total tax, NIC and charges due', value: r(c.totalDue), kind: 'total' });
    if (r(c.taxDeductedAtSource) > 0) rows.push({ label: 'Tax deducted at source', value: r(c.taxDeductedAtSource), paren: true });
    rows.push({ label: 'Balancing payment', value: r(c.balancingPayment), kind: 'total' });
    sections.push({ title: 'Summary', rows });
  }

  return sections;
}

export function detailedReportFileName(clientName: string, taxYear: string): string {
  const safeName = (clientName || 'Client').replace(/[\\/:*?"<>|]/g, '').trim() || 'Client';
  const safeYear = (taxYear || '').replace(/\//g, '-');
  return `${safeName}-Detailed Report-${safeYear}.pdf`;
}
