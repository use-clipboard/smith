// Accounts Studio — HTML email for the client approval request. Firm-branded
// (colour + optional logo), with a CTA button to the public approval page, an
// optional headline-figures summary table, and an optional signature block. The
// body is rendered from the firm's editable template (plain text → paragraphs).

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export interface ApprovalEmailInput {
  firmName: string;
  /** Rendered template body (plain text — split into paragraphs). */
  bodyText: string;
  approvalUrl: string;
  summary?: { label: string; value: string }[];
  brandHex?: string | null;
  logoUrl?: string | null;
  /** Gmail signature HTML appended at the bottom (direct sends only). */
  signatureHtml?: string | null;
}

export function buildApprovalEmailHtml(i: ApprovalEmailInput): string {
  const brand = i.brandHex || '#4F46E5';
  const paras = i.bodyText.split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 14px;color:#334155;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(p)}</p>`).join('');
  const summaryRows = (i.summary ?? []).map(r =>
    `<tr><td style="padding:5px 0;color:#475569">${esc(r.label)}</td><td style="padding:5px 0;text-align:right;font-weight:600;color:#0f172a">${esc(r.value)}</td></tr>`).join('');
  const header = i.logoUrl
    ? `<img src="${esc(i.logoUrl)}" alt="${esc(i.firmName)}" style="max-height:44px;max-width:200px;object-fit:contain" />`
    : `<div style="color:#fff;font-size:18px;font-weight:700">${esc(i.firmName)}</div>`;

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:${brand};border-radius:14px 14px 0 0;padding:22px 28px;text-align:center">${header}</div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px">
      ${paras}
      ${summaryRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:4px 0 20px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${summaryRows}</table>` : ''}
      <div style="text-align:center;margin:8px 0 20px">
        <a href="${esc(i.approvalUrl)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">Review and approve</a>
      </div>
      ${i.signatureHtml ? `<div style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:14px;color:#475569;font-size:13px">${i.signatureHtml}</div>` : ''}
      <p style="margin:14px 0 0;color:#94a3b8;font-size:11.5px">This link expires in 30 days.</p>
    </div>
  </div></body></html>`;
}
