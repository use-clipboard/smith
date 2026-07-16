// Billing module — the invoice email's HTML body.
//
// One builder, three callers: the real send (send-email route), the "send test
// to yourself" route, and the live preview in Settings → Billing → Emails. If
// the preview is going to claim it shows what the client receives, it has to be
// built from the same function the client's email is built from.

export interface InvoiceEmailArgs {
  /** The merge-resolved body the user typed. Plain text; newlines preserved. */
  bodyText: string;
  /** Statement-portal URL behind the "View & pay invoice" button. Omit to drop the button. */
  portalLink?: string | null;
  firmName: string;
  /** Firm brand colour for the button. Falls back to SMITH purple. */
  accent?: string | null;
  /** True when the invoice PDF rides along, so the body can say so. */
  hasAttachment?: boolean;
  attachmentName?: string | null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function buildInvoiceEmailHtml(args: InvoiceEmailArgs): string {
  const accent = /^#[0-9a-fA-F]{6}$/.test(args.accent ?? '') ? args.accent! : '#7C3AED';
  const esc = escapeHtml;

  const button = args.portalLink
    ? `<p style="margin:0 0 16px"><a href="${esc(args.portalLink)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">View &amp; pay invoice</a></p>`
    : '';

  const attachNote = args.hasAttachment
    ? `<p style="font-size:12px;color:#6b7280;margin:0 0 16px">📎 Your invoice is attached${args.attachmentName ? ` as ${esc(args.attachmentName)}` : ''}.</p>`
    : '';

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f0f1a;line-height:1.6">
    <p style="white-space:pre-wrap;margin:0 0 16px">${esc(args.bodyText)}</p>
    ${attachNote}
    ${button}
    <p style="font-size:12px;color:#9ca3af;margin:24px 0 0">${esc(args.firmName)}</p>
  </div>`;
}
