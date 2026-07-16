'use client';

/**
 * Paste sanitiser for the compose body.
 *
 * Pasting from Word, Outlook or a web page hands the browser a wall of foreign
 * markup — MsoNormal classes, hard-coded 11pt Calibri, white text that was only
 * legible against the source page's dark background, absolute widths. Dropped
 * straight into the editor it survives all the way into the sent email, where it
 * looks broken and the user has no toolbar control to fix it with.
 *
 * So we keep what the user means (emphasis, lists, links, tables, structure) and
 * drop how the source happened to look (fonts, sizes, colours, spacing). Pasted
 * text then inherits the email's own styling, and the toolbar/format painter can
 * restyle it from there.
 */

/**
 * Tags worth preserving. Tables earn their place: pasting a figures table out of
 * Excel or Xero is routine here, and flattening it to text would be a downgrade.
 */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV',
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP',
  'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'CODE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION',
  'A', 'IMG', 'HR',
]);

/** The only attributes allowed through, per tag. Everything else is dropped. */
const ALLOWED_ATTRS: Record<string, string[]> = {
  A: ['href'],
  IMG: ['src', 'alt'],
  // Merged cells are structural, not cosmetic — losing them corrupts the table.
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
};

/** Subtrees with no business in an email body, removed content and all. */
const DROP_ENTIRELY = 'script,style,meta,link,title,noscript,iframe,object,embed,form,input,button,svg';

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;
const SAFE_SRC  = /^(https?:|data:image\/)/i;

/**
 * Table styling, re-applied inline after the source's own is stripped.
 *
 * It has to be inline rather than editor CSS: the body is sent as the editor's
 * raw innerHTML, so a stylesheet in the app never reaches the recipient — and an
 * HTML table with no borders renders as run-together columns. These are the one
 * exception to "drop the styling"; without them a pasted table is unreadable in
 * the sent email. Kept to literal values (not CSS variables) for the same
 * reason, and neutral enough to sit on white or a client's dark mode.
 */
const TABLE_STYLES: Record<string, string> = {
  TABLE: 'border-collapse:collapse;margin:8px 0',
  TD:    'border:1px solid #d1d5db;padding:4px 8px',
  TH:    'border:1px solid #d1d5db;padding:4px 8px;text-align:left;font-weight:600',
};

/** Replace an element with its children — removes the tag, keeps the text. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

export function sanitisePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return '';

  body.querySelectorAll(DROP_ENTIRELY).forEach(n => n.remove());

  // Word smuggles its markup through in conditional comments.
  const comments = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT);
  const stale: Node[] = [];
  let c = comments.nextNode();
  while (c) { stale.push(c); c = comments.nextNode(); }
  stale.forEach(n => n.parentNode?.removeChild(n));

  // Snapshot before mutating: unwrapping moves children up, but they're already
  // in this list, so they still get visited.
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const tag = el.tagName.toUpperCase();

    if (!ALLOWED_TAGS.has(tag)) { unwrap(el); continue; }

    const keep = ALLOWED_ATTRS[tag] ?? [];
    for (const attr of Array.from(el.attributes)) {
      if (!keep.includes(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }

    // A link to javascript: or an unknown scheme is worth more than a styling
    // annoyance — unwrap it to plain text rather than pass it on.
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (!SAFE_HREF.test(href)) { el.removeAttribute('href'); unwrap(el); }
    }
    if (tag === 'IMG') {
      const src = el.getAttribute('src') ?? '';
      if (!SAFE_SRC.test(src)) el.remove();
    }

    if (TABLE_STYLES[tag]) el.setAttribute('style', TABLE_STYLES[tag]);
  }

  return body.innerHTML;
}

/** Escape text so it can't be read as markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text → paragraphs, preserving the user's line structure. */
export function plainTextToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .filter(b => b.trim().length > 0)
    .map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}
