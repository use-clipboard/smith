// PDF + Excel exports for the MTD IT P&L View modal.
//
// PDF — jsPDF with manually-placed rects + text. We draw zebra-striped
// tables, KPI cards, a tiny income-vs-expense bar chart, and a per-stream
// transaction-detail section.
//
// jsPDF's default font (Helvetica) only supports WinAnsi — unicode arrows
// (→), en-dashes (–) etc. render as junk glyphs and shift surrounding text
// off the page. Stick to ASCII in `text()` calls.
//
// Excel — SheetJS, one sheet per stream. Unchanged.

import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { fmtMoneyGbp, type PnLForStream, type PnLSection, type PnLBucket } from '@/lib/mtdIt/pnl';
import { paletteFromHex } from '@/lib/mtdIt/brandColors';
import type { EditorEntry } from '@/components/features/mtd-it/MtdItStreamColumn';
import type { MtdItProperty, MtdItTrade } from '@/types';

export interface ExportContext {
  clientName: string;
  clientRef:  string | null;
  taxYearLabel: string;            // e.g. "2026/27"
  quarterLabel: string;            // e.g. "Q1"
  rangeFrom: string;               // ISO
  rangeTo:   string;               // ISO
  /** Whether consolidated reporting is on — affects only the heading note. */
  consolidated: boolean;
  /** Raw entries for the transaction-detail pages. Optional for
   *  backwards-compatibility; when omitted, the detail pages are skipped. */
  entries?: EditorEntry[];

  // Branding
  /** #RRGGBB; falls back to the default lavender if absent or invalid. */
  brandPrimaryColor?: string | null;
  /** Logo as a data URL (data:image/png;base64,...) — embedded on cover + headers. */
  logoDataUrl?: string | null;

  // Per-section toggles
  pdfInclude?: {
    kpiCards?:           boolean;
    chart?:              boolean;
    categoryTables?:     boolean;
    breakdown?:          boolean;
    transactionDetail?:  boolean;
    quarterlyComparison?: boolean;
  };

  /** Quarterly comparison rows (Q1..Q4) for the cover page table.
   *  Provided by the caller; the PDF doesn't fetch on its own. */
  comparison?: Array<{ quarter: 1|2|3|4; income: number; expense: number; net: number; status: string }>;
}

// ─────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────
function fmtDateUk(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

/** Truncate a string to fit a column, with an ellipsis (rendered as "...").
 *  Uses doc.getTextWidth to be font-aware. */
function clipToWidth(doc: jsPDF, s: string, maxW: number, size: number): string {
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

// Fixed colour roles. Income/expense stay fixed for readability (green +
// rose) regardless of brand colour — only the brand-tinted parts (header
// band, brand-tinted table headers, KPI accent strips) vary.
const FIXED = {
  income:       [123, 174, 142] as [number, number, number], // sage green
  incomeSoft:   [232, 244, 236] as [number, number, number],
  expense:      [201, 127, 132] as [number, number, number], // dusty rose
  expenseSoft:  [245, 230, 232] as [number, number, number],
  text:         [55, 65, 81]    as [number, number, number], // gray-700
  textMuted:    [120, 130, 145] as [number, number, number],
  textFaint:    [170, 178, 190] as [number, number, number],
  rule:         [228, 232, 238] as [number, number, number],
  zebra:        [250, 251, 253] as [number, number, number],
  warning:      [164, 116, 47]  as [number, number, number],
  warningSoft:  [253, 245, 230] as [number, number, number],
};

export function exportPnLPdf(streams: PnLForStream[], ctx: ExportContext): void {
  const doc      = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW    = doc.internal.pageSize.getWidth();
  const pageH    = doc.internal.pageSize.getHeight();
  const margin   = 40;
  const contentW = pageW - margin * 2;

  // Brand palette derived from the firm setting; falls back to default.
  const brand = paletteFromHex(ctx.brandPrimaryColor);
  const COLOR = { ...FIXED, brand: brand.brand, brandSoft: brand.brandSoft, brandInk: brand.brandInk };
  // Per-section toggles. Default everything ON for back-compat.
  const inc = {
    kpiCards:            ctx.pdfInclude?.kpiCards            ?? true,
    chart:               ctx.pdfInclude?.chart               ?? true,
    categoryTables:      ctx.pdfInclude?.categoryTables      ?? true,
    breakdown:           ctx.pdfInclude?.breakdown           ?? true,
    transactionDetail:   ctx.pdfInclude?.transactionDetail   ?? true,
    quarterlyComparison: ctx.pdfInclude?.quarterlyComparison ?? true,
  };

  // ── Drawing primitives ────────────────────────────────────────────────
  function setText(rgb: [number, number, number]) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
  function text(t: string, x: number, y: number, o: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center'; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    doc.setFontSize(o.size ?? 10);
    setText(o.color ?? COLOR.text);
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

  // ── Page furniture ────────────────────────────────────────────────────
  function drawFooter(pageNo: number, totalPages: number | null) {
    const yF = pageH - 22;
    doc.setDrawColor(COLOR.rule[0], COLOR.rule[1], COLOR.rule[2]);
    doc.setLineWidth(0.5);
    doc.line(margin, yF - 8, pageW - margin, yF - 8);
    const leftLine = clipToWidth(doc, `${ctx.clientName}${ctx.clientRef ? ` - ${ctx.clientRef}` : ''}  -  ${ctx.quarterLabel} ${ctx.taxYearLabel}`, contentW - 200, 8);
    text(leftLine, margin, yF, { size: 8, color: COLOR.textMuted });
    text(totalPages ? `Page ${pageNo} of ${totalPages}` : `Page ${pageNo}`, pageW - margin, yF, {
      size: 8, color: COLOR.textMuted, align: 'right',
    });
  }

  /** Y position the body starts at after the brand header band. */
  function drawBrandHeader(): number {
    fillRect(0, 0, pageW, 60, COLOR.brand);
    fillRect(0, 60, pageW, 3, COLOR.brandSoft);
    // Optional logo on the left of the title block. Sized to fit the band
    // and inset; we let jsPDF infer the format from the data URL.
    let titleX = margin;
    if (ctx.logoDataUrl) {
      try {
        const h = 34;
        const w = h * 2.4; // accept up to ~2.4:1 logos; jsPDF preserves intrinsic ratio if we don't pass w/h on AddImage
        doc.addImage(ctx.logoDataUrl, margin, 13, w, h, undefined, 'FAST');
        titleX = margin + w + 12;
      } catch {
        // Bad data url — skip, never block PDF render
        titleX = margin;
      }
    }
    text('MTD IT', titleX, 26, { bold: true, size: 10, color: [255, 255, 255] });
    text('Profit & Loss', titleX, 48, { bold: true, size: 17, color: [255, 255, 255] });
    // Right: period block — keep ASCII-only ("to" rather than the unicode arrow)
    const rightX = pageW - margin;
    text(`${ctx.quarterLabel} ${ctx.taxYearLabel}`, rightX, 26, { bold: true, size: 10, color: [255, 255, 255], align: 'right' });
    text(`${fmtDateUk(ctx.rangeFrom)}  to  ${fmtDateUk(ctx.rangeTo)}`, rightX, 48, { size: 9, color: [240, 238, 251], align: 'right' });
    return 80;
  }

  function ensureSpace(yIn: number, needed: number): number {
    if (yIn + needed > pageH - 50) {
      doc.addPage();
      return drawBrandHeader();
    }
    return yIn;
  }

  // ── Cover page ────────────────────────────────────────────────────────
  let y = drawBrandHeader();

  // Client card
  fillRect(margin, y, contentW, 62, COLOR.brandSoft, 6);
  text('CLIENT', margin + 16, y + 20, { bold: true, size: 8, color: COLOR.brandInk });
  text(clipToWidth(doc, ctx.clientName, contentW * 0.55, 15), margin + 16, y + 40, { bold: true, size: 15 });
  if (ctx.clientRef) {
    text(`Code: ${ctx.clientRef}`, margin + 16, y + 55, { size: 9, color: COLOR.textMuted });
  }
  if (ctx.consolidated) {
    text('CONSOLIDATED REPORTING', pageW - margin - 16, y + 20, { bold: true, size: 8, color: COLOR.warning, align: 'right' });
    text('On (combined gross income < £90k)', pageW - margin - 16, y + 36, { size: 9, color: COLOR.textMuted, align: 'right' });
  }
  y += 78;

  // Aggregate KPI cards across all streams
  const totalIncome  = streams.reduce((a, s) => a + s.income.total,  0);
  const totalExpense = streams.reduce((a, s) => a + s.expense.total, 0);
  const totalNet     = totalIncome - totalExpense;
  if (inc.kpiCards) {
    drawKpiRow(y, [
      { label: 'Total income',  value: totalIncome,  tone: 'income'  },
      { label: 'Total expense', value: totalExpense, tone: 'expense' },
      { label: 'Net',           value: totalNet,     tone: totalNet >= 0 ? 'income' : 'expense' },
    ]);
    y += 88;
  }

  // Streams summary table
  text('Streams summary', margin, y, { bold: true, size: 11, color: COLOR.brandInk });
  y += 12;
  drawStreamSummaryTable(y, streams);
  y += 24 + streams.length * 22 + 12;

  // Quarterly comparison table (cover page only)
  if (inc.quarterlyComparison && ctx.comparison && ctx.comparison.length > 0) {
    y = ensureSpace(y, 90);
    text('Quarterly comparison', margin, y, { bold: true, size: 11, color: COLOR.brandInk });
    text(`Tax year ${ctx.taxYearLabel}`, pageW - margin, y, { size: 9, color: COLOR.textMuted, align: 'right' });
    y += 12;
    drawQuarterlyComparison(y, ctx.comparison);
    y += 26 + ctx.comparison.length * 22 + 14;
  }

  // "In this report" callout
  text('In this report', margin, y, { bold: true, size: 11, color: COLOR.brandInk });
  y += 12;
  fillRect(margin, y, contentW, 72, COLOR.zebra, 4);
  text('-  Per-stream P&L with income, expense and net totals',          margin + 14, y + 18, { size: 9 });
  text('-  Category-level breakdown of every income and expense line',   margin + 14, y + 32, { size: 9 });
  text('-  Per-trade or per-property breakdown where applicable',        margin + 14, y + 46, { size: 9 });
  if (ctx.entries && ctx.entries.length > 0) {
    text('-  Transaction-level detail for every clean entry',            margin + 14, y + 60, { size: 9 });
  }
  y += 86;

  const totalUnconverted = streams.reduce((a, s) => a + s.unconvertedCount, 0);
  if (totalUnconverted > 0) {
    fillRect(margin, y, contentW, 28, COLOR.warningSoft, 4);
    strokeRect(margin, y, contentW, 28, [228, 200, 150], 4);
    text(`Note: ${totalUnconverted} row(s) had no FX rate and contribute GBP 0 to the totals.`, margin + 12, y + 18, {
      size: 9, color: COLOR.warning,
    });
    y += 36;
  }

  drawFooter(1, null);

  // ── Per-stream pages ──────────────────────────────────────────────────
  let pageNo = 2;
  for (const s of streams) {
    doc.addPage();
    y = drawBrandHeader();

    text(s.streamLabel.toUpperCase(), margin, y + 4, { bold: true, size: 9, color: COLOR.brandInk });
    text(`${s.streamLabel} - Summary`, margin, y + 22, { bold: true, size: 15 });
    text(`${s.rowCount} entr${s.rowCount === 1 ? 'y' : 'ies'} included`, margin, y + 38, { size: 9, color: COLOR.textMuted });
    if (s.unconvertedCount > 0) {
      text(`${s.unconvertedCount} row(s) without FX rate -> GBP 0`, pageW - margin, y + 38, {
        size: 9, color: COLOR.warning, align: 'right',
      });
    }
    y += 54;

    if (inc.kpiCards) {
      drawKpiRow(y, [
        { label: 'Income',  value: s.income.total,  tone: 'income'  },
        { label: 'Expense', value: s.expense.total, tone: 'expense' },
        { label: 'Net',     value: s.net,           tone: s.net >= 0 ? 'income' : 'expense' },
      ]);
      y += 88;
    }

    if (inc.chart) {
      y = drawIncomeExpenseChart(y, s);
      y += 10;
    }

    if (inc.categoryTables) {
      y = drawCategoryTable(y, s.income, 'income');
      y += 12;
      y = drawCategoryTable(y, s.expense, 'expense');
      y += 12;
    }

    if (inc.breakdown && s.breakdown.length > 0) {
      y = ensureSpace(y, 80);
      text('Breakdown by ' + (s.stream === 'sole' ? 'trade' : 'property'), margin, y, { bold: true, size: 11, color: COLOR.brandInk });
      y += 14;
      for (const b of s.breakdown) y = drawBucket(y, b);
    }

    pageNo++;
  }

  // ── Transaction detail pages ──────────────────────────────────────────
  if (inc.transactionDetail && ctx.entries && ctx.entries.length > 0) {
    // Group: stream -> entry_type -> category -> rows
    // Only clean, non-deleted, non-flagged entries.
    const clean = ctx.entries.filter(e => !e._deleted && !(e.flagged_reason && !e.flag_dismissed));
    for (const s of streams) {
      const streamRows = clean.filter(e => e.stream === s.stream);
      if (streamRows.length === 0) continue;

      doc.addPage();
      y = drawBrandHeader();
      text(s.streamLabel.toUpperCase(), margin, y + 4, { bold: true, size: 9, color: COLOR.brandInk });
      text(`${s.streamLabel} - Transaction detail`, margin, y + 22, { bold: true, size: 15 });
      text(`${streamRows.length} clean entr${streamRows.length === 1 ? 'y' : 'ies'} (flagged rows excluded)`, margin, y + 38, { size: 9, color: COLOR.textMuted });
      y += 54;

      // Income first, then Expense
      for (const tone of ['income', 'expense'] as const) {
        const subset = streamRows.filter(e => e.entry_type === tone);
        if (subset.length === 0) continue;
        const byCat = new Map<string, EditorEntry[]>();
        for (const e of subset) {
          const arr = byCat.get(e.category) ?? [];
          arr.push(e); byCat.set(e.category, arr);
        }
        // Stable alpha order on category
        const cats = Array.from(byCat.keys()).sort((a, b) => a.localeCompare(b));
        for (const cat of cats) {
          const rows = byCat.get(cat)!;
          y = drawTransactionTable(y, tone, cat, rows);
          y += 10;
        }
      }

      pageNo++;
    }
  }

  // ── Re-stamp footers now that we know total page count ────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    fillRect(0, pageH - 36, pageW, 36, [255, 255, 255]);
    drawFooter(p, total);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mtd_it_pnl_${safeFilename(ctx.clientName)}_${ctx.taxYearLabel.replace('/', '-')}_${ctx.quarterLabel}_${stamp}.pdf`;
  doc.save(filename);

  // ── Inner helpers (close over `doc`, `pageH`, palette etc.) ────────────
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

  function drawStreamSummaryTable(yIn: number, list: PnLForStream[]) {
    const headerH = 22, rowH = 22;
    fillRect(margin, yIn, contentW, headerH, COLOR.brand, 4);
    text('STREAM',  margin + 14,               yIn + 15, { bold: true, size: 8, color: [255, 255, 255] });
    text('INCOME',  margin + contentW * 0.45,  yIn + 15, { bold: true, size: 8, color: [255, 255, 255], align: 'right' });
    text('EXPENSE', margin + contentW * 0.7,   yIn + 15, { bold: true, size: 8, color: [255, 255, 255], align: 'right' });
    text('NET',     margin + contentW - 14,    yIn + 15, { bold: true, size: 8, color: [255, 255, 255], align: 'right' });
    let cy = yIn + headerH;
    list.forEach((s, i) => {
      if (i % 2 === 1) fillRect(margin, cy, contentW, rowH, COLOR.zebra);
      text(s.streamLabel, margin + 14, cy + 14, { size: 10 });
      text(fmtMoneyGbp(s.income.total),  margin + contentW * 0.45, cy + 14, { size: 10, align: 'right', color: COLOR.income });
      text(fmtMoneyGbp(s.expense.total), margin + contentW * 0.7,  cy + 14, { size: 10, align: 'right', color: COLOR.expense });
      const netColor = s.net >= 0 ? COLOR.income : COLOR.expense;
      text(fmtMoneyGbp(s.net), margin + contentW - 14, cy + 14, { bold: true, size: 10, align: 'right', color: netColor });
      cy += rowH;
    });
    strokeRect(margin, yIn, contentW, headerH + list.length * rowH, COLOR.rule, 4);
  }

  function drawIncomeExpenseChart(yIn: number, s: PnLForStream): number {
    const inc = s.income.total;
    const exp = s.expense.total;
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

  function drawCategoryTable(yIn: number, section: PnLSection, tone: 'income' | 'expense'): number {
    const accent = tone === 'income' ? COLOR.income : COLOR.expense;
    const soft   = tone === 'income' ? COLOR.incomeSoft : COLOR.expenseSoft;
    const headerH = 22, rowH = 18, totalH = 22;
    const rowsToDraw = section.lines.length > 0 ? section.lines : [{ category: '(no entries)', amount: 0 }];
    const tableH = headerH + rowsToDraw.length * rowH + totalH;
    yIn = ensureSpace(yIn, tableH + 16);

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

  function drawBucket(yIn: number, b: PnLBucket): number {
    yIn = ensureSpace(yIn, 110);
    const headerH = 26;
    fillRect(margin, yIn, contentW, headerH, COLOR.brandSoft, 4);
    text(clipToWidth(doc, b.label + (b.unallocated ? '  - UNALLOCATED' : ''), contentW * 0.55, 10), margin + 14, yIn + 12, { bold: true, size: 10, color: COLOR.brandInk });
    if (b.sublabel) {
      text(b.sublabel, margin + 14, yIn + 22, { size: 8, color: COLOR.textMuted });
    }
    const netColor = b.net >= 0 ? COLOR.income : COLOR.expense;
    text(`Income ${fmtMoneyGbp(b.income.total)}   Expense ${fmtMoneyGbp(b.expense.total)}`, pageW - margin - 14, yIn + 11, {
      size: 8, color: COLOR.textMuted, align: 'right',
    });
    text(`Net ${fmtMoneyGbp(b.net)}`, pageW - margin - 14, yIn + 22, { bold: true, size: 9, color: netColor, align: 'right' });
    yIn += headerH + 8;

    yIn = drawCategoryTable(yIn, b.income,  'income');
    yIn += 8;
    yIn = drawCategoryTable(yIn, b.expense, 'expense');
    yIn += 16;
    return yIn;
  }

  /** Renders one category as a date / description / amount table. */
  function drawTransactionTable(yIn: number, tone: 'income' | 'expense', category: string, rows: EditorEntry[]): number {
    const accent = tone === 'income' ? COLOR.income : COLOR.expense;
    const soft   = tone === 'income' ? COLOR.incomeSoft : COLOR.expenseSoft;
    const headerH = 22, rowH = 18, totalH = 22;
    const tableH = headerH + rows.length * rowH + totalH;
    yIn = ensureSpace(yIn, tableH + 16);

    // Column layout
    const dateW = 70;
    const amtW  = 80;
    const descX = margin + 14 + dateW;
    const descW = contentW - 14 - dateW - amtW - 14;
    const amtX  = pageW - margin - 14;

    // Header
    fillRect(margin, yIn, contentW, headerH, accent, 4);
    text(`${tone === 'income' ? 'INCOME' : 'EXPENSE'} - ${clipToWidth(doc, category, contentW - 200, 9).toUpperCase()}`, margin + 14, yIn + 15, {
      bold: true, size: 9, color: [255, 255, 255],
    });
    text(`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`, pageW - margin - 14, yIn + 15, {
      size: 8, color: [255, 255, 255], align: 'right',
    });
    let cy = yIn + headerH;

    // Column titles row (tiny eyebrow)
    let total = 0;
    rows.forEach((r, i) => {
      if (i % 2 === 1) fillRect(margin, cy, contentW, rowH, COLOR.zebra);
      const dateTxt = fmtDateUk(r.entry_date);
      const desc    = r.description || r.supplier || '(no description)';
      const amt     = gbpAmount(r);
      total += amt;
      text(dateTxt, margin + 14, cy + 12, { size: 8, color: COLOR.textMuted });
      const descText = clipToWidth(doc, desc, descW, 9);
      if (r.drive_link) {
        // Linkified description so reviewers can click straight to the
        // source invoice in Drive. textWithLink renders the text and
        // registers a clickable annotation on the same spot.
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(COLOR.brandInk[0], COLOR.brandInk[1], COLOR.brandInk[2]);
        doc.textWithLink(descText, descX, cy + 12, { url: r.drive_link });
      } else {
        text(descText, descX, cy + 12, { size: 9 });
      }
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

  /** Q1-Q4 comparison table — one row per non-empty quarter. */
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
}

/** GBP value for a single row, mirroring the rule used by buildPnL. */
function gbpAmount(e: EditorEntry): number {
  const gross = e.gross_amount || 0;
  if (e.currency === 'GBP') return gross;
  if (typeof e.gbp_amount === 'number') return e.gbp_amount;
  if (e.fx_rate && Number.isFinite(e.fx_rate)) return gross * e.fx_rate;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Excel — one sheet per stream (unchanged)
// ─────────────────────────────────────────────────────────────────────────
type AOA = (string | number | null)[][];

function sectionToRows(s: PnLSection): AOA {
  const rows: AOA = [[s.title.toUpperCase()]];
  for (const l of s.lines) rows.push([`  ${l.category}`, l.amount]);
  rows.push([`Total ${s.title}`, s.total]);
  rows.push([null]);
  return rows;
}

function bucketToRows(b: PnLBucket): AOA {
  const rows: AOA = [];
  rows.push([`${b.label}${b.sublabel ? `  (${b.sublabel})` : ''}${b.unallocated ? '  - UNALLOCATED' : ''}`]);
  rows.push(['  Income',   b.income.total]);
  rows.push(['  Expense',  b.expense.total]);
  rows.push(['  Net',      b.net]);
  rows.push([null]);
  rows.push(...sectionToRows(b.income));
  rows.push(...sectionToRows(b.expense));
  rows.push([null, null]);
  return rows;
}

export function exportPnLXlsx(streams: PnLForStream[], ctx: ExportContext): void {
  const wb = XLSX.utils.book_new();

  for (const s of streams) {
    const rows: AOA = [];
    rows.push(['MTD IT - P&L']);
    rows.push([`${ctx.clientName}${ctx.clientRef ? `  (${ctx.clientRef})` : ''}`]);
    rows.push([`${s.streamLabel}  -  ${ctx.quarterLabel} ${ctx.taxYearLabel}  -  ${fmtDateUk(ctx.rangeFrom)} to ${fmtDateUk(ctx.rangeTo)}`]);
    if (ctx.consolidated) rows.push(['Consolidated reporting: ON']);
    if (s.unconvertedCount > 0) rows.push([`Warning: ${s.unconvertedCount} row(s) had no FX rate and contribute 0 to GBP totals.`]);
    rows.push([null]);
    rows.push(...sectionToRows(s.income));
    rows.push(...sectionToRows(s.expense));
    rows.push(['NET (Income - Expense)', s.net]);
    rows.push([null]);
    if (s.breakdown.length > 0) {
      rows.push(['BREAKDOWN']);
      rows.push([null]);
      for (const b of s.breakdown) rows.push(...bucketToRows(b));
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 42 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, s.streamLabel.slice(0, 31));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mtd_it_pnl_${safeFilename(ctx.clientName)}_${ctx.taxYearLabel.replace('/', '-')}_${ctx.quarterLabel}_${stamp}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─────────────────────────────────────────────────────────────────────────
// Excel — line-by-line entries export (every income / expense / flagged row)
// ─────────────────────────────────────────────────────────────────────────

const ENTRY_STREAM_LABEL: Record<string, string> = {
  sole: 'Sole Trader', uk_rental: 'UK Rental', foreign_rental: 'Foreign Rental',
};
const ENTRY_STREAM_ORDER: Record<string, number> = { sole: 0, uk_rental: 1, foreign_rental: 2 };

/**
 * Export every entry in the quarter (across all streams) to a single-sheet
 * Excel workbook — one row per entry with all fields, including the property /
 * trade it's allocated to. Independent of the P&L export (which is totals-only).
 */
export function exportEntriesXlsx(
  entries: EditorEntry[],
  properties: MtdItProperty[],
  trades: MtdItTrade[],
  fxRates: Record<string, number>,
  ctx: Pick<ExportContext, 'clientName' | 'clientRef' | 'taxYearLabel' | 'quarterLabel' | 'rangeFrom' | 'rangeTo' | 'consolidated'>,
): void {
  const propById  = new Map(properties.map(p => [p.id, p.address]));
  const tradeById = new Map(trades.map(t => [t.id, t.name]));

  const toGbp = (e: EditorEntry): number => {
    const gross = e.gross_amount || 0;
    if (e.currency === 'GBP') return gross;
    if (typeof e.gbp_amount === 'number') return e.gbp_amount;
    const rate = e.fx_rate ?? fxRates[e.currency];
    return rate ? gross * rate : 0;
  };

  const allocatedTo = (e: EditorEntry): string => {
    if (e.stream === 'sole') return e.trade_id ? (tradeById.get(e.trade_id) ?? '') : '';
    return e.property_id ? (propById.get(e.property_id) ?? '') : '';
  };

  const rows = entries
    .filter(e => !e._deleted)
    .slice()
    .sort((a, b) =>
      (ENTRY_STREAM_ORDER[a.stream] ?? 9) - (ENTRY_STREAM_ORDER[b.stream] ?? 9)
      || (a.entry_date ?? '').localeCompare(b.entry_date ?? ''),
    );

  const aoa: AOA = [];
  aoa.push(['MTD IT - Entries export']);
  aoa.push([`${ctx.clientName}${ctx.clientRef ? `  (${ctx.clientRef})` : ''}`]);
  aoa.push([`${ctx.quarterLabel} ${ctx.taxYearLabel}  -  ${fmtDateUk(ctx.rangeFrom)} to ${fmtDateUk(ctx.rangeTo)}`]);
  if (ctx.consolidated) aoa.push(['Consolidated reporting: ON']);
  aoa.push([null]);
  aoa.push([
    'Stream', 'Allocated to', 'Date', 'Description', 'Supplier', 'Invoice No',
    'Category', 'Type', 'Gross', 'Net', 'VAT', 'Currency', 'FX rate', 'GBP',
    'Share %', 'Flagged', 'Flag reason', 'Source file', 'Page',
  ]);

  for (const e of rows) {
    const flagged = !!e.flagged_reason && !e.flag_dismissed;
    aoa.push([
      ENTRY_STREAM_LABEL[e.stream] ?? e.stream,
      allocatedTo(e),
      fmtDateUk(e.entry_date),
      e.description ?? '',
      e.supplier ?? '',
      e.invoice_number ?? '',
      e.category ?? '',
      e.entry_type === 'income' ? 'Income' : 'Expense',
      e.gross_amount ?? 0,
      e.net_amount ?? null,
      e.vat_amount ?? null,
      e.currency ?? '',
      e.fx_rate ?? (e.currency !== 'GBP' ? (fxRates[e.currency] ?? null) : null),
      Math.round(toGbp(e) * 100) / 100,
      e.share_pct ?? 100,
      flagged ? 'Yes' : '',
      flagged ? (e.flagged_reason ?? '') : '',
      e.source_file_name ?? '',
      e.page_number ?? null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 14 }, { wch: 28 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 14 },
    { wch: 24 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 9 },
    { wch: 9 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 32 }, { wch: 28 }, { wch: 6 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Entries');
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mtd_it_entries_${safeFilename(ctx.clientName)}_${ctx.taxYearLabel.replace('/', '-')}_${ctx.quarterLabel}_${stamp}.xlsx`;
  XLSX.writeFile(wb, filename);
}
