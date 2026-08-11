// Filing preview model — turns a TaxReturn into the set of HMRC SA forms as they
// would be filed: the SA100 main form is always present; each supplementary page
// appears only when its section carries data. This same structure feeds the
// on-screen filing preview, the client-copy PDF, and (later) the e-filing XML.

import type { TaxReturn, Sa100Income } from '../types';
import { fmtMoney } from '../data';
import {
  computeSa100Full,
  employmentTaxable,
  tradeTaxableProfit, tradeAdjustedProfit, tradeExpensesTotal, tradeNetProfit,
  propertyGrossIncome, propertyExpensesTotal, propertyTaxable, propertyTaxableShare, propertyAdjustedProfit, propertyLossCarryForward, ownerShareFraction,
  partnershipTaxableProfit,
  ministerComputed, ministerHasData,
  assemblyComputed, assemblyHasData,
  parliamentComputed, parliamentHasData,
  scottishParliamentComputed, scottishParliamentHasData,
  welshAssemblyComputed, welshAssemblyHasData,
  lloydsComputed, lloydsHasData,
  sa108HasData, sa108Gains,
  foreignTotals,
  trustTotals,
} from '../calc';

export interface FilingRow {
  box?: string | number;   // HMRC box number (grey chip); omit for sub-headings
  label: string;
  value?: string;          // formatted £ value; omit for text/heading rows
  text?: string;           // non-money value (name, date, Yes/No)
  strong?: boolean;        // total / computed row
  heading?: boolean;       // a sub-heading within a section
}
export interface FilingSection { title: string; rows: FilingRow[] }
export interface FilingForm {
  code: string;            // e.g. 'SA100', 'SA105'
  name: string;            // human name
  pageTag: string;         // e.g. 'TR', 'UKP', 'SEF' — the HMRC page prefix
  sections: FilingSection[];
}

// Whole-pound money, blank when zero (HMRC: leave a box blank if it doesn't apply).
const m = (n: number | undefined | null): string | undefined => (n && Math.round(n) !== 0 ? fmtMoney(Math.round(n)) : undefined);
const yn = (b: boolean | undefined): string => (b ? 'Yes' : 'No');
// Keep only rows that carry a value / text / heading (drop empty boxes).
const nz = (rows: FilingRow[]): FilingRow[] => rows.filter(r => r.heading || r.value != null || r.text != null);

// ── SA100 main form ──────────────────────────────────────────────────────────
function buildSa100(ret: TaxReturn, has: Record<string, boolean>): FilingForm {
  const i = ret.income;
  const c = computeSa100Full(i, ret.taxYear);
  const sections: FilingSection[] = [];

  // Personal details (TR 1)
  sections.push({
    title: 'Your personal details',
    rows: nz([
      { label: 'Name', text: ret.clientName || undefined },
      { box: 1, label: 'Date of birth', text: ret.taxpayer?.dateOfBirth || undefined },
      { box: 4, label: 'National Insurance number', text: ret.taxpayer?.nino || undefined },
      { label: 'Unique Taxpayer Reference (UTR)', text: ret.utr || undefined },
    ]),
  });

  // What makes up your tax return (TR 2) — auto-ticked from which pages have data
  sections.push({
    title: 'What makes up your tax return',
    rows: [
      { box: 1, label: 'Employment', text: yn(has.employment) },
      { box: 2, label: "Self-employment (incl. Lloyd's)", text: yn(has.selfemp || has.lloyds) },
      { box: 3, label: 'Partnership', text: yn(has.partnership) },
      { box: 4, label: 'UK property', text: yn(has.property) },
      { box: 5, label: 'Foreign', text: yn(has.foreign) },
      { box: 6, label: 'Trusts etc.', text: yn(has.trusts) },
      { box: 7, label: 'Capital Gains Tax summary', text: yn(has.cgt) },
      { box: 8, label: 'Residence, remittance basis etc.', text: yn(has.residence) },
      { box: 9, label: 'Additional information', text: yn(has.additional) },
    ],
  });

  // Income (TR 3)
  sections.push({
    title: 'Interest and dividends from UK banks and building societies',
    rows: nz([
      { box: 1, label: 'Taxed UK interest', value: m(c.savingsIncome && undefined) }, // detail lives on the box page; show untaxed below
      { box: 2, label: 'Untaxed UK interest', value: m(i.savingsInterest) },
      { box: 4, label: 'Dividends from UK companies', value: m(i.dividends) },
    ]),
  });
  sections.push({
    title: 'UK pensions, annuities and other state benefits received',
    rows: nz([
      { box: 8, label: 'State Pension', value: m(i.statePension) },
      { box: 11, label: 'Private pensions and retirement annuities', value: m(i.pensionsIncome) },
    ]),
  });

  // Tax reliefs (TR 4)
  sections.push({
    title: 'Paying into registered pension schemes and overseas pension schemes',
    rows: nz([
      { box: 1, label: 'Payments to registered pension schemes (relief at source)', value: m(i.pensionContributions) },
    ]),
  });
  sections.push({
    title: 'Charitable giving',
    rows: nz([
      { box: 5, label: 'Gift Aid payments made in the year', value: m(i.giftAid) },
    ]),
  });

  // Tax calculation summary (TR 5 / the SA302 headline)
  sections.push({
    title: 'Tax calculation summary',
    rows: nz([
      { label: 'Total income on which tax is due', value: m(c.totalIncome), strong: true },
      { label: 'Personal allowance', value: m(-c.personalAllowance) },
      { label: 'Total taxable income', value: m(c.taxableIncome), strong: true },
      { label: 'Income Tax due', value: m(c.incomeTax), strong: true },
      { label: 'Class 4 NIC due', value: m(c.class4Nic) },
      { label: 'Total tax and NIC due', value: m(c.totalDue), strong: true },
      { label: 'Tax deducted at source', value: m(-c.taxDeductedAtSource) },
      { label: 'Balancing payment for the year', value: m(c.balancingPayment), strong: true },
      { label: 'First payment on account', value: m(c.poaApplies ? c.paymentOnAccount : 0) },
    ]),
  });

  return { code: 'SA100', name: 'Tax Return', pageTag: 'TR', sections };
}

// ── SA302-style tax calculation (its own sheet) ──────────────────────────────
export function buildTaxCalcForm(ret: TaxReturn): FilingForm {
  const c = computeSa100Full(ret.income, ret.taxYear);
  const income: FilingRow[] = [
    { label: 'Employment', value: m(c.employmentIncome) },
    { label: 'Self-employment', value: m(c.tradeProfit) },
    { label: 'Partnership', value: m(c.partnershipProfit) },
    { label: 'UK property', value: m(c.propertyProfit) },
    { label: 'Savings & interest', value: m(c.savingsIncome) },
    { label: 'Dividends', value: m(c.dividendIncome) },
    ...c.otherIncomeParts.map(p => ({ label: p.label, value: m(p.amount) })),
  ];
  const bands: FilingRow[] = c.lines.filter(l => l.amount > 0).map(l => ({
    label: `${l.label} · ${fmtMoney(l.amount)} @ ${(l.rate * 100).toFixed(l.rate * 100 % 1 ? 2 : 0)}%`,
    value: m(l.tax),
  }));
  return {
    code: 'SA302', name: 'Tax calculation', pageTag: 'TC',
    sections: [
      { title: 'Income', rows: nz([...income, { label: 'Total income received', value: m(c.totalIncome), strong: true }]) },
      { title: 'Deductions', rows: nz([{ label: 'Personal allowance', value: m(c.personalAllowance) }, { label: 'Total taxable income', value: m(c.taxableIncome), strong: true }]) },
      { title: 'How your Income Tax is worked out', rows: nz(bands) },
      { title: 'Income Tax, NIC and other charges', rows: nz([
        { label: 'Income Tax charged (after reliefs)', value: m(c.incomeTax), strong: true },
        { label: 'Class 4 NIC', value: m(c.class4Nic) },
        { label: 'Student loan repayment', value: m(c.studentLoan) },
        { label: 'High Income Child Benefit Charge', value: m(c.hicbc) },
        { label: 'Capital Gains Tax', value: m(c.capitalGainsTax) },
        { label: 'Total tax, NIC and charges due', value: m(c.totalDue), strong: true },
        { label: 'Tax deducted at source', value: m(-c.taxDeductedAtSource) },
        { label: 'Balancing payment due by 31 January', value: m(c.balancingPayment), strong: true },
        { label: 'Each payment on account', value: m(c.poaApplies ? c.paymentOnAccount : 0) },
      ]) },
    ],
  };
}

// ── SA102 Employment ─────────────────────────────────────────────────────────
function buildEmployment(i: Sa100Income): FilingForm[] {
  return i.employment.filter(e => employmentTaxable(e) !== 0 || e.employer).map((e, idx) => ({
    code: 'SA102', name: `Employment${i.employment.length > 1 ? ` ${idx + 1}` : ''}`, pageTag: 'E',
    sections: [{
      title: e.employer ? `Employment — ${e.employer}` : 'Employment',
      rows: nz([
        { box: 1, label: 'Pay from this employment (P60/P45)', value: m(e.pay) },
        { box: 2, label: 'UK tax taken off box 1', value: m(e.taxDeducted) },
        { box: 3, label: 'Tips and other payments', value: m(e.tips) },
        { label: 'Benefits (P11D)', value: m(e.benefits), strong: true },
        { label: 'Allowable expenses', value: m(e.expenses) },
      ]),
    }],
  }));
}

// ── SA103 Self-employment ────────────────────────────────────────────────────
function buildSelfEmployment(i: Sa100Income): FilingForm[] {
  return i.selfEmployment.filter(t => tradeTaxableProfit(t) !== 0 || t.name).map(t => ({
    code: t.form === 'full' ? 'SA103F' : 'SA103S',
    name: t.name ? `Self-employment — ${t.name}` : 'Self-employment', pageTag: t.form === 'full' ? 'SEF' : 'SES',
    sections: [{
      title: t.name || 'Self-employment',
      rows: nz([
        { label: 'Turnover', value: m(t.turnover) },
        { label: 'Total allowable expenses', value: m(tradeExpensesTotal(t)) },
        { label: 'Net profit', value: m(tradeNetProfit(t)) },
        { label: 'Adjusted profit for the year', value: m(tradeAdjustedProfit(t)), strong: true },
        { label: 'Taxable profit', value: m(tradeTaxableProfit(t)), strong: true },
      ]),
    }],
  }));
}

// ── SA105 UK property ────────────────────────────────────────────────────────
function buildProperty(i: Sa100Income): FilingForm | null {
  if (!i.property.length) return null;
  const sum = (f: (p: (typeof i.property)[number]) => number) => i.property.reduce((a, p) => a + f(p), 0);
  const rows: FilingRow[] = [
    { box: 20, label: 'Total rents and other income from property', value: m(sum(propertyGrossIncome)) },
    { label: 'Total allowable expenses', value: m(sum(propertyExpensesTotal)) },
    { box: 38, label: 'Adjusted profit for the year', value: m(sum(propertyAdjustedProfit)), strong: true },
    { box: 40, label: 'Taxable profit for the year', value: m(sum(propertyTaxable)), strong: true },
    { box: 43, label: 'Loss to carry forward', value: m(sum(propertyLossCarryForward)) },
  ];
  // Show the taxpayer's share when any property is jointly owned.
  const anyJoint = i.property.some(p => !!p.owners);
  if (anyJoint) rows.push({ label: "This client's share of the taxable profit (filed)", value: m(sum(propertyTaxableShare)), strong: true });
  return { code: 'SA105', name: 'UK property', pageTag: 'UKP', sections: [{ title: 'UK property', rows: nz(rows) }] };
}

// ── SA104 Partnership ────────────────────────────────────────────────────────
function buildPartnership(i: Sa100Income): FilingForm[] {
  return (i.partnerships ?? []).filter(p => partnershipTaxableProfit(p) !== 0 || p.name).map(p => ({
    code: p.form === 'full' ? 'SA104F' : 'SA104S', name: p.name ? `Partnership — ${p.name}` : 'Partnership', pageTag: p.form === 'full' ? 'FP' : 'SP',
    sections: [{
      title: p.name || 'Partnership',
      rows: nz([
        { box: 1, label: 'Partnership reference number (UTR)', text: p.utr || undefined },
        { box: 8, label: 'Your share of the profit', value: m(p.profit) },
        { box: 20, label: 'Taxable profit after adjustments', value: m(partnershipTaxableProfit(p)), strong: true },
      ]),
    }],
  }));
}

// ── SA108 Capital gains ──────────────────────────────────────────────────────
function buildCgt(i: Sa100Income): FilingForm | null {
  if (!sa108HasData(i.sa108) && !i.capitalGains?.disposals?.length) return null;
  const rows: FilingRow[] = [];
  if (sa108HasData(i.sa108)) {
    const g = sa108Gains(i.sa108!);
    rows.push({ label: 'Total gains before annual exempt amount', value: m(g.normalGains + g.badrGains), strong: true });
  }
  return { code: 'SA108', name: 'Capital Gains Tax summary', pageTag: 'CG', sections: [{ title: 'Capital gains', rows: nz(rows) }] };
}

// ── SA106 Foreign ────────────────────────────────────────────────────────────
function buildForeign(i: Sa100Income): FilingForm | null {
  const ft = foreignTotals(i);
  if (!(ft.interest || ft.dividends || ft.other || ft.taxClaimed)) return null;
  return { code: 'SA106', name: 'Foreign', pageTag: 'F', sections: [{ title: 'Foreign income', rows: nz([
    { label: 'Foreign interest', value: m(ft.interest) },
    { label: 'Foreign dividends', value: m(ft.dividends) },
    { label: 'Other overseas income', value: m(ft.other) },
    { label: 'Foreign tax paid / claimed', value: m(ft.taxClaimed) },
  ]) }] };
}

// ── SA107 Trusts ─────────────────────────────────────────────────────────────
function buildTrusts(i: Sa100Income): FilingForm | null {
  const tr = trustTotals(i);
  if (!(tr.nonSavings || tr.savings || tr.dividend)) return null;
  return { code: 'SA107', name: 'Trusts etc.', pageTag: 'T', sections: [{ title: 'Trust and estate income', rows: nz([
    { label: 'Non-savings income', value: m(tr.nonSavings) },
    { label: 'Savings income', value: m(tr.savings) },
    { label: 'Dividend income', value: m(tr.dividend) },
  ]) }] };
}

// ── An office/Lloyd's "More" schedule → a form with its computed taxable ──────
function officeForm(code: string, name: string, pageTag: string, taxable: number, taxOff: number, extra: FilingRow[] = []): FilingForm {
  return { code, name, pageTag, sections: [{ title: name, rows: nz([
    ...extra,
    { label: 'Taxable income from this office', value: m(taxable), strong: true },
    { label: 'Tax taken off', value: m(taxOff) },
  ]) }] };
}

// The SA100 TR2 "what makes up your tax return" checklist — which supplementary
// pages have data (drives both the on-screen preview and the stamped tick marks).
export function filingChecklist(ret: TaxReturn): Record<string, boolean> {
  const i = ret.income;
  return {
    employment: i.employment.some(e => employmentTaxable(e) !== 0 || e.employer),
    selfemp: i.selfEmployment.some(t => tradeTaxableProfit(t) !== 0 || t.name) || lloydsHasData(i.lloyds),
    partnership: (i.partnerships ?? []).some(p => partnershipTaxableProfit(p) !== 0 || p.name),
    property: i.property.length > 0,
    foreign: !!buildForeign(i),
    trusts: !!buildTrusts(i),
    cgt: !!buildCgt(i),
    residence: !!i.residence && Object.values(i.residence).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!v)),
    additional: !!i.additional && Object.values(i.additional).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!v)),
  };
}

// ── Master builder ───────────────────────────────────────────────────────────
export function buildFilingForms(ret: TaxReturn): FilingForm[] {
  const i = ret.income;
  const has: Record<string, boolean> = { ...filingChecklist(ret), lloyds: lloydsHasData(i.lloyds) };

  const forms: FilingForm[] = [];
  forms.push(buildSa100(ret, has));       // always
  forms.push(...buildEmployment(i));
  forms.push(...buildSelfEmployment(i));
  forms.push(...buildPartnership(i));
  const prop = buildProperty(i); if (prop) forms.push(prop);
  const fgn = buildForeign(i); if (fgn) forms.push(fgn);
  const cgt = buildCgt(i); if (cgt) forms.push(cgt);
  const trusts = buildTrusts(i); if (trusts) forms.push(trusts);

  // Rare "More" schedules — only when they have data.
  if (ministerHasData(i.minister)) { const cb = ministerComputed(i.minister); forms.push(officeForm('SA102M', 'Ministers of religion', 'MR', cb.taxable, cb.taxDeducted)); }
  if (assemblyHasData(i.niAssembly)) { const cb = assemblyComputed(i.niAssembly); forms.push(officeForm('SA102MLA', 'NI Legislative Assembly', 'MLA', cb.taxable, cb.taxDeducted)); }
  if (parliamentHasData(i.parliament)) { const cb = parliamentComputed(i.parliament); forms.push(officeForm('SA102MP', 'Parliament (MPs)', 'MP', cb.taxable, cb.taxDeducted)); }
  if (scottishParliamentHasData(i.scottishParliament)) { const cb = scottishParliamentComputed(i.scottishParliament); forms.push(officeForm('SA102MSP', 'Scottish Parliament', 'MSP', cb.taxable, cb.taxDeducted)); }
  if (welshAssemblyHasData(i.welshAssembly)) { const cb = welshAssemblyComputed(i.welshAssembly); forms.push(officeForm('SA102WAM', 'Senedd (Wales)', 'WAM', cb.taxable, cb.taxDeducted)); }
  if (lloydsHasData(i.lloyds)) {
    const cb = lloydsComputed(i.lloyds);
    forms.push(officeForm('SA103L', "Lloyd's Underwriters", 'LU', cb.taxable, cb.taxDeducted, [
      { label: "Total Lloyd's income (box 27)", value: m(cb.box27) },
      { label: 'Total losses and expenses (box 40)', value: m(cb.box40) },
      { label: 'Total taxable profits (box 52)', value: m(cb.box52), strong: true },
      { label: 'Total loss to carry forward (box 62)', value: m(cb.box62) },
    ]));
  }

  // SA109 / SA101 present-markers (full box detail to be expanded).
  if (has.residence) forms.push({ code: 'SA109', name: 'Residence, remittance basis etc.', pageTag: 'RR', sections: [{ title: 'Residence', rows: [{ label: 'Residence position captured — see the Residence page for box detail.', heading: true }] }] });
  if (has.additional) forms.push({ code: 'SA101', name: 'Additional information', pageTag: 'Ai', sections: [{ title: 'Additional information', rows: [{ label: 'Additional-information entries captured — see the Additional info page for box detail.', heading: true }] }] });

  return forms;
}
