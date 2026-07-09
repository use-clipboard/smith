// Accounts Studio — HTML email for the client approval request. Self-contained
// (no dependency on the MTD IT templates), firm-branded, with a CTA button to
// the public approval page and an optional headline-figures summary table.

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export interface ApprovalEmailInput {
  firmName: string;
  companyName: string;
  periodEndUk: string;         // dd-mm-yyyy
  preparerName: string;
  coverNote?: string | null;
  approvalUrl: string;
  summary?: { label: string; value: string }[];
  brandHex?: string | null;
  logoDataUrl?: string | null;
}

export function buildApprovalEmailHtml(i: ApprovalEmailInput): string {
  const brand = i.brandHex || '#4F46E5';
  const summaryRows = (i.summary ?? []).map(r =>
    `<tr><td style="padding:4px 0;color:#475569">${esc(r.label)}</td><td style="padding:4px 0;text-align:right;font-weight:600;color:#0f172a">${esc(r.value)}</td></tr>`).join('');
  const cover = i.coverNote?.trim()
    ? `<p style="margin:0 0 16px;color:#334155;white-space:pre-wrap">${esc(i.coverNote.trim())}</p>` : '';

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:${brand};border-radius:14px 14px 0 0;padding:22px 28px;text-align:center">
      ${i.logoDataUrl ? `<img src="${i.logoDataUrl}" alt="" style="max-height:44px;max-width:200px;object-fit:contain" />` : `<div style="color:#fff;font-size:18px;font-weight:700">${esc(i.firmName)}</div>`}
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:28px">
      <h1 style="margin:0 0 6px;font-size:19px;color:#0f172a">Please review and approve your accounts</h1>
      <p style="margin:0 0 16px;color:#64748b;font-size:13px">${esc(i.companyName)} — financial statements for the year ended ${esc(i.periodEndUk)}</p>
      ${cover}
      <p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6">${esc(i.preparerName)} has prepared the statutory accounts for ${esc(i.companyName)} and would like your approval before they are submitted. The accounts are attached as a PDF. Please review them, then approve or request changes using the button below.</p>
      ${summaryRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 20px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">${summaryRows}</table>` : ''}
      <div style="text-align:center;margin:8px 0 20px">
        <a href="${esc(i.approvalUrl)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px">Review and approve</a>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:11.5px">If you didn't expect this email, please contact ${esc(i.preparerName)} at ${esc(i.firmName)}. This link expires in 30 days.</p>
    </div>
  </div></body></html>`;
}
