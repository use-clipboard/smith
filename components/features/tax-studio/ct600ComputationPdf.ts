// Tax Studio — CT600 "Corporation Tax Computation" report PDF (jsPDF, client-side).
//
// A formal corporation-tax computation the firm can hand to a client or attach
// to the return: trading-profit build-up, other income, total profits, losses &
// reliefs, profits chargeable to Corporation Tax, the CT charge (rate + marginal
// relief), and the payment / filing deadlines. Same jsPDF engine as the SA302.
// Helvetica is WinAnsi-only, so text() stays ASCII (£ is fine; avoid en-dashes).

import { computeCt600, ct600PaymentDue, ct600FilingDue } from './calc';
import type { Ct600Data } from './types';

export interface Ct600CompInput {
  clientName: string;
  clientRef?: string | null;
  utr?: string | null;
  registrationNumber?: string | null;
  periodStart?: string;
  periodEnd?: string;
  taxYear: string;
  ct600: Ct600Data | undefined;
  preparedBy?: string;
}

const gbp2 = (n: number) => `${n < 0 ? '-' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const m = (n: number | undefined | null): string | undefined => (n && Math.round(n) !== 0 ? gbp2(Math.round(n)) : undefined);
const ukDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};

export function ct600CompFileName(clientName: string, periodEnd?: string): string {
  const name = (clientName || 'Company').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Company';
  const yr = periodEnd ? new Date(periodEnd).getFullYear() : '';
  return `${name}-Corporation Tax Computation${yr ? `-${yr}` : ''}.pdf`;
}

export async function renderCt600CompPdf(input: Ct600CompInput): Promise<Blob> {
  const c = computeCt600(input.ct600, input.taxYear, { periodStart: input.periodStart, periodEnd: input.periodEnd });
  const t = input.ct600?.trading ?? {};
  const n = (v?: number) => v || 0;

  const jsPDF = (await import('jspdf')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;

  const COLOR = {
    ink: [31, 41, 55] as [number, number, number],
    muted: [120, 130, 145] as [number, number, number],
    brandInk: [67, 56, 202] as [number, number, number],
    rule: [214, 219, 227] as [number, number, number],
    soft: [244, 246, 250] as [number, number, number],
  };
  function text(s: string, x: number, y: number, o: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center'; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 9.5);
    const cc = o.color ?? COLOR.ink;
    doc.setTextColor(cc[0], cc[1], cc[2]);
    doc.text(s, x, y, { align: o.align ?? 'left' });
  }
  function rule(y: number, x1 = margin, x2 = pageW - margin, rgb: [number, number, number] = COLOR.rule, w = 0.5) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(w); doc.line(x1, y, x2, y);
  }
  function drawMasthead(): number {
    text('Corporation Tax Computation', pageW / 2, 62, { bold: true, size: 18, align: 'center' });
    text(`For the accounting period ${ukDate(input.periodStart)} to ${ukDate(input.periodEnd)}`, pageW / 2, 80, { size: 9.5, align: 'center', color: COLOR.muted });
    rule(96, margin, pageW - margin, COLOR.brandInk, 1);
    const y = 116;
    text('Company', margin, y - 14, { size: 7.5, bold: true, color: COLOR.muted });
    text(input.clientName || '-', margin, y, { bold: true, size: 11 });
    text('Company no.', pageW / 2 + 20, y - 14, { size: 7.5, bold: true, color: COLOR.muted });
    text(input.registrationNumber || '-', pageW / 2 + 20, y, { bold: true, size: 11 });
    text('CT UTR', pageW - margin, y - 14, { size: 7.5, bold: true, color: COLOR.muted, align: 'right' });
    text(input.utr || '-', pageW - margin, y, { bold: true, size: 11, align: 'right' });
    rule(y + 12);
    return y + 30;
  }

  const st = { y: drawMasthead() };
  function ensureSpace(needed: number) { if (st.y + needed > pageH - 60) { doc.addPage(); st.y = drawMasthead(); } }
  function heading(title: string) {
    ensureSpace(34); st.y += 8;
    text(title, margin, st.y, { bold: true, size: 10.5, color: COLOR.brandInk });
    st.y += 6; rule(st.y); st.y += 14;
  }
  function row(label: string, value: string | undefined, o: { bold?: boolean; ruleAbove?: boolean; indent?: number } = {}) {
    if (value == null && !o.bold) return;
    ensureSpace(18);
    if (o.ruleAbove) rule(st.y - 11);
    text(label, margin + (o.indent ?? 0), st.y, { bold: o.bold, size: o.bold ? 10 : 9.5 });
    if (value != null) text(value, pageW - margin, st.y, { bold: o.bold, size: o.bold ? 10 : 9.5, align: 'right' });
    st.y += o.bold ? 19 : 16;
  }

  // 1) Trading profit
  heading('Trading and professional profits');
  row('Profit/(loss) per accounts', gbp2(Math.round(n(t.profitPerAccount))));
  row('Add: adjustments and add-backs', m(n(t.addBack) + n(t.adjustments)), { indent: 6 });
  row('Add: disallowable expenses', m(t.disallowableExpenses), { indent: 6 });
  row('Add: balancing charges', m(t.balancingCharges), { indent: 6 });
  row('Add: income not credited but assessable', m(t.incomeNotCredited), { indent: 6 });
  row('Add: RDEC / AVEC / VGEC', m(n(t.rdec) + n(t.avec) + n(t.vgec)), { indent: 6 });
  row('Less: income not assessed as trading', m(-n(t.incomeNotAssessed)), { indent: 6 });
  row('Less: expenditure not in accounts', m(-n(t.expenditureNotInAccounts)), { indent: 6 });
  row('Less: R&D / Films expenditure', m(-n(t.rdOrFilmsExpenditure)), { indent: 6 });
  row('Less: R&D / Films relief', m(-n(t.rdOrFilmsRelief)), { indent: 6 });
  row('Less: capital allowances', m(-n(t.capitalAllowances)), { indent: 6 });
  row('Taxable trading profit', gbp2(c.taxableTradingProfit), { bold: true, ruleAbove: true });

  // 2) Other income
  const hasOther = c.nonTradingLoanProfit || c.propertyProfit || c.overseasProfit || c.intangiblesProfit || c.chargeableGains || c.otherIncome;
  if (hasOther) {
    heading('Other income');
    row('Non-trading loan relationship profit', m(c.nonTradingLoanProfit));
    row('UK property profit', m(c.propertyProfit));
    row('Overseas profit', m(c.overseasProfit));
    row('Non-trading intangibles', m(c.intangiblesProfit));
    row('Chargeable gains', m(c.chargeableGains));
    row('Other income', m(c.otherIncome));
  }

  // 3) Total profits → PCTCT
  heading('Profits chargeable to Corporation Tax');
  row('Total profits', gbp2(c.totalProfits), { bold: true });
  row('Less: losses and reliefs', m(-(c.totalProfits - c.pctct)));
  row('Profits chargeable to Corporation Tax', gbp2(c.pctct), { bold: true, ruleAbove: true });

  // 4) The CT charge
  heading('Corporation Tax');
  row(`Corporation Tax @ ${c.ctRatePct.toFixed(c.ctRatePct % 1 ? 2 : 0)}%`, gbp2(c.taxBeforeMarginalRelief));
  if (c.marginalRelief > 0) row('Less: marginal relief', `(${gbp2(c.marginalRelief)})`);
  row('Corporation Tax due', gbp2(c.corporationTax), { bold: true, ruleAbove: true });

  // 5) Key dates
  heading('Key dates');
  row('Payment due (9 months and 1 day after period end)', ukDate(ct600PaymentDue(input.periodEnd)));
  row('Return filing deadline (12 months after period end)', ukDate(ct600FilingDue(input.periodEnd)));

  // Disclaimer
  ensureSpace(40); st.y += 8;
  doc.setFillColor(COLOR.soft[0], COLOR.soft[1], COLOR.soft[2]);
  doc.roundedRect(margin, st.y, pageW - margin * 2, 32, 4, 4, 'F');
  text('This is a corporation-tax computation prepared by your accountant. It is not an HMRC document.', margin + 12, st.y + 14, { size: 8.5, color: COLOR.muted });
  text('Associated-company limits, group relief and quarterly instalment payments may apply — review before filing.', margin + 12, st.y + 25, { size: 8.5, color: COLOR.muted });

  // Footers
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const yF = pageH - 28;
    rule(yF - 8);
    text(`${input.clientName}${input.clientRef ? ` - ${input.clientRef}` : ''}  ·  Corporation Tax Computation`, margin, yF, { size: 8, color: COLOR.muted });
    text(`Page ${p} of ${total}`, pageW - margin, yF, { size: 8, color: COLOR.muted, align: 'right' });
    if (input.preparedBy) text(`Prepared by ${input.preparedBy}`, pageW / 2, yF, { size: 8, color: COLOR.muted, align: 'center' });
  }

  return doc.output('blob');
}
