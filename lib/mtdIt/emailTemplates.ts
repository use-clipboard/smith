// MTD IT — email-template rendering helpers.
//
// The Settings → MTD IT tab lets firm admins customise approval email
// subjects + bodies. Templates use {{double-braced}} variables that this
// module renders. Unknown variables are left as-is (which makes
// previewing safer than throwing).
//
// The HTML wrapper is shared — it builds a clean inline-styled email
// (most email clients ignore <style> blocks and external CSS) with the
// firm name as the sender brand, a heading, a body block, and an
// optional CTA button. Cover note from the preparer is appended above
// the figures summary.

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Substitute {{handlebars}} variables in a template string. Unknown
 * variables are left untouched so previews surface the typo to the
 * preparer rather than silently swallowing it.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === null || value === undefined) return `{{${key}}}`;
    return String(value);
  });
}

/** All variables the renderer can substitute, for the in-app help block. */
export const TEMPLATE_VARIABLES: Array<{ key: string; description: string }> = [
  { key: 'client_name',     description: "The client's full name"                  },
  { key: 'client_code',     description: "The client reference (e.g. B610)"        },
  { key: 'quarter_label',   description: "e.g. Q1"                                  },
  { key: 'tax_year_label',  description: "e.g. 2026/27"                             },
  { key: 'period_from',     description: "Quarter start date in dd-mm-yyyy"         },
  { key: 'period_to',       description: "Quarter end date in dd-mm-yyyy"           },
  { key: 'firm_name',       description: "Your firm's name"                          },
  { key: 'preparer_name',   description: "The person who sent the approval"         },
  { key: 'approval_link',   description: "URL to the public approval page"          },
  { key: 'approved_at',     description: "When the client approved (dd-mm-yyyy hh:mm) — preparer emails only" },
  { key: 'responded_at',    description: "When the client requested changes — preparer emails only" },
  { key: 'changes_note',    description: "What the client said when requesting changes" },
];

// ── HTML email wrapper ──────────────────────────────────────────────────
// Wraps a body of HTML with table-based, inline-styled chrome that works
// in Gmail / Outlook / Apple Mail. The CTA is rendered as a Microsoft-
// friendly VML+anchor combo so the big purple button shows up everywhere.

export interface EmailHtmlOpts {
  firmName: string;
  subject: string;
  /** Plain-text body — converted to HTML paragraphs. Variables already
   *  rendered before calling this. */
  bodyText: string;
  /** Optional summary table rendered above the CTA, e.g. quarter totals. */
  summary?: Array<{ label: string; value: string }>;
  /** Big call-to-action button. Omit for plain emails (e.g. preparer notification). */
  cta?: { label: string; url: string };
  /** Tiny footer note. */
  footer?: string;
  /** Hex brand colour for the header band + CTA — falls back to default lavender. */
  brandHex?: string | null;
  /** Optional logo data URL embedded in the header band. */
  logoDataUrl?: string | null;
}

export function buildEmailHtml(opts: EmailHtmlOpts): string {
  const paragraphs = opts.bodyText
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;color:#1f2937;font-size:14px;line-height:1.55">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

  const summaryHtml = opts.summary && opts.summary.length > 0
    ? `<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:0 0 20px">
         ${opts.summary.map((s, i) => `
           <tr>
             <td style="padding:8px 12px;font-size:13px;color:#4b5563;${i > 0 ? 'border-top:1px solid #e5e7eb;' : ''}">${escapeHtml(s.label)}</td>
             <td style="padding:8px 12px;font-size:13px;color:#111827;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;${i > 0 ? 'border-top:1px solid #e5e7eb;' : ''}">${escapeHtml(s.value)}</td>
           </tr>
         `).join('')}
       </table>`
    : '';

  const brandHex = (opts.brandHex && /^#[0-9a-fA-F]{6}$/.test(opts.brandHex)) ? opts.brandHex : '#8B85CF';
  const ctaHtml = opts.cta
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px"><tr><td>
         <a href="${escapeAttr(opts.cta.url)}"
            style="display:inline-block;background:${brandHex};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px">
           ${escapeHtml(opts.cta.label)}
         </a>
       </td></tr></table>`
    : '';

  const logoHtml = opts.logoDataUrl
    ? `<img src="${escapeAttr(opts.logoDataUrl)}" alt="${escapeAttr(opts.firmName)}" style="display:block;max-height:36px;margin:0 0 10px 0">`
    : '';

  const footerHtml = opts.footer
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:11px;line-height:1.5">${escapeHtml(opts.footer)}</p>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:24px 16px"><tr><td align="center">
  <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
    <tr><td style="padding:20px 24px;background:${brandHex}">
      ${logoHtml}
      <div style="color:#fff;font-size:13px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;opacity:0.85">MTD IT</div>
      <div style="color:#fff;font-size:18px;font-weight:600;margin-top:2px">${escapeHtml(opts.firmName)}</div>
    </td></tr>
    <tr><td style="padding:24px">
      ${paragraphs}
      ${summaryHtml}
      ${ctaHtml}
      ${footerHtml}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string {
  return s.replace(/["<>]/g, c => ({ '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]!));
}

/** Format an ISO date string as dd-mm-yyyy for template variables. */
export function formatDateUkForTemplate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Format an ISO timestamp as dd-mm-yyyy hh:mm. */
export function formatDateTimeUkForTemplate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mm}-${yy} ${hh}:${mn}`;
  } catch {
    return iso;
  }
}
