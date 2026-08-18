// Tax Studio — "Detailed schedule" report PDF (jsPDF, client-side).
//
// A per-source detailed schedule: every grouped figure on the computation is
// expanded into its constituent lines (employment pay/benefits/expenses,
// self-employment expenses, property expenses, interest, dividends, pensions,
// reliefs) followed by a tax summary. Renders the shared DetailSection[] model
// from detailedReport.ts, so it always agrees with the on-screen Detailed Report.
//
// jsPDF Helvetica is WinAnsi-only, so text() stays ASCII (£ is fine; avoid
// en-dashes / arrows / ×).

import type { Sa100Income } from './types';
import { buildDetailedReport, type DetailSection, type DetailRow } from './detailedReport';

export interface DetailedReportInput {
  clientName: string;
  clientRef?: string | null;
  utr?: string | null;
  taxYear: string;        // '2025/26'
  income: Sa100Income;
  preparedBy?: string;
}

const gbp2 = (n: number) => `${n < 0 ? '-' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (r: DetailRow): string | null => (r.value == null ? null : (r.paren ? `(${gbp2(Math.abs(r.value))})` : gbp2(r.value)));

export async function renderDetailedReportPdf(input: DetailedReportInput): Promise<Blob> {
  const sections = buildDetailedReport(input.income, input.taxYear);
  const yearDash = input.taxYear.replace('/', '-');
  const endYear = `20${input.taxYear.slice(-2)}`;

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
    text(`Detailed schedule for year ended 05 April ${endYear}`, pageW / 2, 60, { bold: true, size: 15, align: 'center' });
    rule(76, margin, pageW - margin, COLOR.brandInk, 1);
    const y = 98;
    text('Client name', margin, y - 13, { size: 7.5, bold: true, color: COLOR.muted });
    text(input.clientName || '-', margin, y, { bold: true, size: 11 });
    text('UTR', pageW - margin, y - 13, { size: 7.5, bold: true, color: COLOR.muted, align: 'right' });
    text(input.utr || '-', pageW - margin, y, { bold: true, size: 11, align: 'right' });
    rule(y + 12);
    return y + 30;
  }

  const st = { y: drawMasthead() };
  function ensureSpace(needed: number) {
    if (st.y + needed > pageH - 56) { doc.addPage(); st.y = drawMasthead(); }
  }

  function sectionHeader(s: DetailSection) {
    ensureSpace(48); st.y += 10;
    text(s.title, margin, st.y, { bold: true, size: 11, color: COLOR.brandInk });
    st.y += 5; rule(st.y); st.y += 4;
    if (s.subtitle) { st.y += 11; text(s.subtitle, margin, st.y, { size: 8.5, color: COLOR.muted }); }
    st.y += 15;
  }
  function drawRow(r: DetailRow) {
    ensureSpace(18);
    const bold = r.kind === 'total' || r.kind === 'subtotal';
    const muted = r.kind === 'muted';
    const size = r.kind === 'total' ? 10 : 9.5;
    const color = muted ? COLOR.muted : COLOR.ink;
    if (r.kind === 'total') rule(st.y - 11);
    const x = margin + (r.indent ?? 0) * 16;
    text(r.label, x, st.y, { bold, size, color });
    const v = cell(r);
    if (v != null) text(v, pageW - margin, st.y, { bold, size, align: 'right', color });
    st.y += r.kind === 'total' ? 19 : 16;
  }

  if (!sections.length) {
    text('No figures have been entered on this return yet.', margin, st.y + 6, { size: 10, color: COLOR.muted });
  }
  for (const s of sections) {
    sectionHeader(s);
    for (const r of s.rows) drawRow(r);
    st.y += 6;
  }

  // Disclaimer
  ensureSpace(40); st.y += 6;
  doc.setFillColor(COLOR.soft[0], COLOR.soft[1], COLOR.soft[2]);
  doc.roundedRect(margin, st.y, pageW - margin * 2, 30, 4, 4, 'F');
  text('This is a detailed schedule prepared by your accountant to support the tax calculation. It is not an HMRC document.', margin + 12, st.y + 18, { size: 8.5, color: COLOR.muted });

  // Footers
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const yF = pageH - 28;
    rule(yF - 8);
    text(`${input.clientName}${input.clientRef ? ` - ${input.clientRef}` : ''}  ·  Detailed schedule ${yearDash}`, margin, yF, { size: 8, color: COLOR.muted });
    text(`Page ${p} of ${total}`, pageW - margin, yF, { size: 8, color: COLOR.muted, align: 'right' });
    if (input.preparedBy) text(`Prepared by ${input.preparedBy}`, pageW / 2, yF, { size: 8, color: COLOR.muted, align: 'center' });
  }

  return doc.output('blob');
}
