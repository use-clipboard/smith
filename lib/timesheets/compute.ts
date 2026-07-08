// Aggregation + KPI engine for the Timesheets module.
// Pure functions over TimeEntry[] — no React, no side effects.

import type { TimeEntry, TsStaff, TimeEntryType } from './types';
import { weekDates, fmtWeekday, addDays } from './format';
import { TYPE_LABELS } from './palette';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/** Entries within an inclusive ISO date range (yyyy-mm-dd compares lexically). */
export function inRange(entries: TimeEntry[], from: string, to: string, userId?: string): TimeEntry[] {
  return entries.filter(e => e.date >= from && e.date <= to && (!userId || e.userId === userId));
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

export function byTask(entries: TimeEntry[]): Slice[] {
  const map = new Map<string, Slice>();
  for (const e of entries) {
    if (!e.taskId) continue;
    const cur = map.get(e.taskId) ?? { id: e.taskId, label: e.taskTitle || 'Task', minutes: 0, valuePence: 0 };
    cur.minutes += e.minutes;
    cur.valuePence += valueOf(e);
    map.set(e.taskId, cur);
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

function addSegment(b: DayBucket, e: TimeEntry) {
  if (e.type === 'billable') b.billable += e.minutes;
  else if (e.type === 'non_billable') b.nonBillable += e.minutes;
  else b.internal += e.minutes;
  b.total += e.minutes;
}

/** Stacked activity buckets across an arbitrary range — one bar per day (for a
 *  month view) or per month (for a year view). Empty buckets are kept so the
 *  axis is continuous. */
export function bucketActivity(entries: TimeEntry[], from: string, to: string, granularity: 'day' | 'month'): DayBucket[] {
  const order: string[] = [];
  const map = new Map<string, DayBucket>();

  if (granularity === 'month') {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const ey = +to.slice(0, 4), em = +to.slice(5, 7);
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 240) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      map.set(key, { date: key, label: MONTHS_SHORT[m - 1], billable: 0, nonBillable: 0, internal: 0, total: 0 });
      order.push(key);
      m++; if (m > 12) { m = 1; y++; }
    }
    for (const e of entries) { const b = map.get(e.date.slice(0, 7)); if (b) addSegment(b, e); }
  } else {
    let d = from, guard = 0;
    while (d <= to && guard++ < 400) {
      map.set(d, { date: d, label: String(+d.slice(-2)), billable: 0, nonBillable: 0, internal: 0, total: 0 });
      order.push(d);
      d = addDays(d, 1);
    }
    for (const e of entries) { const b = map.get(e.date); if (b) addSegment(b, e); }
  }
  return order.map(k => map.get(k)!);
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

/** Per-staff rollup over an arbitrary date range. Capacity is the weekly
 *  contracted hours scaled by how many weeks the range spans. */
export function perStaffRange(entries: TimeEntry[], staff: TsStaff[], from: string, to: string, weeks: number): StaffRow[] {
  const rows = staff.map(s => {
    const own = inRange(entries, from, to, s.id);
    const t = totals(own);
    const capacityMinutes = s.weeklyCapacityHours * 60 * weeks;
    return {
      staff: s,
      minutes: t.total,
      billable: t.billable,
      billablePct: t.billablePct,
      utilisation: capacityMinutes ? t.billable / capacityMinutes : 0,
      chargeablePence: t.chargeablePence,
      capacityMinutes,
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

// ─── Drill-down grouping ──────────────────────────────────────────────────────
// A generic tree builder: group entries by an ordered list of dimensions
// (e.g. client › staff › task) so Reports can drill from a total all the way
// down to the individual entries.

export type GroupDim = 'client' | 'staff' | 'task' | 'activity' | 'department' | 'type';

export interface GroupNode {
  key: string;
  label: string;
  minutes: number;
  billableMinutes: number;
  valuePence: number;
  /** Present for non-leaf levels. */
  children?: GroupNode[];
  /** Present at the deepest level — the actual entries. */
  entries?: TimeEntry[];
}

function dimKeyLabel(e: TimeEntry, dim: GroupDim, staffName: (id: string) => string): { key: string; label: string } {
  switch (dim) {
    case 'client':     return { key: e.clientId ?? '_internal', label: e.clientId ? (e.clientName || 'Client') : 'Internal / non-client' };
    case 'staff':      return { key: e.userId, label: staffName(e.userId) };
    case 'task':       return { key: e.taskId ?? '_none', label: e.taskId ? (e.taskTitle || 'Task') : 'No linked task' };
    case 'activity':   return { key: e.activity || '_none', label: e.activity || 'Unspecified activity' };
    case 'department': return { key: e.department || '_none', label: e.department || 'Unassigned' };
    case 'type':       return { key: e.type, label: TYPE_LABELS[e.type] };
  }
}

/** Build a hierarchical breakdown of `entries` by the given `dims`, in order.
 *  Each node carries rolled-up minutes / billable minutes / chargeable value;
 *  the last dimension attaches the raw entries (newest first). Sorted by time. */
export function groupTree(entries: TimeEntry[], dims: GroupDim[], staffName: (id: string) => string): GroupNode[] {
  if (dims.length === 0) return [];
  const [dim, ...rest] = dims;
  const buckets = new Map<string, { label: string; items: TimeEntry[] }>();
  for (const e of entries) {
    const { key, label } = dimKeyLabel(e, dim, staffName);
    const b = buckets.get(key) ?? { label, items: [] };
    b.items.push(e);
    buckets.set(key, b);
  }
  return [...buckets.entries()].map(([key, b]) => {
    const minutes = b.items.reduce((s, e) => s + e.minutes, 0);
    const billableMinutes = b.items.reduce((s, e) => s + (e.type === 'billable' ? e.minutes : 0), 0);
    const valuePence = b.items.reduce((s, e) => s + valueOf(e), 0);
    const node: GroupNode = { key, label: b.label, minutes, billableMinutes, valuePence };
    if (rest.length > 0) node.children = groupTree(b.items, rest, staffName);
    else node.entries = [...b.items].sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0));
    return node;
  }).sort((a, c) => c.minutes - a.minutes);
}
