// Newsletter designer — compiles a block structure into email-safe HTML.
//
// Pure and dependency-free so the editor can compile live in the browser and the
// send path can treat the result as ordinary body HTML.
//
// Email clients are not browsers: no flexbox/grid, no external stylesheets, and
// Outlook needs tables. So we emit a single-column table at 600px with every
// style inlined — the boring, maximally-compatible shape.

import type { DesignBlock, NewsletterDesign } from '@/types/campaigns';

export const DEFAULT_BRAND_COLOR = '#7C3AED';

export function emptyDesign(): NewsletterDesign {
  return { kind: 'newsletter', brandColor: DEFAULT_BRAND_COLOR, logoUrl: '', blocks: [] };
}

export function blockId(): string {
  try { return crypto.randomUUID(); } catch { return `b_${Math.random().toString(36).slice(2)}`; }
}

function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Un-escape entities *inside* merge tags.
 *
 * Escaping is right for author text, but it mangles a tag's fallback:
 * `{{client.first_name | default: "there"}}` becomes `default: &quot;there&quot;`,
 * which the merge-tag regex in mergeFields.ts no longer matches — so the tag
 * would be sent to the client verbatim. Tags are a closed, safe syntax, so we
 * restore them after escaping.
 */
function restoreMergeTags(s: string): string {
  return s.replace(/\{\{[^{}]*\}\}/g, tag =>
    tag.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
}

/** Escape author text while keeping merge tags intact. */
function escapeText(s: string): string {
  return restoreMergeTags(escapeHtml(s));
}

/** Only allow http(s) targets — never javascript:. Merge tags pass through. */
function safeUrl(url: string): string {
  const u = (url ?? '').trim();
  if (!u) return '';
  if (u.startsWith('{{')) return u;                 // resolved at send time
  return /^https?:\/\//i.test(u) ? u : '';
}

/**
 * Light inline formatting for text blocks: escape everything, then allow
 * [label](url) links and **bold**. Keeps authors safe from broken markup while
 * still letting them link mid-sentence. Merge tags ({{…}}) are untouched.
 */
function inlineFormat(text: string, brandColor: string): string {
  let s = escapeText(text);
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\{\{)[^\s)]+)\)/g,
    (_m, label: string, url: string) => {
      const href = safeUrl(url);
      return href ? `<a href="${href}" style="color:${brandColor};text-decoration:underline;">${label}</a>` : label;
    });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function renderBlock(block: DesignBlock, brand: string): string {
  switch (block.type) {
    case 'heading':
      return `<tr><td style="padding:8px 24px 4px;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;font-weight:bold;color:#1d1d1f;">${inlineFormat(block.text, brand)}</td></tr>`;

    case 'text': {
      // Blank lines separate paragraphs; single newlines become <br>.
      const paras = (block.text ?? '').split(/\n{2,}/).filter(p => p.trim() !== '');
      const html = paras
        .map(p => `<p style="margin:0 0 12px;">${inlineFormat(p, brand).replace(/\n/g, '<br>')}</p>`)
        .join('');
      return `<tr><td style="padding:4px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#3a3a3c;">${html}</td></tr>`;
    }

    case 'image': {
      const src = safeUrl(block.src);
      if (!src) return '';
      const img = `<img src="${src}" alt="${escapeText(block.alt ?? '')}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border:0;border-radius:8px;" />`;
      const href = safeUrl(block.href ?? '');
      return `<tr><td style="padding:12px 24px;">${href ? `<a href="${href}">${img}</a>` : img}</td></tr>`;
    }

    case 'button': {
      const href = safeUrl(block.href);
      if (!href || !block.label?.trim()) return '';
      return `<tr><td style="padding:14px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:${brand};border-radius:8px;">`
        + `<a href="${href}" style="display:inline-block;padding:11px 22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeText(block.label)}</a>`
        + `</td></tr></table></td></tr>`;
    }

    case 'divider':
      return `<tr><td style="padding:12px 24px;"><div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr>`;

    case 'spacer':
      return `<tr><td style="height:${Math.max(4, Math.min(80, block.height || 16))}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;

    default:
      return '';
  }
}

/** Compile a design into the HTML that actually gets sent. */
export function compileDesign(design: NewsletterDesign): string {
  const brand = /^#[0-9a-f]{3,8}$/i.test(design.brandColor) ? design.brandColor : DEFAULT_BRAND_COLOR;
  const logo = safeUrl(design.logoUrl ?? '');

  const header = logo
    ? `<tr><td style="padding:24px 24px 8px;"><img src="${logo}" alt="" height="40" style="display:block;height:40px;width:auto;border:0;" /></td></tr>`
    : '';

  const body = (design.blocks ?? []).map(b => renderBlock(b, brand)).join('');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
${header}${body}
<tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr>
</table>`;
}

/** Read a stored design off a campaign's settings, if it has one. */
export function designFromSettings(settings: unknown): NewsletterDesign | null {
  const d = (settings as { design?: unknown } | null)?.design as NewsletterDesign | undefined;
  if (!d || d.kind !== 'newsletter' || !Array.isArray(d.blocks)) return null;
  return { ...emptyDesign(), ...d };
}
