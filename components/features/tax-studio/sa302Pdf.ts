// Tax Studio — standalone "Tax Calculation (SA302)" report PDF (jsPDF, client-side).
//
// A formal, HMRC-style SA302 tax calculation the firm can download and send to a
// client or lender. Mirrors the classic commercial-software SA302 layout: income
// received, how the Income Tax is worked out, charges, tax deducted, payments on
// account already made, and a "Summary of amounts due" (31 Jan / 31 Jul).
//
// jsPDF Helvetica is WinAnsi-only, so text() stays ASCII (£ is in WinAnsi; avoid
// en-dashes / arrows / × — use '-', 'minus'/'plus', 'x').

import type { Sa100Income } from './types';
import { computeSa100Full, paymentPlan } from './calc';

export interface Sa302Input {
  clientName: string;
  clientRef?: string | null;
  utr?: string | null;
  taxYear: string;        // '2025/26'
  income: Sa100Income;
  preparedBy?: string;
}

const gbp2 = (n: number) => `${n < 0 ? '-' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const paren = (n: number) => `(${gbp2(Math.abs(n))})`;
const pct = (r: number) => `${(r * 100).toFixed(r * 100 % 1 ? 2 : 0)}%`;

/** Filename-safe: "Lana Spice-SA302 Report-2025-26.pdf". */
export function sa302FileName(clientName: string, taxYear: string): string {
  const name = (clientName || 'Client').replace(/[\\/:*?"<>|]+/g, '').trim();
  return `${name}-SA302 Report-${taxYear.replace('/', '-')}.pdf`;
}

export async function renderSa302Pdf(input: Sa302Input): Promise<Blob> {
  const c = computeSa100Full(input.income, input.taxYear);
  const plan = paymentPlan(input.income, input.taxYear);
  const yearDash = input.taxYear.replace('/', '-');
  const yearCompact = input.taxYear.replace(/\D/g, ''); // '2025/26' -> '202526'

  const jsPDF = (await import('jspdf')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;
  const contentW = pageW - margin * 2;

  const COLOR = {
    ink: [31, 41, 55] as [number, number, number],
    muted: [110, 120, 135] as [number, number, number],
    brandInk: [67, 56, 202] as [number, number, number],
    rule: [214, 219, 227] as [number, number, number],
    soft: [244, 246, 250] as [number, number, number],
    accent: [13, 148, 136] as [number, number, number],
  };

  function text(t: string, x: number, y: number, o: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center'; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 9.5);
    const cc = o.color ?? COLOR.ink;
    doc.setTextColor(cc[0], cc[1], cc[2]);
    doc.text(t, x, y, { align: o.align ?? 'left' });
  }
  function rule(y: number, x1 = margin, x2 = pageW - margin, rgb: [number, number, number] = COLOR.rule, w = 0.5) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(w); doc.line(x1, y, x2, y);
  }

  function drawMasthead(): number {
    text('Tax Calculation (SA302)', pageW / 2, 62, { bold: true, size: 18, align: 'center' });
    text(`For the year 6 April ${input.taxYear.slice(0, 4)} to 5 April 20${input.taxYear.slice(-2)}`, pageW / 2, 80, { size: 9.5, align: 'center', color: COLOR.muted });
    rule(96, margin, pageW - margin, COLOR.brandInk, 1);
    // Client / UTR / tax year strip
    const y = 116;
    text('Client name', margin, y - 14, { size: 7.5, bold: true, color: COLOR.muted });
    text(input.clientName || '-', margin, y, { bold: true, size: 11 });
    text('UTR', pageW / 2 + 20, y - 14, { size: 7.5, bold: true, color: COLOR.muted });
    text(input.utr || '-', pageW / 2 + 20, y, { bold: true, size: 11 });
    text('Tax year', pageW - margin, y - 14, { size: 7.5, bold: true, color: COLOR.muted, align: 'right' });
    text(yearDash, pageW - margin, y, { bold: true, size: 11, align: 'right' });
    rule(y + 12);
    return y + 30;
  }

  function ensureSpace(state: { y: number }, needed: number) {
    if (state.y + needed > pageH - 60) { doc.addPage(); state.y = drawMasthead(); }
  }
  // Section heading.
  function heading(state: { y: number }, t: string) {
    ensureSpace(state, 34); state.y += 8;
    text(t, margin, state.y, { bold: true, size: 10.5, color: COLOR.brandInk });
    state.y += 6; rule(state.y); state.y += 14;
  }
  // A label / value row. `col` picks the value column: 'a' = inner, 'b' = outer.
  function row(state: { y: number }, label: string, value: string | null, o: { bold?: boolean; indent?: number; muted?: boolean; col?: 'a' | 'b'; ruleAbove?: boolean } = {}) {
    ensureSpace(state, 18);
    const y = state.y;
    if (o.ruleAbove) rule(y - 11);
    const col = o.muted ? COLOR.muted : COLOR.ink;
    text(label, margin + (o.indent ?? 0), y, { bold: o.bold, size: o.bold ? 10 : 9.5, color: col });
    if (value != null) {
      const x = o.col === 'a' ? pageW - margin - 150 : pageW - margin;
      text(value, x, y, { bold: o.bold, size: o.bold ? 10 : 9.5, align: 'right', color: col });
    }
    state.y += o.bold ? 19 : 16;
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  let y = drawMasthead();
  const st = { y };

  // 1) Income received (before tax taken off)
  heading(st, 'Income received (before tax taken off)');
  const parts = [
    { label: 'Pay, benefits and expenses from all employments', amount: c.employmentIncome },
    { label: 'Profit from self-employment', amount: c.tradeProfit },
    { label: 'Profit from partnerships', amount: c.partnershipProfit },
    { label: 'Profit from UK land and property', amount: c.propertyProfit },
    { label: 'Interest from UK banks, building societies and securities', amount: c.savingsIncome },
    { label: 'Dividends from UK companies', amount: c.dividendIncome },
    ...(c.otherIncomeParts.length ? c.otherIncomeParts : (c.otherIncome > 0 ? [{ label: 'Other income', amount: c.otherIncome }] : [])),
  ].filter(p => p.amount > 0);
  for (const p of parts) row(st, p.label, gbp2(p.amount), { col: 'b' });
  row(st, 'Total income received', gbp2(c.totalIncome), { bold: true, ruleAbove: true });
  row(st, `minus Personal Allowance${c.paTapered ? ' (tapered)' : ''}`, paren(c.personalAllowance));
  if (c.charityAssetGiftsDeduction > 0) row(st, 'minus Gifts of shares or land to charity', paren(c.charityAssetGiftsDeduction));
  row(st, 'Total income on which tax is due', gbp2(c.taxableIncome), { bold: true, ruleAbove: true });

  // 2) How your Income Tax is worked out (bands)
  heading(st, 'How your Income Tax is worked out');
  for (const l of c.lines.filter(l => l.amount > 0)) {
    row(st, `${l.label}  -  ${gbp2(l.amount)} at ${pct(l.rate)}`, gbp2(l.tax), { indent: 4, col: 'b' });
  }
  if (c.financeCostReducer > 0) row(st, 'minus Relief for residential finance costs (20%)', paren(c.financeCostReducer), { indent: 4 });
  if (c.marriageAllowanceReducer > 0) row(st, 'minus Marriage Allowance transfer', paren(c.marriageAllowanceReducer), { indent: 4 });
  if (c.foreignTaxCreditRelief > 0) row(st, 'minus Foreign Tax Credit Relief', paren(c.foreignTaxCreditRelief), { indent: 4 });
  if (c.additionalReliefs > 0) row(st, 'minus Other reliefs (EIS / SEIS / VCT / other)', paren(c.additionalReliefs), { indent: 4 });
  row(st, 'Income Tax charged after allowances and reliefs', gbp2(c.incomeTax), { bold: true, ruleAbove: true });

  // 3) Other charges
  if (c.class4Nic > 0) row(st, 'plus Class 4 National Insurance contributions', gbp2(c.class4Nic));
  if (c.studentLoan > 0) row(st, 'plus Student and Postgraduate Loan repayments', gbp2(c.studentLoan));
  if (c.hicbc > 0) row(st, 'plus High Income Child Benefit Charge', gbp2(c.hicbc));
  if (c.capitalGainsTax > 0) row(st, `plus Capital Gains Tax (on ${gbp2(c.taxableGains)})`, gbp2(c.capitalGainsTax));
  row(st, 'Income Tax, Class 4 NIC and other charges due', gbp2(c.totalDue), { bold: true, ruleAbove: true });

  // 4) Tax deducted at source
  if (c.taxDeductedAtSource > 0 || (input.income.taxRefundedOrSetOff ?? 0) > 0) {
    heading(st, 'Tax deducted');
    if (c.taxDeductedAtSource > 0) row(st, 'minus Tax deducted at source (PAYE, CIS, tax on savings etc.)', paren(c.taxDeductedAtSource));
    if ((input.income.taxRefundedOrSetOff ?? 0) > 0) row(st, 'plus Tax refunded or set off in the year', gbp2(input.income.taxRefundedOrSetOff ?? 0));
  }
  {
    const bal = plan.netLiability;
    row(st, bal < 0 ? `Income Tax overpaid for ${yearDash}` : `Income Tax due for ${yearDash}`, bal < 0 ? paren(bal) : gbp2(bal), { bold: true, ruleAbove: true });
  }

  // 5) Payments on account already made towards this year
  if (plan.hasPoaData) {
    heading(st, `Payments already made towards ${yearDash}`);
    if (plan.firstPoaMade > 0) row(st, `${yearCompact} First payment on account`, paren(plan.firstPoaMade));
    if (plan.secondPoaMade > 0) row(st, `${yearCompact} Second payment on account`, paren(plan.secondPoaMade));
    if (plan.otherPaid > 0) row(st, 'Other payments made towards the balancing payment', paren(plan.otherPaid));
    row(st, `Total paid towards ${yearDash}`, paren(plan.poaMadeTotal), { ruleAbove: true });
    row(st,
      plan.isRefund ? `Balancing position for ${yearDash} - overpaid` : `Balancing payment for ${yearDash}`,
      plan.isRefund ? paren(plan.balanceForYear) : gbp2(plan.balanceForYear),
      { bold: true });
  }

  // 6) Summary of amounts due
  heading(st, 'Summary of amounts due');
  const janRefund = plan.janDue < -0.5;
  // 31 January
  row(st, `Amount due ${plan.janDate}`, janRefund ? `${gbp2(Math.abs(plan.janDue))} refund` : gbp2(plan.janDue), { bold: true });
  const janSub: string[] = [
    plan.isRefund
      ? `${yearDash} refund ${gbp2(plan.refundAmount)}`
      : `${yearDash} balancing payment ${gbp2(Math.max(0, plan.balanceForYear))}`,
    ...(plan.poaApplies ? [`${plan.nextTaxYear} first payment on account ${gbp2(plan.nextPoaEach)}`] : []),
  ];
  for (const s of janSub) row(st, s, null, { indent: 12, muted: true });
  // 31 July
  st.y += 4;
  if (plan.poaApplies) {
    row(st, `Amount due ${plan.julDate}`, gbp2(plan.julDue), { bold: true });
    row(st, `${plan.nextTaxYear} second payment on account`, null, { indent: 12, muted: true });
  } else {
    row(st, `Amount due ${plan.julDate}`, gbp2(0), { bold: true });
    row(st, `No payment on account due - ${yearDash} tax under £1,000 or 80%+ collected at source`, null, { indent: 12, muted: true });
  }

  // Info note
  st.y += 10; ensureSpace(st, 40);
  doc.setFillColor(COLOR.soft[0], COLOR.soft[1], COLOR.soft[2]);
  doc.roundedRect(margin, st.y, contentW, 32, 4, 4, 'F');
  text('Please note HMRC may charge interest and penalties on any amount not paid by its due date.', margin + 12, st.y + 14, { size: 8.5, color: COLOR.muted });
  text('This is a tax calculation prepared by your accountant. It is not an HMRC document; figures are subject to HMRC processing.', margin + 12, st.y + 25, { size: 8.5, color: COLOR.muted });

  // ── Footers (page x of y) ──────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const yF = pageH - 30;
    rule(yF - 8);
    text(`${input.clientName}${input.clientRef ? ` - ${input.clientRef}` : ''}  ·  Tax Calculation (SA302) ${yearDash}`, margin, yF, { size: 8, color: COLOR.muted });
    text(`Page ${p} of ${total}`, pageW - margin, yF, { size: 8, color: COLOR.muted, align: 'right' });
    if (input.preparedBy) text(`Prepared by ${input.preparedBy}`, pageW / 2, yF, { size: 8, color: COLOR.muted, align: 'center' });
  }

  return doc.output('blob');
}
