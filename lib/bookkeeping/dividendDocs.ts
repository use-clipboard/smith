// Dividend document generators — produce printable HTML for dividend vouchers
// (one per shareholder) and board meeting minutes. Rendered into an off-screen
// element and printed via reports/printReport (browser "Save as PDF").

export interface DividendCompany { name: string; ref?: string | null }
export interface DividendDoc {
  dividend_type: string;
  declaration_date: string;
  payment_date?: string | null;
  tax_year?: string | null;
  total_amount: number;
}
export interface DividendRecipient { name: string; shareholding_pct: number | null; amount: number }

const money = (n: number) => n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateUk = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const typeLabel = (t: string) => (t === 'final' ? 'Final' : 'Interim');

const STYLES = `
<style>
  .bk-doc { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12pt; line-height: 1.5; }
  .bk-doc h1 { font-size: 16pt; margin: 0 0 2px; }
  .bk-doc .ref { color: #555; font-size: 10pt; margin: 0 0 18px; }
  .bk-doc h2 { font-size: 13pt; margin: 18px 0 10px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  .bk-doc table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  .bk-doc td, .bk-doc th { padding: 4px 6px; text-align: left; vertical-align: top; }
  .bk-doc .kv td:first-child { color: #555; width: 38%; }
  .bk-doc .grid th { border-bottom: 1px solid #ccc; font-weight: 700; }
  .bk-doc .grid td { border-bottom: 1px solid #eee; }
  .bk-doc .num { text-align: right; }
  .bk-doc .note { color: #555; font-size: 10pt; margin-top: 14px; }
  .bk-doc .sig { margin-top: 40px; font-size: 11pt; }
  .voucher { padding: 4px 0; }
</style>`;

function header(company: DividendCompany): string {
  return `<h1>${esc(company.name)}</h1>${company.ref ? `<p class="ref">Company ref: ${esc(company.ref)}</p>` : '<div style="height:14px"></div>'}`;
}

export function vouchersHtml(company: DividendCompany, dividend: DividendDoc, recipients: DividendRecipient[]): string {
  const body = recipients.map((r, i) => `
    <div class="voucher" style="page-break-after:${i < recipients.length - 1 ? 'always' : 'auto'}">
      ${header(company)}
      <h2>Dividend Voucher</h2>
      <table class="kv">
        <tr><td>Date of declaration</td><td>${dateUk(dividend.declaration_date)}</td></tr>
        ${dividend.payment_date ? `<tr><td>Payment date</td><td>${dateUk(dividend.payment_date)}</td></tr>` : ''}
        ${dividend.tax_year ? `<tr><td>Tax year</td><td>${esc(dividend.tax_year)}</td></tr>` : ''}
        <tr><td>Shareholder</td><td>${esc(r.name)}</td></tr>
        ${r.shareholding_pct != null ? `<tr><td>Shareholding</td><td>${r.shareholding_pct}%</td></tr>` : ''}
        <tr><td>Dividend type</td><td>${typeLabel(dividend.dividend_type)}</td></tr>
        <tr><td>Dividend payable</td><td><strong>£${money(r.amount)}</strong></td></tr>
      </table>
      <p class="note">This dividend is paid out of the company's distributable profits and is paid without deduction of income tax.</p>
      <div class="sig">Signed ........................................&nbsp;&nbsp;Director / Secretary</div>
    </div>`).join('');
  return `${STYLES}<div class="bk-doc">${body}</div>`;
}

export function minutesHtml(
  company: DividendCompany, dividend: DividendDoc, recipients: DividendRecipient[], directors: string[],
): string {
  const present = directors.length > 0 ? directors.map(esc).join(', ') : '........................................';
  const rows = recipients.map(r => `
    <tr><td>${esc(r.name)}</td><td>${r.shareholding_pct != null ? `${r.shareholding_pct}%` : ''}</td><td class="num">£${money(r.amount)}</td></tr>`).join('');
  return `${STYLES}<div class="bk-doc">
    ${header(company)}
    <h2>Minutes of a meeting of the directors</h2>
    <p>Held on ${dateUk(dividend.declaration_date)}.</p>
    <p><strong>Present:</strong> ${present}</p>
    <p><strong>Declaration of dividend</strong></p>
    <p>It was resolved that the company pay ${dividend.dividend_type === 'final' ? 'a final' : 'an interim'} dividend
      of <strong>£${money(dividend.total_amount)}</strong>${dividend.tax_year ? ` in respect of the tax year ${esc(dividend.tax_year)}` : ''}${dividend.payment_date ? `, payable on ${dateUk(dividend.payment_date)}` : ''},
      distributed amongst the shareholders as follows:</p>
    <table class="grid">
      <thead><tr><th>Shareholder</th><th>Holding</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>The directors confirmed that the company had sufficient distributable reserves to make the distribution.</p>
    <p>There being no further business, the meeting was closed.</p>
    <div class="sig">Signed ........................................&nbsp;&nbsp;Chair of the meeting</div>
  </div>`;
}
