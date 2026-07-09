// Billing module — invoice PDF export.
//
// Same approach as lib/timesheets/reportPdf.ts: compose a clean, fully
// self-contained A4 HTML document and open it in a popup for the browser's
// "Save as PDF". No external assets, no new dependency.

import { fmtPence } from './totals';
import type { Invoice } from './types';
import { STATUS_LABEL } from './statusLabels';

export interface InvoiceLetterhead {
  businessName: string;
  businessAddress: string;
  vatNumber: string;
  bankDetails: string;
  invoiceFooter: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
/** Free-text (address / bank details) → escaped HTML with line breaks. */
function multiline(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br/>');
}
function ukDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function exportInvoicePdf(invoice: Invoice, letterhead: InvoiceLetterhead): void {
  const from = letterhead.businessName.trim() || 'Your firm';
  const partlyPaid = invoice.amountPaidPence > 0 && invoice.balancePence > 0;

  const linesHtml = (invoice.lines ?? []).map(l => `
    <tr>
      <td class="desc">${escapeHtml(l.description || 'Item')}</td>
      <td class="num">${l.quantity}</td>
      <td class="num">${fmtPence(l.unitPricePence)}</td>
      <td class="num">${l.vatRate}%</td>
      <td class="num right">${fmtPence(l.netPence)}</td>
    </tr>`).join('');

  const totalsRows = `
    <tr><td class="tlabel">Subtotal</td><td class="tval">${fmtPence(invoice.subtotalPence)}</td></tr>
    <tr><td class="tlabel">VAT</td><td class="tval">${fmtPence(invoice.vatPence)}</td></tr>
    <tr class="grand"><td class="tlabel">Total</td><td class="tval">${fmtPence(invoice.totalPence)}</td></tr>
    ${partlyPaid ? `
      <tr><td class="tlabel">Paid</td><td class="tval">−${fmtPence(invoice.amountPaidPence)}</td></tr>
      <tr class="grand"><td class="tlabel">Balance due</td><td class="tval">${fmtPence(invoice.balancePence)}</td></tr>` : ''}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.number ?? 'Invoice')}</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0F0F1A; padding: 18mm 16mm 14mm; font-size: 12px; line-height: 1.5; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px; }
  .from-name { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; }
  .from-meta { font-size: 11px; color: #6B7280; margin-top: 4px; }
  .doc { text-align: right; }
  .doc-title { font-size: 26px; font-weight: 800; letter-spacing: 0.02em; color: #7C3AED; }
  .doc-num { font-size: 13px; font-weight: 700; margin-top: 2px; }
  .doc-meta { font-size: 11px; color: #6B7280; margin-top: 6px; }
  .doc-meta b { color: #0F0F1A; font-weight: 600; }
  .status { display: inline-block; margin-top: 6px; padding: 2px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; background: #F3E8FF; color: #7C3AED; }
  .billto { margin-bottom: 18px; padding: 12px 14px; background: #FAFAFE; border: 1px solid #ECECF3; border-radius: 12px; }
  .billto-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-weight: 700; }
  .billto-name { font-size: 14px; font-weight: 700; margin-top: 2px; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  table.lines thead th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7280; padding: 0 10px 7px; border-bottom: 2px solid #7C3AED; }
  table.lines tbody td { padding: 9px 10px; border-bottom: 1px solid #F1F1F7; vertical-align: top; }
  table.lines tr { page-break-inside: avoid; }
  td.desc { font-weight: 600; }
  td.num { text-align: right; white-space: nowrap; color: #374151; }
  td.num.right { font-weight: 700; color: #0F0F1A; }
  th.num { text-align: right; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-top: 8px; }
  table.totals { min-width: 240px; border-collapse: collapse; }
  table.totals td { padding: 5px 10px; font-size: 12px; }
  table.totals td.tlabel { color: #6B7280; }
  table.totals td.tval { text-align: right; font-weight: 600; white-space: nowrap; }
  table.totals tr.grand td { font-size: 14px; font-weight: 800; color: #0F0F1A; border-top: 2px solid #ECECF3; padding-top: 8px; }
  .pay { margin-top: 26px; display: flex; gap: 20px; }
  .pay-box { flex: 1; border: 1px solid #ECECF3; border-radius: 12px; padding: 12px 14px; background: #FAFAFE; }
  .pay-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; font-weight: 700; margin-bottom: 4px; }
  .pay-body { font-size: 11.5px; color: #374151; }
  .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ECECF3; font-size: 10px; color: #9CA3AF; display: flex; justify-content: space-between; }
  @page { size: A4 portrait; margin: 0; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="from-name">${escapeHtml(from)}</div>
      <div class="from-meta">
        ${letterhead.businessAddress.trim() ? multiline(letterhead.businessAddress) + '<br/>' : ''}
        ${letterhead.vatNumber.trim() ? 'VAT No: ' + escapeHtml(letterhead.vatNumber) : ''}
      </div>
    </div>
    <div class="doc">
      <div class="doc-title">INVOICE</div>
      <div class="doc-num">${escapeHtml(invoice.number ?? 'DRAFT')}</div>
      <div class="doc-meta">
        Issued: <b>${ukDate(invoice.issueDate)}</b><br/>
        Due: <b>${ukDate(invoice.dueDate)}</b>
      </div>
      <div class="status">${escapeHtml(STATUS_LABEL[invoice.status] ?? invoice.status)}</div>
    </div>
  </div>

  <div class="billto">
    <div class="billto-lbl">Bill to</div>
    <div class="billto-name">${escapeHtml(invoice.clientName ?? '—')}</div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">VAT</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${linesHtml || '<tr><td colspan="5" style="text-align:center;color:#9CA3AF;padding:24px">No lines.</td></tr>'}</tbody>
  </table>

  <div class="totals-wrap"><table class="totals">${totalsRows}</table></div>

  ${(letterhead.bankDetails.trim() || invoice.notes || invoice.terms) ? `
  <div class="pay">
    ${letterhead.bankDetails.trim() ? `<div class="pay-box"><div class="pay-lbl">Payment details</div><div class="pay-body">${multiline(letterhead.bankDetails)}</div></div>` : ''}
    ${(invoice.notes || invoice.terms) ? `<div class="pay-box"><div class="pay-lbl">Notes</div><div class="pay-body">${multiline(invoice.notes ?? invoice.terms ?? '')}</div></div>` : ''}
  </div>` : ''}

  <div class="foot">
    <span>${letterhead.invoiceFooter.trim() ? escapeHtml(letterhead.invoiceFooter) : escapeHtml(from)}</span>
    <span>${escapeHtml(invoice.number ?? '')}</span>
  </div>
</body>
</html>`;

  const popup = window.open('', '_blank', 'width=900,height=1100');
  if (!popup) { window.print(); return; }
  popup.document.write(html);
  popup.document.close();

  const fire = () => {
    popup.focus();
    popup.print();
    setTimeout(() => { try { popup.close(); } catch { /* user closed it */ } }, 500);
  };
  if (popup.document.readyState === 'complete') setTimeout(fire, 120);
  else popup.addEventListener('load', fire);
}
