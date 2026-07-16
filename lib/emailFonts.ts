/**
 * Fonts for outgoing email.
 *
 * Shared by the compose window, the settings tab and the send/draft routes, so
 * there's one list rather than the drift that already exists across the Resend
 * templates in lib/email.ts.
 *
 * Every option is a web-safe stack. That constraint is not stylistic: email
 * clients don't load webfonts, so an unavailable family silently falls back on
 * the recipient's machine. Offering Inter or Plus Jakarta Sans here would show
 * the sender a font the recipient will never see — lib/email.ts:70 asks for
 * `Inter, Arial` today and, in practice, renders as Arial almost everywhere.
 */

export interface EmailFontOption {
  id: string;
  label: string;
  /** The CSS font-family value written inline into the sent message. */
  stack: string;
}

export const EMAIL_FONTS: EmailFontOption[] = [
  { id: 'arial',     label: 'Arial',           stack: 'Arial, Helvetica, sans-serif' },
  { id: 'helvetica', label: 'Helvetica',       stack: 'Helvetica, Arial, sans-serif' },
  { id: 'verdana',   label: 'Verdana',         stack: 'Verdana, Geneva, sans-serif' },
  { id: 'tahoma',    label: 'Tahoma',          stack: 'Tahoma, Verdana, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS',    stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { id: 'georgia',   label: 'Georgia',         stack: 'Georgia, "Times New Roman", serif' },
  { id: 'times',     label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { id: 'courier',   label: 'Courier New',     stack: '"Courier New", Courier, monospace' },
];

/**
 * Arial: what Gmail's web client already falls back to for our unstyled bodies
 * today, so firms that never touch the setting see no change in what they send.
 */
export const DEFAULT_EMAIL_FONT = 'arial';

export function emailFontStack(id: string | null | undefined): string {
  return EMAIL_FONTS.find(f => f.id === id)?.stack
    ?? EMAIL_FONTS.find(f => f.id === DEFAULT_EMAIL_FONT)!.stack;
}

export function isEmailFontId(id: string | null | undefined): boolean {
  return EMAIL_FONTS.some(f => f.id === id);
}

/** Marks our wrapper so it can be recognised and removed on the way back in. */
const MARKER = 'data-smith-font';

// Anchored to the whole string and greedy, so it only matches when our wrapper
// is the single outermost node — exactly what wrapBodyFont produces. Greedy
// means the trailing </div> binds to the last one, not to a nested child's.
const WRAP_RE = new RegExp(`^\\s*<div ${MARKER}="([a-z-]+)"[^>]*>([\\s\\S]*)</div>\\s*$`);

/**
 * Put the body in a font wrapper, replacing any wrapper already there.
 *
 * This has to be idempotent. The compose flow saves a draft AND sends, and
 * resuming a draft feeds the saved HTML back into the editor — so a blind wrap
 * would nest one more div on every save → resume → save cycle.
 */
export function wrapBodyFont(html: string, fontId: string): string {
  const { html: inner } = unwrapBodyFont(html);
  const id = isEmailFontId(fontId) ? fontId : DEFAULT_EMAIL_FONT;
  // Inline, because the message is sent as raw HTML with no stylesheet — a
  // class here would reach the recipient meaning nothing.
  return `<div ${MARKER}="${id}" style="font-family:${emailFontStack(id)}">${inner}</div>`;
}

/**
 * Take the body back out of its wrapper, reporting the font it was wrapped in.
 * Returning the id is what lets a resumed draft restore the sender's per-email
 * font choice without storing it anywhere else.
 */
export function unwrapBodyFont(html: string): { html: string; fontId: string | null } {
  const m = WRAP_RE.exec(html);
  if (!m) return { html, fontId: null };
  return { html: m[2], fontId: isEmailFontId(m[1]) ? m[1] : null };
}
