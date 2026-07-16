// Billing module — the statement document and the statement email.
//
// buildStatementHtml  → a self-contained A4 page, same letterhead/template/accent
//                       as the invoice (lib/billing/invoicePdf.ts), so a client's
//                       statement and invoices look like they came from one firm.
// buildStatementTable → the same rows as an email-safe table (inline styles, no
//                       flexbox) for the emailed statement.

import { fmtPence } from './totals';
import type { InvoiceLetterhead } from './invoicePdf';
import type { StatementData } from './statement';
import { escapeHtml } from './invoiceEmailHtml';

function ukDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}
function multiline(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br/>');
}
function resolveAccent(accent?: string | null): string {
  return /^#[0-9a-fA-F]{6}$/.test(accent ?? '') ? accent! : '#7C3AED';
}

/** Money for a statement column: negative reads as a credit, not "-£10". */
function money(pence: number): string {
  return pence < 0 ? `${fmtPence(Math.abs(pence))} CR` : fmtPence(pence);
}

// ── Shared rows ──────────────────────────────────────────────────────────────

interface TableOpts { compact?: boolean }

/** The statement's rows as an email-safe HTML table. */
export function buildStatementTable(data: StatementData, accentHex?: string | null, opts: TableOpts = {}): string {
  const accent = resolveAccent(accentHex);
  const pad = opts.compact ? '6px 8px' : '9px 10px';
  const th = `text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:0.06em;color:#6B7280;padding:0 10px 7px;border-bottom:2px solid ${accent}`;
  const td = `padding:${pad};border-bottom:1px solid #F1F1F7;font-size:12px;color:#374151`;
  const tdR = `${td};text-align:right;white-space:nowrap`;

  if (data.mode === 'outstanding') {
    const rows = data.lines.map(l => `
      <tr>
        <td style="${td}">${ukDate(l.date)}</td>
        <td style="${td};font-weight:600;color:#0F0F1A">${escapeHtml(l.ref)}</td>
        <td style="${td}">${ukDate(l.dueDate)}</td>
        <td style="${tdR}">${l.daysOverdue && l.daysOverdue > 0 ? `<span style="color:#DC2626;font-weight:600">${l.daysOverdue} days</span>` : '—'}</td>
        <td style="${tdR}">${money(l.debitPence)}</td>
        <td style="${tdR};font-weight:700;color:#0F0F1A">${money(l.balancePence ?? 0)}</td>
      </tr>`).join('');
    return `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${th}">Date</th><th style="${th}">Reference</th><th style="${th}">Due</th>
        <th style="${th};text-align:right">Overdue</th><th style="${th};text-align:right">Invoice</th><th style="${th};text-align:right">Outstanding</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" style="${td};text-align:center;color:#9CA3AF;padding:24px">Nothing outstanding — thank you.</td></tr>`}</tbody>
    </table>`;
  }

  // Activity: brought forward, then every movement, then the closing balance.
  const bf = data.broughtForwardPence ?? 0;
  const rows = data.lines.map(l => `
    <tr>
      <td style="${td}">${ukDate(l.date)}</td>
      <td style="${td};font-weight:600;color:#0F0F1A">${escapeHtml(l.ref)}</td>
      <td style="${td}">${escapeHtml(l.description)}</td>
      <td style="${tdR}">${l.debitPence ? money(l.debitPence) : ''}</td>
      <td style="${tdR};color:#059669">${l.creditPence ? money(l.creditPence) : ''}</td>
      <td style="${tdR};font-weight:600;color:#0F0F1A">${money(l.runningPence ?? 0)}</td>
    </tr>`).join('');

  return `
  <table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th style="${th}">Date</th><th style="${th}">Reference</th><th style="${th}">Detail</th>
      <th style="${th};text-align:right">Charges</th><th style="${th};text-align:right">Payments</th><th style="${th};text-align:right">Balance</th>
    </tr></thead>
    <tbody>
      <tr>
        <td style="${td}">${ukDate(data.periodFrom)}</td>
        <td style="${td};font-weight:600;color:#0F0F1A">—</td>
        <td style="${td};font-style:italic">Balance brought forward</td>
        <td style="${tdR}"></td><td style="${tdR}"></td>
        <td style="${tdR};font-weight:600;color:#0F0F1A">${money(bf)}</td>
      </tr>
      ${rows}
    </tbody>
  </table>`;
}

// ── A4 document (PDF) ────────────────────────────────────────────────────────

export function buildStatementHtml(data: StatementData, letterhead: InvoiceLetterhead): string {
  const from = letterhead.businessName.trim() || 'Your firm';
  const accent = resolveAccent(letterhead.accent);
  const template = letterhead.template ?? 'modern';
  const titleColor = template === 'minimal' ? '#0F0F1A' : accent;
  const topBar = template === 'classic' ? `<div style="height:6px;background:${accent};margin:-18mm -16mm 18px"></div>` : '';
  const logo = letterhead.logoDataUrl
    ? `<img src="${letterhead.logoDataUrl}" alt="" style="max-height:52px;max-width:220px;margin-bottom:8px;display:block" />`
    : '';

  const agedCell = (label: string, value: number) => `
    <td style="padding:8px 10px;text-align:center;border-right:1px solid #ECECF3">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.06em;color:#6B7280;font-weight:700">${label}</div>
      <div style="font-size:13px;font-weight:700;margin-top:2px;color:#0F0F1A">${fmtPence(value)}</div>
    </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Statement — ${escapeHtml(data.clientName)}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0F0F1A; padding: 18mm 16mm 14mm; font-size: 12px; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; }
  .from-name { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; }
  .from-meta { font-size: 11px; color: #6B7280; margin-top: 4px; }
  .doc { text-align: right; }
  .doc-title { font-size: 26px; font-weight: 800; letter-spacing: 0.02em; color: ${titleColor}; }
  .doc-meta { font-size: 11px; color: #6B7280; margin-top: 6px; }
  .doc-meta b { color: #0F0F1A; font-weight: 600; }
  .billto { margin-bottom: 18px; padding: 12px 14px; background: #FAFAFE; border: 1px solid #ECECF3; border-radius: 12px; }
  .billto-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-weight: 700; }
  .billto-name { font-size: 14px; font-weight: 700; margin-top: 2px; }
  tr { page-break-inside: avoid; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 10px; }
  .total-box { min-width: 260px; border-radius: 12px; background: ${accent}0f; border: 1px solid ${accent}33; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
  .total-lbl { font-size: 12px; font-weight: 700; color: #374151; }
  .total-val { font-size: 18px; font-weight: 800; color: ${titleColor}; }
  .aged { margin-top: 22px; border: 1px solid #ECECF3; border-radius: 12px; overflow: hidden; }
  .aged-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-weight: 700; padding: 8px 10px 0; }
  .pay-box { margin-top: 22px; border: 1px solid #ECECF3; border-radius: 12px; padding: 12px 14px; background: #FAFAFE; }
  .pay-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-weight: 700; margin-bottom: 4px; }
  .pay-body { font-size: 11.5px; color: #374151; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ECECF3; font-size: 10px; color: #9CA3AF; display: flex; justify-content: space-between; }
  @page { size: A4 portrait; margin: 0; }
</style>
</head>
<body>
  ${topBar}
  <div class="head">
    <div>
      ${logo}
      <div class="from-name">${escapeHtml(from)}</div>
      <div class="from-meta">
        ${letterhead.businessAddress.trim() ? multiline(letterhead.businessAddress) + '<br/>' : ''}
        ${letterhead.vatNumber.trim() ? 'VAT No: ' + escapeHtml(letterhead.vatNumber) : ''}
      </div>
    </div>
    <div class="doc">
      <div class="doc-title">STATEMENT</div>
      <div class="doc-meta">
        As at: <b>${ukDate(data.statementDate)}</b>
        ${data.mode === 'activity' ? `<br/>Period from: <b>${ukDate(data.periodFrom)}</b>` : ''}
      </div>
    </div>
  </div>

  <div class="billto">
    <div class="billto-lbl">Statement for</div>
    <div class="billto-name">${escapeHtml(data.clientName)}</div>
  </div>

  ${buildStatementTable(data, accent)}

  <div class="totals-wrap">
    <div class="total-box">
      <span class="total-lbl">${data.mode === 'activity' ? 'Balance outstanding' : 'Total outstanding'}</span>
      <span class="total-val">${money(data.closingPence)}</span>
    </div>
  </div>

  ${data.outstandingPence > 0 ? `
  <div class="aged">
    <div class="aged-lbl">Aged analysis</div>
    <table style="width:100%;border-collapse:collapse">
      <tr>
        ${agedCell('Current', data.aged.current)}
        ${agedCell('31–60 days', data.aged.d31_60)}
        ${agedCell('61–90 days', data.aged.d61_90)}
        ${agedCell('90+ days', data.aged.d90plus)}
      </tr>
    </table>
  </div>` : ''}

  ${letterhead.bankDetails.trim() ? `
  <div class="pay-box">
    <div class="pay-lbl">Payment details</div>
    <div class="pay-body">${multiline(letterhead.bankDetails)}</div>
  </div>` : ''}

  <div class="foot">
    <span>${letterhead.invoiceFooter.trim() ? escapeHtml(letterhead.invoiceFooter) : escapeHtml(from)}</span>
    <span>Statement as at ${ukDate(data.statementDate)}</span>
  </div>
</body>
</html>`;
}

// ── Email ────────────────────────────────────────────────────────────────────

export interface StatementEmailArgs {
  bodyText: string;
  data: StatementData;
  firmName: string;
  accent?: string | null;
  portalLink?: string | null;
  hasAttachment?: boolean;
  attachmentName?: string | null;
}

/** The statement email: the firm's message, the statement itself as a table,
 *  and the pay button. Self-contained, so it reads even without the PDF. */
export function buildStatementEmailHtml(args: StatementEmailArgs): string {
  const accent = resolveAccent(args.accent);
  const { data } = args;

  const attachNote = args.hasAttachment
    ? `<p style="font-size:12px;color:#6b7280;margin:0 0 16px">📎 Your statement is attached${args.attachmentName ? ` as ${escapeHtml(args.attachmentName)}` : ''}.</p>`
    : '';
  const button = args.portalLink
    ? `<p style="margin:18px 0 4px"><a href="${escapeHtml(args.portalLink)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px;font-size:14px">View &amp; pay invoice</a></p>`
    : '';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f0f1a;line-height:1.6;max-width:680px;margin:0 auto">
    <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(args.bodyText)}</p>
    ${attachNote}
    <div style="border:1px solid #ECECF3;border-radius:12px;padding:12px 14px;margin:0 0 8px">
      <div style="font-size:9.5px;text-transform:uppercase;letter-spacing:0.08em;color:#6B7280;font-weight:700;margin-bottom:8px">
        Statement as at ${ukDate(data.statementDate)}${data.mode === 'activity' ? ` — from ${ukDate(data.periodFrom)}` : ''}
      </div>
      ${buildStatementTable(data, accent, { compact: true })}
      <div style="text-align:right;margin-top:10px;padding-top:8px;border-top:2px solid #ECECF3">
        <span style="font-size:12px;color:#6B7280;font-weight:600">Balance outstanding&nbsp;&nbsp;</span>
        <span style="font-size:16px;font-weight:800;color:#0F0F1A">${money(data.closingPence)}</span>
      </div>
    </div>
    ${button}
    <p style="font-size:12px;color:#9ca3af;margin:24px 0 0">${escapeHtml(args.firmName)}</p>
  </div>`;
}
