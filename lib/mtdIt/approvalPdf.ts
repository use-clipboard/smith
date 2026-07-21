import { buildPnL, fmtMoneyGbp } from './pnl';
import { formatDateUk } from './dateFormat';
import { paletteFromHex } from './brandColors';
import { shareAdjustedGbp } from './amounts';
import { isEntryFlagged } from './flags';
import type { EditorEntry } from './types';

/**
 * Renders the MTD IT approval-pack PDF as an in-memory Blob.
 *
 * Visually mirrors the in-app P&L View export (same palette, same KPI cards,
 * same income/expense bars) so the client gets a polished, branded document
 * regardless of whether it was sent via Gmail or built in compose.
 *
 * jsPDF's default Helvetica only supports WinAnsi — unicode arrows (→),
 * en-dashes (–) etc. render as junk glyphs and shift surrounding text off
 * the page. Stick to ASCII in `text()` calls.
 *
 * Dynamic-imports jspdf so it stays out of the main bundle.
 */
export async function renderApprovalPdf(opts: {
  pnls: ReturnType<typeof buildPnL>[];
  clientName: string;
  clientRef: string | null;
  quarterLabel: string;
  taxYearLabel: string;
  rangeFrom: string;
  rangeTo:   string;
  consolidated: boolean;
  /** Raw entries — if provided, transaction-detail pages are appended. */
  entries?: EditorEntry[];

  // Branding
  brandPrimaryColor?: string | null;
  logoDataUrl?: string | null;

  // Per-section toggles
  pdfInclude?: {
    kpiCards?:           boolean;
    chart?:              boolean;
    categoryTables?:     boolean;
    transactionDetail?:  boolean;
    quarterlyComparison?: boolean;
  };
  comparison?: Array<{ quarter: 1|2|3|4; income: number; expense: number; net: number; status: string }>;
}): Promise<Blob> {
  const jsPDFModule = await import('jspdf');
  const jsPDF = jsPDFModule.default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const margin   = 40;
  const contentW = pageW - margin * 2;

  // Pale, professional palette. Income/expense colours stay fixed for
  // readability — only the brand-tinted parts vary by firm setting.
  const brand = paletteFromHex(opts.brandPrimaryColor);
  const COLOR = {
    brand:        brand.brand,
    brandSoft:    brand.brandSoft,
    brandInk:     brand.brandInk,
    income:       [123, 174, 142] as [number, number, number],
    incomeSoft:   [232, 244, 236] as [number, number, number],
    expense:      [201, 127, 132] as [number, number, number],
    expenseSoft:  [245, 230, 232] as [number, number, number],
    text:         [55, 65, 81]    as [number, number, number],
    textMuted:    [120, 130, 145] as [number, number, number],
    textFaint:    [170, 178, 190] as [number, number, number],
    rule:         [228, 232, 238] as [number, number, number],
    zebra:        [250, 251, 253] as [number, number, number],
  };
  const inc = {
    kpiCards:            opts.pdfInclude?.kpiCards            ?? true,
    chart:               opts.pdfInclude?.chart               ?? true,
    categoryTables:      opts.pdfInclude?.categoryTables      ?? true,
    transactionDetail:   opts.pdfInclude?.transactionDetail   ?? true,
    quarterlyComparison: opts.pdfInclude?.quarterlyComparison ?? true,
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  function text(t: string, x: number, y: number, o: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center'; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 10);
    const c = o.color ?? COLOR.text;
    doc.setTextColor(c[0], c[1], c[2]);
    doc.text(t, x, y, { align: o.align ?? 'left' });
  }
  function fillRect(x: number, y: number, w: number, h: number, rgb: [number, number, number], r = 0) {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'F');
    else       doc.rect(x, y, w, h, 'F');
  }
  function strokeRect(x: number, y: number, w: number, h: number, rgb: [number, number, number], r = 0) {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    doc.setLineWidth(0.5);
    if (r > 0) doc.roundedRect(x, y, w, h, r, r, 'S');
    else       doc.rect(x, y, w, h, 'S');
  }
  function clip(s: string, maxW: number, size: number): string {
    if (!s) return '';
    doc.setFontSize(size);
    if (doc.getTextWidth(s) <= maxW) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const candidate = s.slice(0, mid) + '...';
      if (doc.getTextWidth(candidate) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo) + '...';
  }
  function fmtDateUkLocal(iso: string | null | undefined): string {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return iso;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  /** The client's share of a row, in GBP — mirrors buildPnL. No quarter-level
   *  fxRates in scope, so a non-GBP row relies on its own fx_rate. */
  function gbpAmount(e: EditorEntry): number {
    return shareAdjustedGbp(e, {});
  }

  function drawBrandHeader(): number {
    fillRect(0, 0, pageW, 60, COLOR.brand);
    fillRect(0, 60, pageW, 3, COLOR.brandSoft);
    let titleX = margin;
    if (opts.logoDataUrl) {
      try {
        const h = 34, w = h * 2.4;
        doc.addImage(opts.logoDataUrl, margin, 13, w, h, undefined, 'FAST');
        titleX = margin + w + 12;
      } catch { titleX = margin; }
    }
    text('MTD IT', titleX, 26, { bold: true, size: 10, color: [255, 255, 255] });
    text('Quarterly Approval Pack', titleX, 48, { bold: true, size: 17, color: [255, 255, 255] });
    const rightX = pageW - margin;
    text(`${opts.quarterLabel} ${opts.taxYearLabel}`, rightX, 26, { bold: true, size: 10, color: [255, 255, 255], align: 'right' });
    text(`${formatDateUk(opts.rangeFrom)}  to  ${formatDateUk(opts.rangeTo)}`, rightX, 48, { size: 9, color: [240, 238, 251], align: 'right' });
    return 80;
  }

  function drawFooter(pageNo: number, total: number) {
    const yF = pageH - 22;
    doc.setDrawColor(COLOR.rule[0], COLOR.rule[1], COLOR.rule[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, yF - 8, pageW - margin, yF - 8);
    const leftLine = clip(`${opts.clientName}${opts.clientRef ? ` - ${opts.clientRef}` : ''}  -  ${opts.quarterLabel} ${opts.taxYearLabel}`, contentW - 200, 8);
    text(leftLine, margin, yF, { size: 8, color: COLOR.textMuted });
    text(`Page ${pageNo} of ${total}`, pageW - margin, yF, { size: 8, color: COLOR.textMuted, align: 'right' });
  }

  function ensureSpace(yIn: number, needed: number): number {
    if (yIn + needed > pageH - 50) {
      doc.addPage();
      return drawBrandHeader();
    }
    return yIn;
  }

  function drawKpiRow(yIn: number, kpis: Array<{ label: string; value: number; tone: 'income' | 'expense' }>) {
    const cardW = (contentW - 16) / kpis.length;
    kpis.forEach((k, i) => {
      const x = margin + i * (cardW + 8);
      const accent = k.tone === 'income' ? COLOR.income : COLOR.expense;
      const soft   = k.tone === 'income' ? COLOR.incomeSoft : COLOR.expenseSoft;
      fillRect(x, yIn, cardW, 74, [255, 255, 255], 6);
      strokeRect(x, yIn, cardW, 74, COLOR.rule, 6);
      fillRect(x, yIn, cardW, 5, accent, 0);
      text(k.label.toUpperCase(), x + 14, yIn + 24, { bold: true, size: 8, color: COLOR.textMuted });
      text(fmtMoneyGbp(k.value), x + 14, yIn + 54, { bold: true, size: 17, color: accent });
      const chipText = k.tone === 'income' ? 'IN' : (k.value < 0 ? 'LOSS' : 'OUT');
      const chipW    = doc.getTextWidth(chipText) + 12;
      fillRect(x + cardW - chipW - 12, yIn + 14, chipW, 14, soft, 7);
      text(chipText, x + cardW - chipW / 2 - 12, yIn + 24, { bold: true, size: 7, color: accent, align: 'center' });
    });
  }

  function drawCategoryTable(yIn: number, section: { title: string; lines: Array<{ category: string; amount: number }>; total: number }, tone: 'income' | 'expense'): number {
    const accent = tone === 'income' ? COLOR.income : COLOR.expense;
    const soft   = tone === 'income' ? COLOR.incomeSoft : COLOR.expenseSoft;
    const headerH = 22, rowH = 18, totalH = 22;
    const rowsToDraw = section.lines.length > 0 ? section.lines : [{ category: '(no entries)', amount: 0 }];
    const tableH = headerH + rowsToDraw.length * rowH + totalH;
    yIn = ensureSpace(yIn, tableH + 14);

    fillRect(margin, yIn, contentW, headerH, accent, 4);
    text(section.title.toUpperCase(), margin + 14, yIn + 15, { bold: true, size: 9, color: [255, 255, 255] });
    text(`${section.lines.length} ${section.lines.length === 1 ? 'category' : 'categories'}`, pageW - margin - 14, yIn + 15, {
      size: 8, color: [255, 255, 255], align: 'right',
    });
    let cy = yIn + headerH;

    rowsToDraw.forEach((l, i) => {
      if (i % 2 === 1) fillRect(margin, cy, contentW, rowH, COLOR.zebra);
      text(l.category, margin + 14, cy + 12, { size: 9, color: section.lines.length === 0 ? COLOR.textFaint : COLOR.text });
      if (section.lines.length > 0) {
        text(fmtMoneyGbp(l.amount), pageW - margin - 14, cy + 12, { size: 9, align: 'right' });
      }
      cy += rowH;
    });

    fillRect(margin, cy, contentW, totalH, soft);
    text(`Total ${section.title}`, margin + 14, cy + 14, { bold: true, size: 10, color: accent });
    text(fmtMoneyGbp(section.total), pageW - margin - 14, cy + 14, { bold: true, size: 11, align: 'right', color: accent });
    cy += totalH;

    strokeRect(margin, yIn, contentW, tableH, COLOR.rule, 4);
    return cy;
  }

  function drawIncomeExpenseChart(yIn: number, inc: number, exp: number): number {
    const maxV = Math.max(inc, exp, 1);
    const labelW = 70;
    const barX = margin + labelW;
    const barWMax = contentW - labelW - 90;
    const barH = 18, rowGap = 8;

    text('INCOME vs EXPENSE', margin, yIn + 4, { bold: true, size: 8, color: COLOR.textMuted });
    yIn += 14;

    text('Income', margin, yIn + 13, { size: 9 });
    fillRect(barX, yIn, barWMax, barH, COLOR.zebra, 3);
    fillRect(barX, yIn, Math.max(2, (inc / maxV) * barWMax), barH, COLOR.income, 3);
    text(fmtMoneyGbp(inc), barX + barWMax + 8, yIn + 13, { bold: true, size: 9, color: COLOR.income });
    yIn += barH + rowGap;

    text('Expense', margin, yIn + 13, { size: 9 });
    fillRect(barX, yIn, barWMax, barH, COLOR.zebra, 3);
    fillRect(barX, yIn, Math.max(2, (exp / maxV) * barWMax), barH, COLOR.expense, 3);
    text(fmtMoneyGbp(exp), barX + barWMax + 8, yIn + 13, { bold: true, size: 9, color: COLOR.expense });
    yIn += barH + 6;
    return yIn;
  }

  function drawTransactionTable(yIn: number, tone: 'income' | 'expense', category: string, rows: EditorEntry[]): number {
    const accent = tone === 'income' ? COLOR.income : COLOR.expense;
    const soft   = tone === 'income' ? COLOR.incomeSoft : COLOR.expenseSoft;
    const headerH = 22, colHeaderH = 13, rowH = 18, totalH = 22;
    const tableH = headerH + colHeaderH + rows.length * rowH + totalH;
    yIn = ensureSpace(yIn, tableH + 14);

    // Columns: Date | Description | Supplier | Invoice | Amount
    const dateW = 58, supplierW = 88, invoiceW = 62, amtW = 74;
    const dateX     = margin + 14;
    const descX     = dateX + dateW;
    const descW     = contentW - 14 - dateW - supplierW - invoiceW - amtW - 14;
    const supplierX = descX + descW;
    const invoiceX  = supplierX + supplierW;
    const amtX      = pageW - margin - 14;

    fillRect(margin, yIn, contentW, headerH, accent, 4);
    text(`${tone === 'income' ? 'INCOME' : 'EXPENSE'} - ${clip(category, contentW - 200, 9).toUpperCase()}`, margin + 14, yIn + 15, {
      bold: true, size: 9, color: [255, 255, 255],
    });
    text(`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`, pageW - margin - 14, yIn + 15, {
      size: 8, color: [255, 255, 255], align: 'right',
    });

    // Column-label sub-row so the extra columns read clearly.
    let cy = yIn + headerH;
    fillRect(margin, cy, contentW, colHeaderH, COLOR.zebra);
    text('DATE',        dateX,     cy + 9, { bold: true, size: 6.5, color: COLOR.textMuted });
    text('DESCRIPTION', descX,     cy + 9, { bold: true, size: 6.5, color: COLOR.textMuted });
    text('SUPPLIER',    supplierX, cy + 9, { bold: true, size: 6.5, color: COLOR.textMuted });
    text('INVOICE',     invoiceX,  cy + 9, { bold: true, size: 6.5, color: COLOR.textMuted });
    text('AMOUNT',      amtX,      cy + 9, { bold: true, size: 6.5, color: COLOR.textMuted, align: 'right' });
    cy += colHeaderH;

    let total = 0;
    rows.forEach((r, i) => {
      if (i % 2 === 1) fillRect(margin, cy, contentW, rowH, COLOR.zebra);
      const desc = r.description || '(no description)';
      const amt  = gbpAmount(r);
      total += amt;
      text(fmtDateUkLocal(r.entry_date), dateX, cy + 12, { size: 8, color: COLOR.textMuted });
      const descText = clip(desc, descW - 4, 9);
      if (r.drive_link) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(COLOR.brandInk[0], COLOR.brandInk[1], COLOR.brandInk[2]);
        doc.textWithLink(descText, descX, cy + 12, { url: r.drive_link });
      } else {
        text(descText, descX, cy + 12, { size: 9 });
      }
      if (r.supplier)       text(clip(r.supplier, supplierW - 4, 8),      supplierX, cy + 12, { size: 8, color: COLOR.textMuted });
      if (r.invoice_number) text(clip(r.invoice_number, invoiceW - 4, 8), invoiceX,  cy + 12, { size: 8, color: COLOR.textMuted });
      text(fmtMoneyGbp(amt), amtX, cy + 12, { size: 9, align: 'right' });
      cy += rowH;
    });
    fillRect(margin, cy, contentW, totalH, soft);
    text('Category total', margin + 14, cy + 14, { bold: true, size: 9, color: accent });
    text(fmtMoneyGbp(total), amtX, cy + 14, { bold: true, size: 10, align: 'right', color: accent });
    cy += totalH;
    strokeRect(margin, yIn, contentW, tableH, COLOR.rule, 4);
    return cy;
  }

  /** Q1-Q4 comparison table. */
  function drawQuarterlyComparison(yIn: number, rows: Array<{ quarter: 1|2|3|4; income: number; expense: number; net: number; status: string }>) {
    const headerH = 22, rowH = 22;
    fillRect(margin, yIn, contentW, headerH, COLOR.brand, 4);
    text('QUARTER',  margin + 14,              yIn + 15, { bold: true, size: 8, color: [255, 255, 255] });
    text('STATUS',   margin + contentW * 0.22, yIn + 15, { bold: true, size: 8, color: [255, 255, 255] });
    text('INCOME',   margin + contentW * 0.5,  yIn + 15, { bold: true, size: 8, color: [255, 255, 255], align: 'right' });
    text('EXPENSE',  margin + contentW * 0.72, yIn + 15, { bold: true, size: 8, color: [255, 255, 255], align: 'right' });
    text('NET',      margin + contentW - 14,   yIn + 15, { bold: true, size: 8, color: [255, 255, 255], align: 'right' });
    let cy = yIn + headerH;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (i % 2 === 1) fillRect(margin, cy, contentW, rowH, COLOR.zebra);
      text(`Q${r.quarter}`, margin + 14, cy + 14, { bold: true, size: 10 });
      text(r.status.toUpperCase(), margin + contentW * 0.22, cy + 14, { size: 8, color: COLOR.textMuted });
      text(fmtMoneyGbp(r.income),  margin + contentW * 0.5,  cy + 14, { size: 10, align: 'right', color: COLOR.income });
      text(fmtMoneyGbp(r.expense), margin + contentW * 0.72, cy + 14, { size: 10, align: 'right', color: COLOR.expense });
      const netColor = r.net >= 0 ? COLOR.income : COLOR.expense;
      text(fmtMoneyGbp(r.net), margin + contentW - 14, cy + 14, { bold: true, size: 10, align: 'right', color: netColor });
      cy += rowH;
    }
    strokeRect(margin, yIn, contentW, headerH + rows.length * rowH, COLOR.rule, 4);
  }

  // ── Cover page ────────────────────────────────────────────────────────
  let y = drawBrandHeader();

  // Client / period card
  fillRect(margin, y, contentW, 62, COLOR.brandSoft, 6);
  text('PREPARED FOR', margin + 16, y + 20, { bold: true, size: 8, color: COLOR.brandInk });
  text(clip(opts.clientName, contentW * 0.55, 15), margin + 16, y + 40, { bold: true, size: 15 });
  if (opts.clientRef) {
    text(`Code: ${opts.clientRef}`, margin + 16, y + 55, { size: 9, color: COLOR.textMuted });
  }
  text('PERIOD', pageW - margin - 16, y + 20, { bold: true, size: 8, color: COLOR.brandInk, align: 'right' });
  text(`${opts.quarterLabel} ${opts.taxYearLabel}`, pageW - margin - 16, y + 40, { bold: true, size: 15, align: 'right' });
  text(`${formatDateUk(opts.rangeFrom)}  to  ${formatDateUk(opts.rangeTo)}`, pageW - margin - 16, y + 55, { size: 9, color: COLOR.textMuted, align: 'right' });
  y += 78;

  const totalIncome  = opts.pnls.reduce((a, p) => a + p.income.total, 0);
  const totalExpense = opts.pnls.reduce((a, p) => a + p.expense.total, 0);
  const totalNet     = totalIncome - totalExpense;
  if (inc.kpiCards) {
    drawKpiRow(y, [
      { label: 'Total income',  value: totalIncome,  tone: 'income' },
      { label: 'Total expense', value: totalExpense, tone: 'expense' },
      { label: 'Net',           value: totalNet,     tone: totalNet >= 0 ? 'income' : 'expense' },
    ]);
    y += 88;
  }

  // Quarterly comparison table — cover only
  if (inc.quarterlyComparison && opts.comparison && opts.comparison.length > 0) {
    y = ensureSpace(y, 90);
    text('Quarterly comparison', margin, y, { bold: true, size: 11, color: COLOR.brandInk });
    text(`Tax year ${opts.taxYearLabel}`, pageW - margin, y, { size: 9, color: COLOR.textMuted, align: 'right' });
    y += 12;
    drawQuarterlyComparison(y, opts.comparison);
    y += 26 + opts.comparison.length * 22 + 14;
  }

  fillRect(margin, y, contentW, 60, COLOR.zebra, 4);
  text('REVIEW & APPROVE', margin + 14, y + 18, { bold: true, size: 8, color: COLOR.brandInk });
  text('Please review the figures inside and approve via the link in the email.', margin + 14, y + 34, { size: 10 });
  text('If anything needs amending, click "Request changes" instead and let us know.', margin + 14, y + 48, { size: 9, color: COLOR.textMuted });
  y += 76;

  // ── Per-stream summary pages ─────────────────────────────────────────
  for (const s of opts.pnls) {
    doc.addPage();
    y = drawBrandHeader();

    text(s.streamLabel.toUpperCase(), margin, y + 4, { bold: true, size: 9, color: COLOR.brandInk });
    text(`${s.streamLabel} - Summary`, margin, y + 22, { bold: true, size: 15 });
    y += 38;

    if (inc.kpiCards) {
      drawKpiRow(y, [
        { label: 'Income',  value: s.income.total,  tone: 'income'  },
        { label: 'Expense', value: s.expense.total, tone: 'expense' },
        { label: 'Net',     value: s.net,           tone: s.net >= 0 ? 'income' : 'expense' },
      ]);
      y += 88;
    }

    if (inc.chart) {
      y = drawIncomeExpenseChart(y, s.income.total, s.expense.total);
      y += 10;
    }

    if (inc.categoryTables) {
      y = drawCategoryTable(y, s.income,  'income');
      y += 12;
      y = drawCategoryTable(y, s.expense, 'expense');
      y += 12;
    }

    // Residential finance costs — shown separately so the client understands the
    // profit isn't reduced by their mortgage interest; relief comes as a reducer.
    if (s.residentialFinanceCost > 0) {
      y = ensureSpace(y, 44);
      fillRect(margin, y, contentW, 36, COLOR.brandSoft, 4);
      strokeRect(margin, y, contentW, 36, COLOR.rule, 4);
      text('Residential finance costs (not deducted)', margin + 14, y + 15, { bold: true, size: 9, color: COLOR.brandInk });
      text(fmtMoneyGbp(s.residentialFinanceCost), pageW - margin - 14, y + 15, { bold: true, size: 10, align: 'right', color: COLOR.brandInk });
      text('Mortgage/loan interest on residential lets is not deducted from profit; relief is given as a 20% reduction of the tax due.', margin + 14, y + 29, { size: 8, color: COLOR.textMuted });
      y += 44;
    }
  }

  // ── Transaction detail pages (one section per stream) ────────────────
  if (inc.transactionDetail && opts.entries && opts.entries.length > 0) {
    const clean = opts.entries.filter(e => !e._deleted && !isEntryFlagged(e));
    for (const s of opts.pnls) {
      const streamRows = clean.filter(e => e.stream === s.stream);
      if (streamRows.length === 0) continue;

      doc.addPage();
      y = drawBrandHeader();
      text(s.streamLabel.toUpperCase(), margin, y + 4, { bold: true, size: 9, color: COLOR.brandInk });
      text(`${s.streamLabel} - Transaction detail`, margin, y + 22, { bold: true, size: 15 });
      text(`${streamRows.length} clean entr${streamRows.length === 1 ? 'y' : 'ies'} (flagged rows excluded)`, margin, y + 38, { size: 9, color: COLOR.textMuted });
      y += 54;

      for (const tone of ['income', 'expense'] as const) {
        const subset = streamRows.filter(e => e.entry_type === tone);
        if (subset.length === 0) continue;
        const byCat = new Map<string, EditorEntry[]>();
        for (const e of subset) {
          const arr = byCat.get(e.category) ?? [];
          arr.push(e); byCat.set(e.category, arr);
        }
        const cats = Array.from(byCat.keys()).sort((a, b) => a.localeCompare(b));
        for (const cat of cats) {
          y = drawTransactionTable(y, tone, cat, byCat.get(cat)!);
          y += 10;
        }
      }
    }
  }

  // ── Footer pass with real total page count ────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    fillRect(0, pageH - 36, pageW, 36, [255, 255, 255]);
    drawFooter(p, total);
  }

  return doc.output('blob');
}

/** Base64-encode a Blob without blowing the call stack on large files. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return btoa(binary);
}

/** Inline summary line for the email body. */
export interface SummaryLine { label: string; value: string; }
