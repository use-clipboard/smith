// Per-user "Organise my day" preferences — the working-day shape the planner
// schedules into. Stored on users.organise_my_day_settings (jsonb) and edited in
// Settings → Organise my day. All times are minutes from midnight.

export interface OrganiseSettings {
  workStartMin: number;        // start of the working day (e.g. 540 = 09:00)
  workEndMin: number;          // end of the working day (e.g. 1050 = 17:30)
  lunchStartMin: number | null;// lunch start, or null for no lunch block
  lunchMinutes: number;        // lunch length
  bufferMinutes: number;       // gap left between scheduled blocks
  wrapMinutes: number;         // end-of-day wrap-up block reserved before workEnd (0 = off)
}

export const DEFAULT_ORGANISE_SETTINGS: OrganiseSettings = {
  workStartMin: 9 * 60,        // 09:00
  workEndMin: 17 * 60 + 30,    // 17:30
  lunchStartMin: 13 * 60,      // 13:00
  lunchMinutes: 45,
  bufferMinutes: 5,
  wrapMinutes: 15,
};

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Merge a stored (partial/unknown) value onto defaults, keeping it sane
 *  (end after start, lunch inside the day, etc.). */
export function normaliseOrganiseSettings(raw: unknown): OrganiseSettings {
  const r = (raw ?? {}) as Partial<OrganiseSettings>;
  const workStartMin = clampInt(r.workStartMin, 0, 23 * 60, DEFAULT_ORGANISE_SETTINGS.workStartMin);
  let workEndMin = clampInt(r.workEndMin, workStartMin + 60, 24 * 60, DEFAULT_ORGANISE_SETTINGS.workEndMin);
  if (workEndMin <= workStartMin) workEndMin = Math.min(24 * 60, workStartMin + 60);
  const lunchStartMin = r.lunchStartMin == null ? null
    : clampInt(r.lunchStartMin, workStartMin, workEndMin - 15, DEFAULT_ORGANISE_SETTINGS.lunchStartMin ?? workStartMin);
  return {
    workStartMin,
    workEndMin,
    lunchStartMin,
    lunchMinutes: clampInt(r.lunchMinutes, 0, 180, DEFAULT_ORGANISE_SETTINGS.lunchMinutes),
    bufferMinutes: clampInt(r.bufferMinutes, 0, 60, DEFAULT_ORGANISE_SETTINGS.bufferMinutes),
    wrapMinutes: clampInt(r.wrapMinutes, 0, 120, DEFAULT_ORGANISE_SETTINGS.wrapMinutes),
  };
}
