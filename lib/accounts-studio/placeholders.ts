// Detects "needs user input" placeholders inside disclosure note HTML and
// highlights them, so information the user still has to enter (a figure, the
// principal activity, a confirmation) is obvious and never quietly missed.
//
// Two conventions are used across the seeded + AI-drafted notes:
//   • bracketed value placeholders — "[ ]", "£[ ]", "[describe the activity]"
//   • natural-language prompts      — "… please confirm" / "please confirm, or …"

const BRACKET_SRC = '(?:£\\s?)?\\[[^\\]]*\\]';
const CONFIRM_SRC = 'please confirm';

function toText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

/** True if the note still contains any unfilled placeholder / confirmation prompt. */
export function hasPlaceholders(html: string): boolean {
  if (!html) return false;
  const text = toText(html);
  return new RegExp(BRACKET_SRC).test(text) || new RegExp(CONFIRM_SRC, 'i').test(text);
}

/** How many placeholders / prompts a note still contains. */
export function countPlaceholders(html: string): number {
  if (!html) return 0;
  const text = toText(html);
  const brackets = text.match(new RegExp(BRACKET_SRC, 'g'))?.length ?? 0;
  const confirms = text.match(new RegExp(CONFIRM_SRC, 'gi'))?.length ?? 0;
  return brackets + confirms;
}

/**
 * Wrap every placeholder / prompt in `<mark class="as-ph">…</mark>` for a yellow
 * highlight. Operates on the HTML string — note HTML is simple (h3/p/strong/
 * ul/li) and these patterns never appear inside tags, so it's safe to replace
 * across the whole string.
 */
export function highlightPlaceholders(html: string): string {
  if (!html) return html;
  return html
    .replace(new RegExp(BRACKET_SRC, 'g'), m => `<mark class="as-ph">${m}</mark>`)
    .replace(new RegExp(CONFIRM_SRC, 'gi'), m => `<mark class="as-ph">${m}</mark>`);
}
