// Billing module — "is today this firm's statement day?".
//
// Deliberately dependency-free and pure: this decides whether a client gets an
// email, and it's the kind of date arithmetic that fails silently (a firm set to
// the 31st simply never running). Kept isolated so it can be exercised directly.

export interface StatementSchedule {
  statement_frequency: 'weekly' | 'monthly' | null;
  /** Monthly: day of month 1–31. Weekly: ISO weekday 1 (Mon) – 7 (Sun). */
  statement_day: number | null;
}

/** Days in the month containing `iso`. */
function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function isStatementDueToday(cfg: StatementSchedule, todayIso: string): boolean {
  const d = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;

  const day = cfg.statement_day ?? 1;

  if ((cfg.statement_frequency ?? 'monthly') === 'weekly') {
    const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // JS: Sun = 0
    return isoDow === Math.min(7, Math.max(1, day));
    }

  // Monthly, clamped: a firm set to the 31st still runs on 30 April and 28/29
  // February, rather than being skipped for the short months.
  const dom = d.getUTCDate();
  return dom === Math.min(Math.max(1, day), daysInMonth(d));
}
