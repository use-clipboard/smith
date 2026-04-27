/**
 * Lightweight pub/sub for calendar mutations.
 * Dispatch `CALENDAR_CHANGED` on `window` after any create / update / delete
 * so subscribers (e.g. the sidebar badge) can re-fetch without prop-drilling.
 */
export const CALENDAR_CHANGED = 'smith:calendar-changed';

export function dispatchCalendarChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CALENDAR_CHANGED));
  }
}
