// Formatting helpers for the Timesheets module.
// UK conventions throughout: dd-mm-yyyy dates, GBP, "2h 15m" durations.

import type { TimerState } from './types';

/** Live elapsed milliseconds for a timer, given the current epoch ms. */
export function timerElapsedMs(t: TimerState, now: number): number {
  return t.accumulatedMs + (t.running && !t.paused && t.segmentStartedAt ? now - t.segmentStartedAt : 0);
}

/** Minutes → "H:MM" (e.g. 150 → "2:30", 45 → "0:45", 120 → "2:00").
 *
 * All logged time in Timesheets is shown as hours:minutes, never decimals —
 * "2.5h" / "2.7h" confused users (is 2.5h = 2h30m or 2h50m?). One unambiguous
 * clock-style format everywhere. Rounds to the nearest minute. */
function hoursMins(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Duration as "H:MM" — "2:15", "0:45", "3:00". */
export function fmtDuration(minutes: number): string {
  return hoursMins(minutes);
}

/** Hours as "H:MM" — replaces the old decimal ("6.5h") display. Same format as
 *  fmtDuration; kept as a separate name for its call sites (stats / chart axes). */
export function fmtHours(minutes: number): string {
  return hoursMins(minutes);
}

/** Live timer readout "01:24:37" from milliseconds. */
export function fmtStopwatch(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Pence → "£1,240" (no decimals) or "£1,240.50" when `pennies` requested. */
export function fmtGBP(pence: number, pennies = false): string {
  const value = pence / 100;
  return value.toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: pennies ? 2 : 0,
    maximumFractionDigits: pennies ? 2 : 0,
  });
}

/** Compact money for KPI tiles — "£1.2k", "£24.8k", "£420". */
export function fmtGBPCompact(pence: number): string {
  const value = pence / 100;
  if (Math.abs(value) >= 1000) {
    return `£${(value / 1000).toFixed(1)}k`;
  }
  return `£${Math.round(value)}`;
}

/** 0.732 → "73%". */
export function fmtPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** ISO yyyy-mm-dd → dd-mm-yyyy (UK). */
export function fmtDateUK(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

/** ISO yyyy-mm-dd → "Mon 19 May". */
export function fmtDayLabel(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Mon", "Tue"… */
export function fmtWeekday(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

// ─── Date maths (all in local time, ISO-string in/out) ──────────────────────

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

/** Monday of the week containing `iso` (UK weeks start Monday). */
export function startOfWeek(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`);
  const day = dt.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(iso, diff);
}

/** The 7 ISO dates Mon→Sun for the week containing `iso`. */
export function weekDates(iso: string): string[] {
  const mon = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** Today as an ISO date (client-side). */
export function todayIso(): string {
  return toIsoDate(new Date());
}
