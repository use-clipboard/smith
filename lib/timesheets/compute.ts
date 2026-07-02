// Aggregation + KPI engine for the Timesheets module.
// Pure functions over TimeEntry[] — no React, no side effects.

import type { TimeEntry, TsStaff, TimeEntryType } from './types';
import { weekDates, fmtWeekday } from './format';

const BILLABLE: TimeEntryType = 'billable';

/** Stable pseudo-recovery factor per client (0.70–1.02) so "recovery rate"
 *  varies believably by client without needing stored billing data. */
export function recoveryFactor(clientId: string | null): number {
  if (!clientId) return 1;
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) & 0xffff;
  return 0.7 + (h % 33) / 100; // 0.70 … 1.02
}

/** Deterministic default weekly budget (minutes) for a client when none has
 *  been set — 6–15h, stable per client id. */
export function defaultWeeklyBudgetMinutes(clientId: string): number {
  let h = 0;
  for (let i = 0; i < clientId.length; i++) h = (h * 17 + clientId.charCodeAt(i)) & 0xff;
  return (6 + (h % 10)) * 60;
}

export const valueOf = (e: TimeEntry): number =>
  e.type === BILLABLE ? Math.round((e.minutes / 60) * e.ratePence) : 0;

const recoveredValueOf = (e: TimeEntry): number =>
  Math.round(valueOf(e) * recoveryFactor(e.clientId));

// ─── Filtering ──────────────────────────────────────────────────────────────

export function inWeek(entries: TimeEntry[], anchorIso: string, userId?: string): TimeEntry[] {
  const days = new Set(weekDates(anchorIso));
  return entries.filter(e => days.has(e.date) && (!userId || e.userId === userId));
}

// ─── Scalar rollups ───────────────────────────────────────────────────────────

export interface Totals {
  total: number;
  billable: number;
  nonBillable: number;
  internal: number;
  billablePct: number;
  chargeablePence: number;
  recoveredPence: number;
  recoveryRate: number;
}

export function totals(entries: TimeEntry[]): Totals {
  let total = 0, billable = 0, nonBillable = 0, internal = 0, chargeable = 0, recovered = 0;
  for (const e of entries) {
    total += e.minutes;
    if (e.type === 'billable') { billable += e.minutes; chargeable += valueOf(e); recovered += recoveredValueOf(e); }
    else if (e.type === 'non_billable') nonBillable += e.minutes;
    else internal += e.minutes;
  }
  return {
    total, billable, nonBillable, internal,
    billablePct: total ? billable / total : 0,
    chargeablePence: chargeable,
    recoveredPence: recovered,
    recoveryRate: chargeable ? recovered / chargeable : 0,
  };
}

/** Utilisation = billable hours ÷ capacity hours. */
export function utilisation(billableMinutes: number, capacityHours: number): number {
  const cap = capacityHours * 60;
  return cap ? billableMinutes / cap : 0;
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

export interface Slice {
  id: string;
  label: string;
  minutes: number;
  valuePence: number;
}

export function byClient(entries: TimeEntry[]): Slice[] {
  const map = new Map<string, Slice>();
  for (const e of entries) {
    const key = e.clientId ?? 'internal';
    const label = e.clientId ? e.clientName : 'Internal / non-client';
    const cur = map.get(key) ?? { id: key, label, minutes: 0, valuePence: 0 };
    cur.minutes += e.minutes;
    cur.valuePence += valueOf(e);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

export function byDepartment(entries: TimeEntry[]): Slice[] {
  const map = new Map<string, Slice>();
  for (const e of entries) {
    const cur = map.get(e.department) ?? { id: e.department, label: e.department, minutes: 0, valuePence: 0 };
    cur.minutes += e.minutes;
    cur.valuePence += valueOf(e);
    map.set(e.department, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

/** Group by the *team* (department) of the staff member who logged each entry,
 *  rather than by the activity's department. Used for "Time by department". */
export function byStaffDepartment(entries: TimeEntry[], staff: TsStaff[]): Slice[] {
  const dept = new Map(staff.map(s => [s.id, s.department || 'Unassigned']));
  const map = new Map<string, Slice>();
  for (const e of entries) {
    const d = dept.get(e.userId) ?? 'Unassigned';
    const cur = map.get(d) ?? { id: d, label: d, minutes: 0, valuePence: 0 };
    cur.minutes += e.minutes;
    cur.valuePence += valueOf(e);
    map.set(d, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

export function byActivity(entries: TimeEntry[]): Slice[] {
  const map = new Map<string, Slice>();
  for (const e of entries) {
    const cur = map.get(e.activity) ?? { id: e.activity, label: e.activity, minutes: 0, valuePence: 0 };
    cur.minutes += e.minutes;
    cur.valuePence += valueOf(e);
    map.set(e.activity, cur);
  }
  return [...map.values()].sort((a, b) => b.minutes - a.minutes);
}

// ─── Weekly stacked activity ─────────────────────────────────────────────────

export interface DayBucket {
  date: string;
  label: string;
  billable: number;
  nonBillable: number;
  internal: number;
  total: number;
}

export function byDay(entries: TimeEntry[], anchorIso: string): DayBucket[] {
  const days = weekDates(anchorIso);
  const buckets: Record<string, DayBucket> = {};
  for (const d of days) {
    buckets[d] = { date: d, label: fmtWeekday(d), billable: 0, nonBillable: 0, internal: 0, total: 0 };
  }
  for (const e of entries) {
    const b = buckets[e.date];
    if (!b) continue;
    if (e.type === 'billable') b.billable += e.minutes;
    else if (e.type === 'non_billable') b.nonBillable += e.minutes;
    else b.internal += e.minutes;
    b.total += e.minutes;
  }
  return days.map(d => buckets[d]);
}

// ─── Per-staff (leaderboard + capacity) ──────────────────────────────────────

export interface StaffRow {
  staff: TsStaff;
  minutes: number;
  billable: number;
  billablePct: number;
  utilisation: number;
  chargeablePence: number;
  capacityMinutes: number;
}

export function perStaff(entries: TimeEntry[], staff: TsStaff[], anchorIso: string): StaffRow[] {
  const rows = staff.map(s => {
    const own = inWeek(entries, anchorIso, s.id);
    const t = totals(own);
    return {
      staff: s,
      minutes: t.total,
      billable: t.billable,
      billablePct: t.billablePct,
      utilisation: utilisation(t.billable, s.weeklyCapacityHours),
      chargeablePence: t.chargeablePence,
      capacityMinutes: s.weeklyCapacityHours * 60,
    };
  });
  return rows.sort((a, b) => b.chargeablePence - a.chargeablePence);
}

// ─── Week-on-week delta ──────────────────────────────────────────────────────

export interface Delta {
  current: number;
  previous: number;
  /** signed ratio change; 0.12 = +12%. */
  ratio: number;
}

export function delta(current: number, previous: number): Delta {
  const ratio = previous ? (current - previous) / previous : 0;
  return { current, previous, ratio };
}
