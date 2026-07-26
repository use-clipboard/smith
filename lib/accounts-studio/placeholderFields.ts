// Accounts Studio — fill-in-the-blanks for disclosure notes.
//
// Disclosure wording is seeded/AI-drafted with placeholders the accountant must
// complete:
//   • value blanks   — "[ ]", "£[ ]", "[describe the activity]"
//   • confirmations  — "… — please confirm[, or …]"
//
// Rather than have the user edit the paragraph text, we parse the note into a
// small set of fields (an input per blank, a checkbox per confirmation) and
// regenerate the note HTML from their answers — so the filed accounts never
// contain a stray "[ ]".
//
// The parse runs against a stable TEMPLATE (the wording with the blanks still
// in), stored on the section as `phTemplate`; the answers live in `phValues`.

// One combined matcher, in document order:
//   group 1 (£?) present → a value blank;   otherwise → a confirmation phrase.
// The confirmation alternative greedily eats the whole "— please confirm, or …"
// tail (up to the sentence's full stop) so confirming removes it cleanly.
const TOKEN_SRC = '(£\\s?)?\\[[^\\]]*\\]|(?:\\s*[—-]\\s*)?please confirm(?:,[^.]*)?';

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Last ~sentence of some preceding text (for the field's context line). */
function tailContext(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const afterStop = t.split(/(?<=[.:;])\s+/).pop() ?? t;
  return afterStop.slice(-90).trim();
}
/** First ~sentence of some following text. */
function headContext(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const upToStop = /^[^.]*\.?/.exec(t)?.[0] ?? '';
  return upToStop.slice(0, 90).trim();
}

export interface PlaceholderField {
  id: string;                    // p0, p1 … (position order)
  kind: 'value' | 'confirm';
  pound: boolean;                // the blank was "£[ ]"
  hint: string;                  // inner bracket hint, e.g. "describe the activity" ('' for a bare blank)
  before: string;                // plain-text context just before the blank
  after: string;                 // plain-text context just after the blank
}

/**
 * Some legacy/AI wording says "… is set out below — please confirm" where the
 * user actually needs to ENTER a value (the principal activity, the directors),
 * not tick a yes/no box. Rewrite those into a value blank so they render as an
 * input. Genuine confirmations ("… — please confirm[, or set out the details]"
 * with no "set out below") are left untouched. Idempotent.
 */
export function normalizeLegacyTemplate(html: string): string {
  if (!html) return html;
  return html
    .replace(/\b(is|are|was|were)\s+set out below\s*[—-]\s*please confirm/gi,
      (_m, verb: string) => `${/are|were/i.test(verb) ? 'were' : 'was'} [ ]`)
    .replace(/\bset out below\s*[—-]\s*please confirm/gi, '[ ]');
}

/** True if the note wording still has any blank / confirmation to complete. */
export function templateHasFields(template: string): boolean {
  return new RegExp(TOKEN_SRC, 'i').test(template);
}

/** Parse a template into its ordered fields. */
export function parsePlaceholderFields(template: string): PlaceholderField[] {
  if (!template) return [];
  const re = new RegExp(TOKEN_SRC, 'gi');
  const fields: PlaceholderField[] = [];
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(template)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const isConfirm = /please confirm/i.test(m[0]);
    const inner = isConfirm ? '' : /\[([^\]]*)\]/.exec(m[0])?.[1]?.trim() ?? '';
    fields.push({
      id: `p${k}`,
      kind: isConfirm ? 'confirm' : 'value',
      pound: !isConfirm && !!m[1],
      hint: /[a-z]/i.test(inner) ? inner : '',
      before: tailContext(stripTags(template.slice(0, m.index))),
      after: headContext(stripTags(template.slice(m.index + m[0].length))),
    });
    k++;
  }
  return fields;
}

/** Regenerate note HTML from the template + the user's answers. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  if (!template) return template;
  const re = new RegExp(TOKEN_SRC, 'gi');
  let k = 0;
  return template.replace(re, (match, pound) => {
    const id = `p${k}`;
    k++;
    if (/please confirm/i.test(match)) {
      // Confirmed → drop the whole "— please confirm…" tail; otherwise keep it.
      return values[id] === 'yes' ? '' : match;
    }
    const v = (values[id] ?? '').trim();
    if (!v) return match; // leave the blank in place until answered
    if (pound) return v.startsWith('£') ? v : `£${v}`;
    return v;
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recover last year's answers by aligning a prior (filled) note against this
 * year's template: the wording between blanks is the same year to year, so a
 * regex built from the template with the blanks as capture groups pulls each
 * value back out. Best-effort — returns {} if the wording has diverged. Used as
 * a fallback for prior engagements that predate stored `phValues`.
 */
export function extractPriorValues(template: string, priorHtml: string): Record<string, string> {
  if (!template || !priorHtml) return {};
  const re = new RegExp(TOKEN_SRC, 'gi');
  let pattern = '';
  let last = 0;
  const confirms: boolean[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    pattern += escapeRegExp(template.slice(last, m.index));
    const isConfirm = /please confirm/i.test(m[0]);
    pattern += isConfirm ? `(${escapeRegExp(m[0])})?` : '([\\s\\S]*?)';
    confirms.push(isConfirm);
    last = m.index + m[0].length;
  }
  pattern += escapeRegExp(template.slice(last));
  let rx: RegExp;
  try { rx = new RegExp(`^${pattern}$`, 'i'); } catch { return {}; }
  const mm = rx.exec(priorHtml);
  if (!mm) return {};
  const values: Record<string, string> = {};
  confirms.forEach((isConfirm, i) => {
    const g = mm[i + 1];
    if (isConfirm) {
      values[`p${i}`] = g ? '' : 'yes'; // phrase gone in prior → it was confirmed
    } else {
      const v = (g ?? '').replace(/^£\s?/, '').trim();
      if (v) values[`p${i}`] = v;
    }
  });
  return values;
}

/** How many fields are still unanswered (drives the "N to complete" count). */
export function unansweredCount(template: string, values: Record<string, string>): number {
  return parsePlaceholderFields(template).filter(f =>
    f.kind === 'confirm' ? values[f.id] !== 'yes' : !(values[f.id] ?? '').trim(),
  ).length;
}
