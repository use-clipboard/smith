// Tax Studio — SA100 client-approval pack PDF (jsPDF, client-side).
//
// Mirrors the MTD IT approval pack's vector layout. Four sections: cover +
// headline, tax computation (SA302-style), the return figures, and the payment
// schedule (Jan + July) with how-to-pay. jsPDF Helvetica is WinAnsi-only, so
// stick to ASCII in text() (£ is in WinAnsi, so it's fine; avoid en-dashes/arrows).

import type { Sa100Income } from './types';
import type { Sa100Computation } from './calc';
import { computeSa100Full, employmentBenefits, employmentExpenses, tradeNetProfit, tradeAdjustedProfit, propertyTaxable, foreignTotals } from './calc';
import { returnType } from './data';

export interface SummaryLine { label: string; value: string; }

const gbp = (n: number) => `${n < 0 ? '-' : ''}£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
const pct = (r: number) => `${(r * 100).toFixed(r * 100 % 1 ? 2 : 0)}%`;

export interface Sa100PackInput {
  clientName: string;
  clientRef: string | null;
  utr?: string | null;
  taxYear: string;              // '2025/26'
  returnTypeId: string;
  entityLabel: string;
  preparedBy?: string;
  income: Sa100Income;
}

/** The Jan (balancing + first POA) and July (second POA) amounts + due dates. */
export function paymentSchedule(c: Sa100Computation, taxYear: string) {
  const startYear = parseInt(taxYear.slice(0, 4), 10);
  const dueYear = Number.isNaN(startYear) ? 2027 : startYear + 2; // 31 Jan / 31 Jul following the tax year
  return {
    balancing: c.balancingPayment,
    poaEach: c.paymentOnAccount,
    janTotal: c.balancingPayment + c.paymentOnAccount,
    julTotal: c.paymentOnAccount,
    janDate: `31 January ${dueYear}`,
    julDate: `31 July ${dueYear}`,
  };
}

export async function renderSa100ApprovalPdf(input: Sa100PackInput): Promise<Blob> {
  const c = computeSa100Full(input.income, input.taxYear);
  const sched = paymentSchedule(c, input.taxYear);
  const rt = returnType(input.returnTypeId as Parameters<typeof returnType>[0]);

  const jsPDF = (await import('jspdf')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;

  const COLOR = {
    brand: [79, 70, 229] as [number, number, number],       // indigo
    brandSoft: [237, 235, 254] as [number, number, number],
    brandInk: [67, 56, 202] as [number, number, number],
    accent: [13, 148, 136] as [number, number, number],
    text: [55, 65, 81] as [number, number, number],
    textMuted: [120, 130, 145] as [number, number, number],
    rule: [228, 232, 238] as [number, number, number],
    zebra: [250, 251, 253] as [number, number, number],
  };

  function text(t: string, x: number, y: number, o: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center'; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 10);
    const cc = o.color ?? COLOR.text;
    doc.setTextColor(cc[0], cc[1], cc[2]);
    doc.text(t, x, y, { align: o.align ?? 'left' });
  }
  function fillRect(x: number, y: number, w: number, h: number, rgb: [number, number, number], r = 0) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'F'); else doc.rect(x, y, w, h, 'F');
  }
  function strokeRect(x: number, y: number, w: number, h: number, rgb: [number, number, number], r = 0) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.5);
    if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'S'); else doc.rect(x, y, w, h, 'S');
  }
  function clip(s: string, maxW: number, size: number): string {
    if (!s) return ''; doc.setFontSize(size);
    if (doc.getTextWidth(s) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (doc.getTextWidth(s.slice(0, mid) + '...') <= maxW) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo) + '...';
  }

  function drawHeader(): number {
    fillRect(0, 0, pageW, 60, COLOR.brand);
    fillRect(0, 60, pageW, 3, COLOR.brandSoft);
    text('Tax Studio', margin, 26, { bold: true, size: 10, color: [255, 255, 255] });
    text('Self Assessment Approval Pack', margin, 48, { bold: true, size: 17, color: [255, 255, 255] });
    text(`${rt.form} ${input.taxYear}`, pageW - margin, 26, { bold: true, size: 10, color: [255, 255, 255], align: 'right' });
    text(rt.label, pageW - margin, 48, { size: 9, color: [240, 238, 251], align: 'right' });
    return 80;
  }
  function drawFooter(pageNo: number, total: number) {
    const yF = pageH - 22;
    doc.setDrawColor(COLOR.rule[0], COLOR.rule[1], COLOR.rule[2]); doc.setLineWidth(0.5);
    doc.line(margin, yF - 8, pageW - margin, yF - 8);
    text(clip(`${input.clientName}${input.clientRef ? ` - ${input.clientRef}` : ''}  -  ${rt.form} ${input.taxYear}`, contentW - 200, 8), margin, yF, { size: 8, color: COLOR.textMuted });
    text(`Page ${pageNo} of ${total}`, pageW - margin, yF, { size: 8, color: COLOR.textMuted, align: 'right' });
  }
  function ensureSpace(yIn: number, needed: number): number {
    if (yIn + needed > pageH - 50) { doc.addPage(); return drawHeader(); }
    return yIn;
  }
  function kpiRow(yIn: number, kpis: { label: string; value: string }[]) {
    const cardW = (contentW - 16) / kpis.length;
    kpis.forEach((k, i) => {
      const x = margin + i * (cardW + 8);
      fillRect(x, yIn, cardW, 68, [255, 255, 255], 6);
      strokeRect(x, yIn, cardW, 68, COLOR.rule, 6);
      fillRect(x, yIn, cardW, 5, COLOR.brand, 0);
      text(k.label.toUpperCase(), x + 14, yIn + 26, { bold: true, size: 8, color: COLOR.textMuted });
      text(k.value, x + 14, yIn + 52, { bold: true, size: 16, color: COLOR.brandInk });
    });
  }

  // A running key/value row printer for the computation & return pages.
  function line(state: { y: number }, label: string, value: string | null, o: { bold?: boolean; rule?: boolean; indent?: number; muted?: boolean } = {}) {
    state.y = ensureSpace(state.y, 20);
    const y = state.y;
    if (o.rule) { doc.setDrawColor(COLOR.rule[0], COLOR.rule[1], COLOR.rule[2]); doc.setLineWidth(0.5); doc.line(margin, y - 12, pageW - margin, y - 12); }
    text(label, margin + (o.indent ?? 0), y, { bold: o.bold, size: o.bold ? 10.5 : 9.5, color: o.muted ? COLOR.textMuted : COLOR.text });
    if (value != null) text(value, pageW - margin, y, { bold: o.bold, size: o.bold ? 10.5 : 9.5, align: 'right', color: o.muted ? COLOR.textMuted : COLOR.text });
    state.y += o.bold ? 20 : 17;
  }
  function heading(state: { y: number }, t: string) {
    state.y = ensureSpace(state.y, 30) + 6;
    text(t.toUpperCase(), margin, state.y, { bold: true, size: 9, color: COLOR.brandInk });
    state.y += 16;
  }

  // ── Cover ────────────────────────────────────────────────────────────────
  let y = drawHeader();
  fillRect(margin, y, contentW, 66, COLOR.brandSoft, 6);
  text('PREPARED FOR', margin + 16, y + 20, { bold: true, size: 8, color: COLOR.brandInk });
  text(clip(input.clientName, contentW * 0.55, 15), margin + 16, y + 40, { bold: true, size: 15 });
  text(`${input.entityLabel}${input.clientRef ? ` · ${input.clientRef}` : ''}${input.utr ? ` · UTR ${input.utr}` : ''}`, margin + 16, y + 56, { size: 9, color: COLOR.textMuted });
  text('TAX YEAR', pageW - margin - 16, y + 20, { bold: true, size: 8, color: COLOR.brandInk, align: 'right' });
  text(input.taxYear, pageW - margin - 16, y + 40, { bold: true, size: 15, align: 'right' });
  text('Self Assessment', pageW - margin - 16, y + 56, { size: 9, color: COLOR.textMuted, align: 'right' });
  y += 82;

  kpiRow(y, [
    { label: 'Total income', value: gbp(c.totalIncome) },
    { label: 'Tax & NIC due', value: gbp(c.totalDue) },
    { label: `Due ${sched.janDate}`, value: gbp(sched.janTotal) },
  ]);
  y += 84;

  fillRect(margin, y, contentW, 60, COLOR.zebra, 4);
  strokeRect(margin, y, contentW, 60, COLOR.rule, 4);
  text('REVIEW & APPROVE', margin + 14, y + 18, { bold: true, size: 8, color: COLOR.brandInk });
  text('Please review your tax computation and return inside, then approve via the link in the email.', margin + 14, y + 34, { size: 10 });
  text('If anything needs changing, click "Request changes" instead and let us know.', margin + 14, y + 48, { size: 9, color: COLOR.textMuted });

  // ── Tax computation (SA302 style) ──────────────────────────────────────────
  doc.addPage(); y = drawHeader();
  text('Tax calculation (SA302)', margin, y + 4, { bold: true, size: 15 });
  text(`For the year 6 April to 5 April ${input.taxYear}`, margin, y + 20, { size: 9, color: COLOR.textMuted });
  const st = { y: y + 40 };

  heading(st, 'Income');
  const emp = c.employmentIncome, trade = c.tradeProfit, prop = c.propertyProfit;
  if (emp > 0) line(st, 'Pay from employment (net of expenses)', gbp(emp));
  if (trade > 0) line(st, 'Profit from self-employment', gbp(trade));
  if (c.partnershipProfit > 0) line(st, 'Profit from partnership', gbp(c.partnershipProfit));
  if (prop > 0) line(st, 'Profit from property', gbp(prop));
  if (c.savingsIncome > 0) line(st, 'Interest from savings', gbp(c.savingsIncome));
  if (c.dividendIncome > 0) line(st, 'Dividends', gbp(c.dividendIncome));
  if (c.otherIncome > 0) line(st, 'Pensions and other income', gbp(c.otherIncome));
  line(st, 'Total income received', gbp(c.totalIncome), { bold: true, rule: true });
  line(st, `Personal allowance${c.paTapered ? ' (tapered)' : ''}`, `(${gbp(c.personalAllowance)})`);
  line(st, 'Total taxable income', gbp(c.taxableIncome), { bold: true, rule: true });

  heading(st, 'Income tax');
  for (const l of c.lines.filter(l => l.amount > 0)) line(st, `${l.label} — ${gbp(l.amount)} @ ${pct(l.rate)}`, gbp(l.tax), { indent: 6 });
  if (c.financeCostReducer > 0) line(st, 'Less finance-cost reducer (20%)', `(${gbp(c.financeCostReducer)})`, { indent: 6 });
  if (c.marriageAllowanceReducer > 0) line(st, 'Less Marriage Allowance', `(${gbp(c.marriageAllowanceReducer)})`, { indent: 6 });
  if (c.foreignTaxCreditRelief > 0) line(st, 'Less Foreign Tax Credit Relief', `(${gbp(c.foreignTaxCreditRelief)})`, { indent: 6 });
  line(st, 'Income tax due', gbp(c.incomeTax), { bold: true, rule: true });
  if (c.class4Nic > 0) line(st, 'Class 4 National Insurance', gbp(c.class4Nic));
  if (c.studentLoan > 0) line(st, 'Student loan repayment', gbp(c.studentLoan));
  if (c.hicbc > 0) line(st, 'High Income Child Benefit Charge', gbp(c.hicbc));
  if (c.capitalGainsTax > 0) line(st, `Capital gains tax (on ${gbp(c.taxableGains)})`, gbp(c.capitalGainsTax));
  line(st, 'Total income tax and NICs due', gbp(c.totalDue), { bold: true, rule: true });
  if (c.taxDeductedAtSource > 0) line(st, 'Less tax deducted at source', `(${gbp(c.taxDeductedAtSource)})`);
  line(st, 'Balancing payment', gbp(c.balancingPayment), { bold: true, rule: true });
  st.y = ensureSpace(st.y, 20);
  text('This is a computation prepared by your accountant, not an HMRC document. Figures are subject to HMRC processing.', margin, st.y + 4, { size: 8, color: COLOR.textMuted });

  // ── Return figures ─────────────────────────────────────────────────────────
  doc.addPage(); y = drawHeader();
  text('Your tax return', margin, y + 4, { bold: true, size: 15 });
  text('The figures included in this Self Assessment return', margin, y + 20, { size: 9, color: COLOR.textMuted });
  const rs = { y: y + 40 };
  const i = input.income;
  if (i.employment.length) { heading(rs, 'Employment'); for (const e of i.employment) { line(rs, e.employer || 'Employment', gbp(e.pay + (e.tips || 0))); line(rs, '  Tax deducted / benefits / expenses', `${gbp(e.taxDeducted)} / ${gbp(employmentBenefits(e))} / ${gbp(employmentExpenses(e))}`, { muted: true, indent: 6 }); } }
  if (i.selfEmployment.length) { heading(rs, 'Self-employment'); for (const s of i.selfEmployment) { const net = tradeNetProfit(s); const adj = tradeAdjustedProfit(s); line(rs, s.name || 'Self-employment', gbp(adj)); if (adj !== net) line(rs, `  Net profit ${gbp(net)}, then tax adjustments`, null, { muted: true, indent: 6 }); } }
  if ((i.partnerships ?? []).length) { heading(rs, 'Partnership'); for (const p of (i.partnerships ?? [])) line(rs, p.name || 'Partnership', gbp(p.profit)); }
  if (i.property.length) { heading(rs, 'Property'); for (const p of i.property) line(rs, p.address || 'Property', gbp(propertyTaxable(p))); }
  const fT = foreignTotals(i);
  const others: [string, number][] = [
    ['Dividends', i.dividends], ['Savings interest', i.savingsInterest], ['Pensions income', i.pensionsIncome],
    ['State pension', i.statePension || 0], ['Foreign income', fT.interest + fT.dividends + fT.other], ['Foreign tax paid', fT.taxClaimed],
    ['Other income', i.otherIncome], ['Gift Aid (net)', i.giftAid], ['Personal pension contributions (net)', i.pensionContributions],
    ['Child benefit received', i.childBenefit || 0],
  ];
  const nonZero = others.filter(([, v]) => v > 0);
  if (nonZero.length) { heading(rs, 'Other income & reliefs'); for (const [l, v] of nonZero) line(rs, l, gbp(v)); }

  // ── Payments & how to pay ──────────────────────────────────────────────────
  doc.addPage(); y = drawHeader();
  text('What to pay and when', margin, y + 4, { bold: true, size: 15 });
  y += 30;

  function payCard(yIn: number, title: string, amount: string, lines: string[]): number {
    const h = 40 + lines.length * 14;
    fillRect(margin, yIn, contentW, h, COLOR.brandSoft, 6);
    strokeRect(margin, yIn, contentW, h, COLOR.rule, 6);
    text(title, margin + 16, yIn + 22, { bold: true, size: 11, color: COLOR.brandInk });
    text(amount, pageW - margin - 16, yIn + 24, { bold: true, size: 16, align: 'right', color: COLOR.brandInk });
    let ly = yIn + 38;
    for (const l of lines) { text(l, margin + 16, ly, { size: 9, color: COLOR.textMuted }); ly += 14; }
    return yIn + h + 12;
  }
  const janLines = sched.poaEach > 0
    ? [`Balancing payment for ${input.taxYear}: ${gbp(sched.balancing)}`, `First payment on account towards next year: ${gbp(sched.poaEach)}`]
    : [`Balancing payment for ${input.taxYear}: ${gbp(sched.balancing)}`];
  y = payCard(y, `Due by ${sched.janDate}`, gbp(sched.janTotal), janLines);
  if (sched.julTotal > 0) y = payCard(y, `Due by ${sched.julDate}`, gbp(sched.julTotal), [`Second payment on account towards next year: ${gbp(sched.poaEach)}`]);

  y += 6;
  text('HOW TO PAY', margin, y, { bold: true, size: 9, color: COLOR.brandInk }); y += 16;
  const payHow = [
    'Pay online at gov.uk/pay-self-assessment-tax-bill (debit card or bank transfer).',
    'Bank transfer to HMRC (as published by HMRC): sort code 08 32 10, account 12001039,',
    `account name "HMRC Cumbernauld". Your payment reference is your UTR followed by the letter K${input.utr ? ` — i.e. ${input.utr}K` : ''}.`,
    'Pay by the deadline above to avoid HMRC interest and late-payment penalties.',
    'Always confirm the current HMRC payment details on gov.uk before paying.',
  ];
  for (const l of payHow) { y = ensureSpace(y, 16); text(l, margin, y, { size: 9 }); y += 15; }

  // ── Footers ────────────────────────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    fillRect(0, pageH - 36, pageW, 36, [255, 255, 255]);
    drawFooter(p, total);
  }
  return doc.output('blob');
}

/** Base64-encode a Blob without blowing the call stack. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  return btoa(binary);
}

/** Headline summary lines for the approval email body. */
export function packSummaryLines(income: Sa100Income, taxYear: string): SummaryLine[] {
  const c = computeSa100Full(income, taxYear);
  const s = paymentSchedule(c, taxYear);
  return [
    { label: 'Total income', value: gbp(c.totalIncome) },
    { label: 'Total tax & NIC due', value: gbp(c.totalDue) },
    { label: `Due ${s.janDate}`, value: gbp(s.janTotal) },
    ...(s.julTotal > 0 ? [{ label: `Due ${s.julDate}`, value: gbp(s.julTotal) }] : []),
  ];
}
