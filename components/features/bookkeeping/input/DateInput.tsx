'use client';

/**
 * DateInput — the bookkeeping module's standard date entry control.
 *
 * Behaviour:
 *   - Always displays / accepts UK format: dd/mm/yyyy.
 *   - Auto-formats a raw 6- or 8-digit typed string:
 *       "101025"   → "10/10/2025"
 *       "11022024" → "11/02/2024"
 *     This fires onChange the moment the user types the 6th or 8th digit so
 *     the slashes appear without them needing to hit Tab.
 *   - A small calendar icon on the right opens the native OS picker (via
 *     showPicker() on a hidden type="date" input). Picking a date from the
 *     calendar writes the chosen day back to the visible text field in UK
 *     format.
 *   - The picker button is tabIndex=-1 so keyboard Tab order stays unbroken
 *     across the row.
 *
 * Helpers `toIso` / `fromIso` are exported so callers can convert between the
 * visible "dd/mm/yyyy" text and ISO "yyyy-mm-dd" for backends.
 */

import { Calendar } from 'lucide-react';
import { useRef } from 'react';

interface Props {
  /** Visible value in dd/mm/yyyy format (or partial while typing). */
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Pass-through attributes used by the input grids to locate cells. */
  'data-row-id'?: string;
  'data-cell'?: string;
  /** Optional aria label for screen readers. */
  ariaLabel?: string;
  /** Date in dd/mm/yyyy used to fill in the month/year when the user types
   *  just a day (e.g. "23") and Tabs out. Typical use is the previous row's
   *  date in an entry grid — so on a long sheet you only need to retype the
   *  day part of each row. Leave undefined for the first row of a grid. */
  previousDate?: string;
}

// ── Format helpers ──────────────────────────────────────────────────────────

/**
 * Validate that an ISO yyyy-mm-dd string represents a real calendar day —
 * i.e. month is 1–12 AND the day actually exists in that month/year. Uses
 * the JS Date constructor's normalisation: if you pass month=20, it rolls
 * forward and the readback won't match the input, so we reject it.
 */
export function isValidIso(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, ys, ms, ds] = m;
  const y = +ys, mo = +ms, d = +ds;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/** True if the dd/mm/yyyy text represents a real calendar day (or is empty). */
export function isValidUk(value: string): boolean {
  if (!value.trim()) return true; // empty is "not yet entered", not invalid
  const iso = toIso(value);
  return iso !== '' && isValidIso(iso);
}

/**
 * Auto-format date entry as the user types. Three modes:
 *
 *   1) Already in canonical dd/mm/yyyy form          → return as-is.
 *   2) Extension after a 6-digit format              → strip the auto-added
 *      "20" year prefix so further typing flows naturally into a 4-digit
 *      year. Example progression for an 8-digit-year entry:
 *         "010120"     → "01/01/2020"      (6-digit format kicks in)
 *         add "2"      → "01/01/20202"     (raw value after extra keystroke)
 *                     ┌→ strip "20" prefix from year, return "01/01/202"
 *         add "6"      → "01/01/2026"      (dd/mm/yyyy form, return as-is)
 *   3) Pure digits of length 6 (ddmmyy) or 8 (ddmmyyyy) → insert slashes
 *      and (for length 6) prefix the year with "20". If the formatted
 *      result isn't a real calendar day, leave the raw digits so the red
 *      ring flags the problem.
 */
export function maybeAutoFormat(raw: string): string {
  // 1) Canonical form — leave alone.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  // 2) Extension after 6-digit auto-format. We added a "20" prefix to the
  //    year; if the user has kept typing, strip it so the trailing digits
  //    become a growing 4-digit year instead of overflowing.
  const extend = raw.match(/^(\d{2})\/(\d{2})\/20(\d{2})(\d+)$/);
  if (extend) {
    const [, dd, mm, yy, extra] = extend;
    const yearDigits = `${yy}${extra}`;
    if (yearDigits.length >= 4) {
      // Overshoot — keep only the first 4 year digits.
      return `${dd}/${mm}/${yearDigits.slice(0, 4)}`;
    }
    return `${dd}/${mm}/${yearDigits}`;
  }

  // 3) Pure-digit auto-format.
  if (/^\d+$/.test(raw)) {
    if (raw.length === 6) {
      const formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/20${raw.slice(4, 6)}`;
      return isValidUk(formatted) ? formatted : raw;
    }
    if (raw.length === 8) {
      const formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}/${raw.slice(4, 8)}`;
      return isValidUk(formatted) ? formatted : raw;
    }
  }

  // 4) Anything else (partial typing, manual separators, …) — pass through.
  return raw;
}

/** Convert dd/mm/yyyy (or dd-mm-yyyy / d/m/yy) → yyyy-mm-dd. Returns '' if unparseable.
 *  Does NOT validate that the date exists — use isValidIso() for that. */
export function toIso(value: string): string {
  const s = value.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (!m) return '';
  const [, d, mo, y] = m;
  const yyyy = y.length === 2 ? `20${y}` : y;
  return `${yyyy}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Convert yyyy-mm-dd → dd/mm/yyyy. Returns '' if empty/invalid. */
export function fromIso(iso: string): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/** Shift a UK date (dd/mm/yyyy) by `days`. Handles month/year rollover via
 *  the JS Date constructor's normalisation. Returns dd/mm/yyyy or '' when
 *  the input couldn't be parsed. Used by the +/- keyboard shortcuts. */
function shiftUkDateBy(uk: string, days: number): string {
  const iso = toIso(uk);
  if (!iso) return '';
  const [ys, ms, ds] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(ys, ms - 1, ds));
  d.setUTCDate(d.getUTCDate() + days);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${dd}/${mm}/${yy}`;
}

/**
 * Strict UK parser used at post-time. Accepts:
 *   - "*"            → today (ISO)
 *   - dd/mm/yyyy (or with - separators / 2-digit year)
 *   - yyyy-mm-dd (passthrough)
 * Returns ISO yyyy-mm-dd ONLY if the resulting calendar day is real;
 * otherwise returns ''. So "20/20/2025" → '' (month doesn't exist),
 * "30/02/2025" → '' (Feb only has 28 days), etc.
 */
export function parseUkDateStrict(input: string): string {
  const s = input.trim();
  if (!s) return '';
  if (s === '*') return new Date().toISOString().slice(0, 10);
  const iso = toIso(s);
  if (!iso) return '';
  return isValidIso(iso) ? iso : '';
}

// ── Component ───────────────────────────────────────────────────────────────

export default function DateInput({
  value, onChange, placeholder = 'dd/mm/yyyy', className = '', disabled,
  'data-row-id': dataRowId, 'data-cell': dataCell, ariaLabel, previousDate,
}: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);

  function openCalendar() {
    const el = pickerRef.current;
    if (!el) return;
    // Modern browsers expose showPicker(); fall back to click() for older ones.
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch { /* not gesture-eligible, fall through */ }
    }
    el.focus();
    el.click();
  }

  /** Keyboard shortcuts:
   *    +     → bump day by +1 (today if field is blank)
   *    -     → bump day by −1 (today if field is blank)
   *    Tab   → if the field contains only a 1- or 2-digit day, complete it
   *            using previousDate's month/year (or today's as a fallback)
   *
   *  All three intercepted keys would otherwise be inserted/skipped by the
   *  browser; preventDefault keeps the visible text consistent with what
   *  onChange just received.
   */
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    // + / - day-shift. Plus is typed as Shift+= on UK/US layouts and "+" on
    // a numpad; both arrive as e.key === '+' so a single check covers it.
    if (e.key === '+' || e.key === '-') {
      e.preventDefault();
      const direction = e.key === '+' ? 1 : -1;
      // Empty / unparseable → start from today, then shift. So + on an empty
      // field gives "tomorrow", - gives "yesterday".
      const base = toIso(value) || new Date().toISOString().slice(0, 10);
      onChange(shiftUkDateBy(fromIso(base), direction));
      return;
    }

    // Tab on a 1- or 2-digit day-only value → complete via previousDate.
    if (e.key === 'Tab' && !e.shiftKey) {
      const dayOnly = /^(\d{1,2})$/.exec(value.trim());
      if (dayOnly) {
        const day = parseInt(dayOnly[1], 10);
        // Use previousDate when present and parseable; otherwise fall back
        // to today's month/year so the field still autocompletes sensibly
        // on the first row of a sheet.
        const referenceIso =
          (previousDate && toIso(previousDate)) ||
          new Date().toISOString().slice(0, 10);
        const [y, m] = referenceIso.split('-');
        const dd = String(day).padStart(2, '0');
        const candidate = `${dd}/${m}/${y}`;
        if (isValidUk(candidate)) {
          // Don't preventDefault — let Tab still move focus to the next
          // cell. We just update the value alongside.
          onChange(candidate);
        }
      }
    }
  }

  // Visual hint when the text in the box isn't a real calendar day. Empty is
  // treated as "not entered yet" — no red ring until the user actually types.
  const invalid = !isValidUk(value);
  const invalidRing = invalid ? 'ring-2 ring-rose-400 ring-inset' : '';

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => onChange(maybeAutoFormat(e.target.value))}
        onKeyDown={onKey}
        placeholder={placeholder}
        disabled={disabled}
        data-row-id={dataRowId}
        data-cell={dataCell}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        // Reserve room on the right for the calendar icon (pr-7).
        className={`w-full text-sm pr-7 ${className} ${invalidRing}`}
      />
      <button
        type="button"
        onClick={openCalendar}
        disabled={disabled}
        tabIndex={-1}
        aria-label="Pick from calendar"
        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
      >
        <Calendar size={13} />
      </button>
      {/* Hidden native date control — acts purely as the calendar UI source.
          Overlaying the visible input means the OS picker popup anchors at
          the correct spot. pointer-events-none keeps the visible text input
          interactive; we open the picker programmatically via showPicker(). */}
      <input
        ref={pickerRef}
        type="date"
        value={toIso(value)}
        onChange={e => onChange(fromIso(e.target.value))}
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 opacity-0 pointer-events-none"
      />
    </div>
  );
}
