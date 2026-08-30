/**
 * Strip internal account ids out of an AI reply's prose.
 *
 * Every bookkeeping AI surface hands Claude the chart of accounts as
 * `- [<uuid>] Ledger: Name (type)` so it can name real accounts in tool calls.
 * The model then sometimes carries the id through into its answer —
 * "Advertising and PR [a751d806-2b4e-4e78-a3ec-1aec633a1ead]" — which is
 * meaningless to an accountant and makes the reply look broken.
 *
 * The system prompts tell it not to, but a prompt is a request, not a
 * guarantee, so this is the belt to that pair of braces.
 *
 * Fenced code blocks are left completely alone: the adviser renders
 * ```journal blocks as double-entry panels by parsing them as JSON, and
 * rewriting anything inside a fence risks corrupting that.
 */

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// A uuid on its own, or wrapped in brackets/parens, plus any space in front of
// it — so "PR [uuid]" collapses to "PR" rather than "PR ".
const ID_IN_PROSE = new RegExp(`[ \\t]*[\\[(]\\s*${UUID}\\s*[\\])]|[ \\t]*\\b${UUID}\\b`, 'g');

/** Remove account ids from prose, leaving fenced code blocks untouched. */
export function stripAccountIds(text: string): string {
  if (!text) return text;
  // Split on fences, keeping them: even indexes are prose, odd are fences.
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(ID_IN_PROSE, '')))
    .join('');
}
