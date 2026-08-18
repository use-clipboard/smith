// XML building helpers for the legacy SA100 GovTalk submission.
//
// The SA100 return is an XML document validated against HMRC's year-specific
// SA100 schema, wrapped in an <IRenvelope> and a <GovTalkMessage> (see
// ./gateway.ts, Phase 2). These helpers keep the page builders declarative:
// each box is one `el(tag, value)` line, and empty values simply drop out (HMRC
// schemas omit absent boxes rather than sending zeros/blanks).
//
// ⚠ Element NAMES and structure are provisional until validated against the
// 2025/26 SA100 XSD (Phase 0). This is deliberate — the wire format is isolated
// in ./pages/* and ./sa100Return.ts so first-round TPVS corrections land in one
// place, exactly as lib/companiesHouse/gateway.ts was built.

/** Escape XML text / attribute content. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HMRC money rounding: income/gains are rounded DOWN to whole pounds… */
export function poundsDown(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  return Math.floor(n);
}

/** …expenses, allowances and tax deducted are rounded UP (to the taxpayer's benefit). */
export function poundsUp(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  return Math.ceil(n);
}

/** A pence-accurate amount (a few SA100 boxes — e.g. payments on account — carry pence). */
export function money2(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  return n.toFixed(2);
}

/**
 * One element. Returns '' when the value is empty/null/0 so callers can list
 * every possible box unconditionally and let the blanks fall away.
 * `attrs` renders as XML attributes.
 */
export function el(tag: string, value: string | number | null | undefined, attrs?: Record<string, string>): string {
  if (value == null || value === '' || (typeof value === 'number' && (value === 0 || !Number.isFinite(value)))) return '';
  const a = attrs ? ' ' + Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ') : '';
  return `<${tag}${a}>${esc(String(value))}</${tag}>`;
}

/**
 * A boolean "flag" box. Most SA100 schema booleans are represented as the string
 * "yes" (the box is simply omitted when false). ⚠ confirm per-box against the XSD
 * — a few use "true"/"1" or an empty presence element.
 */
export function flag(tag: string, on: boolean | null | undefined): string {
  return on ? `<${tag}>yes</${tag}>` : '';
}

/** A container element that renders only when it has non-empty children. */
export function group(tag: string, children: Array<string | null | undefined>, attrs?: Record<string, string>): string {
  const inner = children.filter(Boolean).join('');
  if (!inner) return '';
  const a = attrs ? ' ' + Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ') : '';
  return `<${tag}${a}>${inner}</${tag}>`;
}

/** Sum a list of `{ …: number }` items on one field (breakdowns → box totals). */
export function sumField<T>(items: T[] | undefined, pick: (t: T) => number | undefined | null): number {
  return (items ?? []).reduce((a, t) => a + (pick(t) || 0), 0);
}

/** HMRC wants dates as YYYY-MM-DD; pass through if already in that shape, else ''. */
export function isoDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
