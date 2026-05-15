// PDF + Excel exports for the MTD IT P&L View modal.
//
// PDF — jsPDF with manually-placed text rows (no autotable plugin installed).
// Excel — SheetJS, one sheet per stream.
//
// Both pull from the PnLForStream structs built by buildPnL().

import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { fmtMoneyGbp, type PnLForStream, type PnLSection, type PnLBucket } from '@/lib/mtdIt/pnl';

export interface ExportContext {
  clientName: string;
  clientRef:  string | null;
  taxYearLabel: string;            // e.g. "2026/27"
  quarterLabel: string;            // e.g. "Q1"
  rangeFrom: string;               // ISO
  rangeTo:   string;               // ISO
  /** Whether consolidated reporting is on — affects only the heading note. */
  consolidated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────
function fmtDateUk(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function safeFilename(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
}

export function exportPnLPdf(streams: PnLForStream[], ctx: ExportContext): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;

  function checkPageBreak(linesNeeded = 1) {
    if (y + linesNeeded * 14 > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }
  function writeLine(text: string, opts: { bold?: boolean; size?: number; right?: number; color?: [number, number, number] } = {}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size ?? 10);
    if (opts.color) doc.setTextColor(...opts.color); else doc.setTextColor(20, 20, 20);
    if (opts.right !== undefined) {
      doc.text(text, opts.right, y, { align: 'right' });
    } else {
      doc.text(text, margin, y);
    }
  }
  function newRow(h = 14) { y += h; checkPageBreak(); }
  function hr() {
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
  }
  function pnlSection(s: PnLSection) {
    writeLine(s.title.toUpperCase(), { bold: true, size: 10 });
    newRow();
    if (s.lines.length === 0) {
      writeLine('(none)', { size: 9, color: [120, 120, 120] });
      newRow();
    } else {
      for (const line of s.lines) {
        writeLine(`  ${line.category}`, { size: 10 });
        writeLine(fmtMoneyGbp(line.amount), { size: 10, right: pageW - margin });
        newRow();
      }
    }
    hr();
    newRow(6);
    writeLine(`  Total ${s.title}`, { bold: true });
    writeLine(fmtMoneyGbp(s.total), { bold: true, right: pageW - margin });
    newRow(20);
  }
  function pnlBucket(b: PnLBucket) {
    writeLine(b.label + (b.sublabel ? `  (${b.sublabel})` : '') + (b.unallocated ? '  — UNALLOCATED' : ''), {
      bold: true, size: 11,
    });
    newRow();
    writeLine(`Income  ${fmtMoneyGbp(b.income.total)}    Expense  ${fmtMoneyGbp(b.expense.total)}    Net  ${fmtMoneyGbp(b.net)}`, { size: 9, color: [100, 100, 100] });
    newRow();
    pnlSection(b.income);
    pnlSection(b.expense);
    writeLine('Net', { bold: true });
    writeLine(fmtMoneyGbp(b.net), { bold: true, right: pageW - margin });
    newRow(20);
  }

  // Cover header (per stream we'll re-print on each new page)
  function writeHeader(stream: PnLForStream, isFirst: boolean) {
    if (!isFirst) doc.addPage();
    y = margin;
    writeLine('MTD IT — P&L', { bold: true, size: 14 });
    newRow(20);
    writeLine(`${ctx.clientName}${ctx.clientRef ? `  ·  ${ctx.clientRef}` : ''}`, { size: 11 });
    newRow();
    writeLine(`${stream.streamLabel}  ·  ${ctx.quarterLabel} ${ctx.taxYearLabel}  ·  ${fmtDateUk(ctx.rangeFrom)} → ${fmtDateUk(ctx.rangeTo)}`, { size: 10, color: [90, 90, 90] });
    newRow();
    if (ctx.consolidated) {
      writeLine('Consolidated reporting: ON', { size: 9, color: [120, 80, 0] });
      newRow();
    }
    if (stream.unconvertedCount > 0) {
      writeLine(`Warning: ${stream.unconvertedCount} row(s) had no FX rate and contribute 0 to the GBP totals.`, {
        size: 9, color: [180, 50, 50],
      });
      newRow();
    }
    hr();
    newRow(14);
  }

  streams.forEach((s, i) => {
    writeHeader(s, i === 0);
    pnlSection(s.income);
    pnlSection(s.expense);
    writeLine('NET (Income − Expense)', { bold: true, size: 11 });
    writeLine(fmtMoneyGbp(s.net), { bold: true, size: 11, right: pageW - margin });
    newRow(24);
    if (s.breakdown.length > 0) {
      writeLine('BREAKDOWN', { bold: true, size: 11 });
      newRow(16);
      for (const b of s.breakdown) pnlBucket(b);
    }
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mtd_it_pnl_${safeFilename(ctx.clientName)}_${ctx.taxYearLabel.replace('/', '-')}_${ctx.quarterLabel}_${stamp}.pdf`;
  doc.save(filename);
}

// ─────────────────────────────────────────────────────────────────────────
// Excel — one sheet per stream
// ─────────────────────────────────────────────────────────────────────────
type AOA = (string | number | null)[][];

function sectionToRows(s: PnLSection): AOA {
  const rows: AOA = [[s.title.toUpperCase()]];
  for (const l of s.lines) rows.push([`  ${l.category}`, l.amount]);
  rows.push([`Total ${s.title}`, s.total]);
  rows.push([null]); // blank
  return rows;
}

function bucketToRows(b: PnLBucket): AOA {
  const rows: AOA = [];
  rows.push([`${b.label}${b.sublabel ? `  (${b.sublabel})` : ''}${b.unallocated ? '  — UNALLOCATED' : ''}`]);
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
    rows.push(['MTD IT — P&L']);
    rows.push([`${ctx.clientName}${ctx.clientRef ? `  (${ctx.clientRef})` : ''}`]);
    rows.push([`${s.streamLabel}  ·  ${ctx.quarterLabel} ${ctx.taxYearLabel}  ·  ${fmtDateUk(ctx.rangeFrom)} → ${fmtDateUk(ctx.rangeTo)}`]);
    if (ctx.consolidated) rows.push(['Consolidated reporting: ON']);
    if (s.unconvertedCount > 0) rows.push([`Warning: ${s.unconvertedCount} row(s) had no FX rate and contribute 0 to GBP totals.`]);
    rows.push([null]);
    rows.push(...sectionToRows(s.income));
    rows.push(...sectionToRows(s.expense));
    rows.push(['NET (Income − Expense)', s.net]);
    rows.push([null]);
    if (s.breakdown.length > 0) {
      rows.push(['BREAKDOWN']);
      rows.push([null]);
      for (const b of s.breakdown) rows.push(...bucketToRows(b));
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // Best-effort column widths — first column wide, second narrower for amounts.
    ws['!cols'] = [{ wch: 42 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, s.streamLabel.slice(0, 31));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `mtd_it_pnl_${safeFilename(ctx.clientName)}_${ctx.taxYearLabel.replace('/', '-')}_${ctx.quarterLabel}_${stamp}.xlsx`;
  XLSX.writeFile(wb, filename);
}
