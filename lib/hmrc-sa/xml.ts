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
 * A boolean "flag" box for the schema's MTR_YesType (enumeration: "yes" only).
 * The box is present with value "yes" when on, and omitted entirely when off.
 */
export function flag(tag: string, on: boolean | null | undefined): string {
  return on ? `<${tag}>yes</${tag}>` : '';
}

/**
 * A MTR_YesNoType box (enumeration: "yes" | "no"). Unlike flag(), this always
 * renders (yes or no) when a definite boolean is given — used for the schema's
 * required yes/no elements (e.g. CompanyDirector). Omitted only when null.
 */
export function yesno(tag: string, on: boolean | null | undefined): string {
  return on == null ? '' : `<${tag}>${on ? 'yes' : 'no'}</${tag}>`;
}

// HMRC's monetary XSD type (MTR_IRdecimalType) requires an EXACT 2-decimal-place
// value — "1234.00", never "1234". SA100 boxes still carry whole pounds (income
// rounded down, expenses/tax rounded up), so we round to the whole pound first,
// then format to 2dp. A rounded value of 0 drops out (the schema omits empty/zero
// boxes, and several types are explicitly non-zero).

/** Whole-pound-DOWN money, formatted to the schema's 2dp string. Null when 0/empty. */
export function moneyDown(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v === 0 ? null : v.toFixed(2);
}

/** Whole-pound-UP money, formatted to the schema's 2dp string. Null when 0/empty. */
export function moneyUp(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.ceil(n);
  return v === 0 ? null : v.toFixed(2);
}

/**
 * Sanitise + length-cap a string to the schema's text type. Every SA string
 * element derives from MTR_SAstringType, whose pattern only permits
 * `[A-Za-z0-9 &'()*,-./@£]`. Real free text (notes, descriptions) routinely
 * contains other characters (`;`, `%`, `:`, `<`, newlines…), which the schema
 * rejects outright — even when XML-escaped — so we replace any disallowed
 * character with a space, collapse the whitespace, then trim to `max`.
 */
export function clip(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  const cleaned = String(s)
    .replace(/[^0-9A-Za-z &'()*,.@£\/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/** Keep only the characters allowed by a pattern class, then cap length. */
export function digitsOnly(s: string | null | undefined, len?: number): string | null {
  if (s == null) return null;
  const d = String(s).replace(/[^0-9]/g, '');
  if (!d) return null;
  return len ? (d.length === len ? d : null) : d;
}

/** A telephone number restricted to the schema's [0-9 ] pattern (max 20). */
export function telephone(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).replace(/[^0-9 ]/g, '').trim().slice(0, 20);
  return t ? t : null;
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
