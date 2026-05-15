// MTD IT date-formatting helper.
//
// SMITH stores dates as ISO (YYYY-MM-DD) in Supabase but every user-facing
// surface should render dd-mm-yyyy (UK convention). Use this from any
// component that displays a date.

/**
 * Convert an ISO date string ("YYYY-MM-DD") to dd-mm-yyyy.
 * Accepts:
 *   - empty / null / undefined  → returns the placeholder (default "—")
 *   - already-formatted dd-mm-yyyy → passes through unchanged
 *   - any other format         → returns the input verbatim (best-effort, no throws)
 */
export function formatDateUk(value: string | null | undefined, placeholder = '—'): string {
  if (!value) return placeholder;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  return value;
}
