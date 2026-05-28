'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import type { TeamMember, Department, HolidayRow } from './HrClient';

interface AbsenceRow {
  id: string;
  user_id: string;
  start_date: string;
  start_half: 'full' | 'morning' | 'afternoon';
  end_date: string;
  end_half: 'full' | 'morning' | 'afternoon';
  category: 'sickness' | 'unpaid_leave' | 'compassionate' | 'jury_duty' | 'medical_appointment' | 'other';
}

type Half = 'full' | 'morning' | 'afternoon';

interface Props {
  team: TeamMember[];
  departments: Department[];
  userId: string;
  userRole: 'admin' | 'staff';
}

type CellKind = 'holiday' | 'bank_holiday' | 'sickness' | 'medical' | 'compassionate' | 'jury_duty' | 'unpaid' | 'other';

interface CellEntry { kind: CellKind; half: Half; tooltip: string }

const KIND_STYLE: Record<CellKind, { bg: string; text: string; letter: string; label: string }> = {
  holiday:       { bg: '#16a34a', text: '#fff', letter: 'H',  label: 'Holiday' },
  bank_holiday:  { bg: '#f59e0b', text: '#fff', letter: 'BH', label: 'Bank holiday' },
  sickness:      { bg: '#ef4444', text: '#fff', letter: 'S',  label: 'Sickness' },
  medical:       { bg: '#0ea5e9', text: '#fff', letter: 'A',  label: 'Appointment' },
  compassionate: { bg: '#f43f5e', text: '#fff', letter: 'C',  label: 'Compassionate' },
  jury_duty:     { bg: '#a855f7', text: '#fff', letter: 'J',  label: 'Jury duty' },
  unpaid:        { bg: '#6b7280', text: '#fff', letter: 'U',  label: 'Unpaid leave' },
  other:         { bg: '#64748b', text: '#fff', letter: 'O',  label: 'Other' },
};

const fmtIso = (y: number, m: number, d: number): string => `${y.toString().padStart(4, '0')}-${(m + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

function formatTotal(n: number): string {
  if (n === 0) return '';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function prevDayIso(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function isoNextDay(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function categoryToKind(c: AbsenceRow['category']): CellKind {
  switch (c) {
    case 'sickness': return 'sickness';
    case 'medical_appointment': return 'medical';
    case 'compassionate': return 'compassionate';
    case 'jury_duty': return 'jury_duty';
    case 'unpaid_leave': return 'unpaid';
    default: return 'other';
  }
}

function iterateRange(startIso: string, endIso: string, fn: (iso: string) => void) {
  const startD = new Date(startIso + 'T12:00:00Z');
  const endD = new Date(endIso + 'T12:00:00Z');
  for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
    fn(d.toISOString().slice(0, 10));
  }
}

// Given an inclusive date range with start_half/end_half markers, yield each day
// with the half ('full' | 'morning' | 'afternoon') that applies to that day.
function iterateRangeWithHalf(
  startIso: string, startHalf: Half,
  endIso: string, endHalf: Half,
  clampStart: string, clampEnd: string,
  fn: (iso: string, half: Half) => void,
) {
  const start = startIso < clampStart ? clampStart : startIso;
  const end = endIso > clampEnd ? clampEnd : endIso;
  if (start > end) return;
  iterateRange(start, end, iso => {
    let half: Half = 'full';
    if (iso === startIso) half = startHalf;
    else if (iso === endIso) half = endHalf;
    fn(iso, half);
  });
}

interface FirmHrSettings {
  holiday_reset_month: number;
  holiday_reset_day: number;
  default_annual_holiday_days: number;
}

export default function HolidayTrackerView({ team, departments, userId, userRole }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [settings, setSettings] = useState<FirmHrSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoverDay, setHoverDay] = useState<string | null>(null);
  const [hoverMember, setHoverMember] = useState<string | null>(null);
  const [showTotals, setShowTotals] = useState(false);

  const isAdmin = userRole === 'admin';
  const monthStart = useMemo(() => fmtIso(year, month, 1), [year, month]);
  const monthEnd = useMemo(() => {
    const d = new Date(year, month + 1, 0);
    return fmtIso(d.getFullYear(), d.getMonth(), d.getDate());
  }, [year, month]);
  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    const [hRes, aRes, sRes] = await Promise.all([
      fetch('/api/hr/holidays?scope=firm'),
      fetch(`/api/hr/absence?scope=${isAdmin ? 'all' : 'team'}`).then(r => r.ok ? r : null),
      fetch('/api/hr/settings').then(r => r.ok ? r.json() : null),
    ]);
    const hData = await hRes.json();
    const aData = aRes ? await aRes.json() : { records: [] };
    setHolidays(hData.holidays ?? []);
    setAbsences(aData.records ?? []);
    setSettings(sRes?.settings ?? null);
    setLoading(false);
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);

  // Decide which staff to show: admins see everyone except themselves, managers see direct reports + themselves
  const visibleTeam = useMemo(() => {
    if (isAdmin) return team;
    return team.filter(m => m.id === userId || m.manager_id === userId);
  }, [team, userId, isAdmin]);

  // Group rows by department
  const grouped = useMemo(() => {
    const byDept = new Map<string, TeamMember[]>();
    const NO_DEPT = '__none__';
    for (const m of visibleTeam) {
      const key = m.department_id ?? NO_DEPT;
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(m);
    }
    // Sort department list by display_order then name
    const deptOrder = [...departments]
      .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999) || a.name.localeCompare(b.name))
      .map(d => d.id);
    const sortedKeys: string[] = [...deptOrder.filter(id => byDept.has(id))];
    if (byDept.has(NO_DEPT)) sortedKeys.push(NO_DEPT);
    // Sort members within each department by name
    for (const k of sortedKeys) byDept.get(k)!.sort((a, b) => (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email));
    return sortedKeys.map(k => ({
      department: k === NO_DEPT ? null : (departments.find(d => d.id === k) ?? null),
      members: byDept.get(k) ?? [],
    }));
  }, [visibleTeam, departments]);

  // Build cell map: userId -> dayIso -> CellEntry
  const cellMap = useMemo(() => {
    const map = new Map<string, Map<string, CellEntry>>();
    function set(userId: string, iso: string, entry: CellEntry) {
      if (!map.has(userId)) map.set(userId, new Map());
      // Don't overwrite if cell already has something — first match wins (holidays usually loaded first).
      const inner = map.get(userId)!;
      if (!inner.has(iso)) inner.set(iso, entry);
    }
    // Holidays first
    for (const h of holidays) {
      const kind: CellKind = h.is_bank_holiday ? 'bank_holiday' : 'holiday';
      const baseTooltip = h.is_bank_holiday ? (h.bank_holiday_title ?? 'Bank holiday') : 'Holiday';
      iterateRangeWithHalf(
        h.start_date, h.start_half as Half, h.end_date, h.end_half as Half,
        monthStart, monthEnd,
        (iso, half) => set(h.user_id, iso, { kind, half, tooltip: half === 'full' ? baseTooltip : `${baseTooltip} (${half})` }),
      );
    }
    // Absences override only if no holiday already in that cell
    for (const a of absences) {
      const kind = categoryToKind(a.category);
      const baseTooltip = KIND_STYLE[kind].label;
      iterateRangeWithHalf(
        a.start_date, a.start_half, a.end_date, a.end_half,
        monthStart, monthEnd,
        (iso, half) => set(a.user_id, iso, { kind, half, tooltip: half === 'full' ? baseTooltip : `${baseTooltip} (${half})` }),
      );
    }
    return map;
  }, [holidays, absences, monthStart, monthEnd]);

  // Holiday-year window from firm settings (reset month/day). Falls back to calendar year.
  const holidayYear = useMemo(() => {
    const m = (settings?.holiday_reset_month ?? 1) - 1;
    const d = settings?.holiday_reset_day ?? 1;
    const today = new Date();
    let start = new Date(today.getFullYear(), m, d);
    if (start > today) start = new Date(today.getFullYear() - 1, m, d);
    const end = new Date(start); end.setFullYear(end.getFullYear() + 1);
    const isoOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { start: isoOf(start), end: isoOf(end) };
  }, [settings]);

  // Days a holiday row contributes within [windowStart, windowEnd) for a given user.
  // Half-days at the start/end count as 0.5.
  const daysInWindow = useCallback((h: HolidayRow, windowStart: string, windowEnd: string): number => {
    if (h.end_date < windowStart || h.start_date >= windowEnd) return 0;
    let total = 0;
    iterateRangeWithHalf(
      h.start_date, h.start_half as Half, h.end_date, h.end_half as Half,
      windowStart, windowEnd > windowStart ? prevDayIso(windowEnd) : windowEnd,
      (_iso, half) => { total += half === 'full' ? 1 : 0.5; },
    );
    return total;
  }, []);

  // Per-category month + YTD totals for one member. Uses the same firm-wide
  // holidays / scoped absences arrays already loaded by `load()`. Half-days
  // count as 0.5.
  const categoryTotals = useCallback((memberId: string): Record<CellKind, { month: number; ytd: number }> => {
    const out: Record<CellKind, { month: number; ytd: number }> = {
      holiday: { month: 0, ytd: 0 },
      bank_holiday: { month: 0, ytd: 0 },
      sickness: { month: 0, ytd: 0 },
      medical: { month: 0, ytd: 0 },
      compassionate: { month: 0, ytd: 0 },
      jury_duty: { month: 0, ytd: 0 },
      unpaid: { month: 0, ytd: 0 },
      other: { month: 0, ytd: 0 },
    };
    // "YTD" here means the whole holiday year — including future bookings.
    // Holidays and bank holidays are almost always entered well in advance,
    // so totalling only up to today would routinely understate the
    // employee's used allowance. holidayYear.end is exclusive (day after
    // the final day of the year) which is exactly what daysInWindow wants.
    const yearEndExclusive = holidayYear.end;
    // Holidays
    for (const h of holidays) {
      if (h.user_id !== memberId) continue;
      if (h.status && h.status !== 'approved') continue;
      const kind: CellKind = h.is_bank_holiday ? 'bank_holiday' : 'holiday';
      out[kind].month += daysInWindow(h, monthStart, isoNextDay(monthEnd));
      out[kind].ytd   += daysInWindow(h, holidayYear.start, yearEndExclusive);
    }
    // Absences
    for (const a of absences) {
      if (a.user_id !== memberId) continue;
      const kind = categoryToKind(a.category);
      const synthetic: HolidayRow = {
        id: a.id, firm_id: '', user_id: a.user_id, manager_id: null,
        start_date: a.start_date, start_half: a.start_half,
        end_date: a.end_date, end_half: a.end_half,
        total_days: 0, reason: null, status: 'approved', source: 'direct',
        rejection_reason: null, pushed_to_calendar: false,
        is_bank_holiday: false, bank_holiday_title: null,
        decided_at: null, created_at: '', requester: null, manager: null,
      };
      out[kind].month += daysInWindow(synthetic, monthStart, isoNextDay(monthEnd));
      out[kind].ytd   += daysInWindow(synthetic, holidayYear.start, yearEndExclusive);
    }
    return out;
  }, [holidays, absences, monthStart, monthEnd, holidayYear, daysInWindow]);

  // Per-member totals — month and YTD (within current holiday year), and entitlement.
  const memberTotals = useCallback((memberId: string) => {
    // Month total from cellMap (already restricted to month)
    let month = 0;
    const inner = cellMap.get(memberId);
    if (inner) {
      for (const [, e] of inner.entries()) {
        if (e.kind === 'holiday' || e.kind === 'bank_holiday') {
          month += e.half === 'full' ? 1 : 0.5;
        }
      }
    }
    // YTD covers the whole holiday year — including future approved
    // bookings — so Remaining reflects what's actually left rather than
    // assuming no future leave is on the books. Holidays and bank
    // holidays are tracked separately because Remaining = entitlement
    // − holidays − bank holidays (other absence categories don't draw
    // down annual leave).
    let ytd = 0;
    let bankYtd = 0;
    for (const h of holidays) {
      if (h.user_id !== memberId) continue;
      if (h.status !== 'approved' && h.status !== undefined) continue;
      const days = daysInWindow(h, holidayYear.start, holidayYear.end);
      if (h.is_bank_holiday) bankYtd += days;
      else ytd += days;
    }
    // Entitlement for the CURRENT holiday year. Mirrors the balance API:
    //   • Annual figure = per-user override, else firm default, else 28.
    //   • Pro-rata only when `pro_rata_first_year` is on AND the start date
    //     falls strictly inside the active holiday window. Otherwise the
    //     full annual figure is used (the flag is a no-op for established
    //     staff or anyone past their first year).
    const member = team.find(m => m.id === memberId);
    const annual = Number(
      member?.holiday_entitlement_days_override
        ?? settings?.default_annual_holiday_days
        ?? 28,
    );
    let entitlement = annual;
    let proRated = false;
    const start = member?.employment_start_date ?? null;
    if (member?.pro_rata_first_year && start && start > holidayYear.start && start < holidayYear.end) {
      const startMs = new Date(start + 'T12:00:00Z').getTime();
      const windowStartMs = new Date(holidayYear.start + 'T12:00:00Z').getTime();
      const windowEndMs = new Date(holidayYear.end + 'T12:00:00Z').getTime(); // exclusive
      const effectiveStartMs = Math.max(startMs, windowStartMs);
      const totalDays = Math.max(1, Math.round((windowEndMs - windowStartMs) / 86_400_000));
      const remainingDays = Math.max(0, Math.round((windowEndMs - effectiveStartMs) / 86_400_000));
      entitlement = Math.round(((remainingDays / totalDays) * annual) * 2) / 2;
      proRated = true;
    }
    const remaining = Math.round((entitlement - ytd - bankYtd) * 2) / 2;
    return { month, ytd, bankYtd, entitlement, annual, proRated, remaining };
  }, [cellMap, holidays, holidayYear, daysInWindow, settings, team]);


  function jumpMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth());
  }

  const monthLabel = new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const today = todayIso();

  // Day-of-week labels for the column header
  const dayLabels = useMemo(() => {
    const arr: Array<{ day: number; iso: string; dow: number; isWeekend: boolean; isToday: boolean }> = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = fmtIso(year, month, d);
      const date = new Date(year, month, d);
      const dow = (date.getDay() + 6) % 7; // 0=Mon, 6=Sun
      arr.push({ day: d, iso, dow, isWeekend: dow >= 5, isToday: iso === today });
    }
    return arr;
  }, [year, month, daysInMonth, today]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex items-center gap-1 bg-white border border-[var(--border)] rounded-lg p-0.5">
          <button onClick={() => jumpMonth(-1)} aria-label="Previous month" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><ChevronLeft size={14} /></button>
          <button onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }} className="px-3 py-1 text-xs font-medium hover:bg-[var(--bg-nav-hover)] rounded">Today</button>
          <button onClick={() => jumpMonth(1)} aria-label="Next month" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><ChevronRight size={14} /></button>
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{monthLabel}</h2>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={() => setShowTotals(v => !v)}
            className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-pressed={showTotals}
          >
            <span>Totals</span>
            <span
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${showTotals ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${showTotals ? 'translate-x-4' : 'translate-x-0'}`} />
            </span>
          </button>
          <Legend />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading tracker…</div>
      ) : showTotals ? (
        <TotalsTable
          grouped={grouped}
          categoryTotals={categoryTotals}
          memberTotals={memberTotals}
          monthLabel={monthLabel}
        />
      ) : (
        <div
          className="bg-white border border-[var(--border)] rounded-xl overflow-auto max-h-[calc(100vh-220px)]"
          onMouseLeave={() => { setHoverDay(null); setHoverMember(null); }}
        >
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky top-0 left-0 z-30 bg-gray-50 px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide text-[var(--text-muted)] min-w-[180px] border-r border-b border-gray-200">Employee</th>
                {dayLabels.map(d => {
                  const isColHover = hoverDay === d.iso;
                  return (
                    <th
                      key={d.day}
                      onMouseEnter={() => setHoverDay(d.iso)}
                      className={`sticky top-0 z-20 px-1 py-1 text-center font-semibold text-[9px] uppercase border-r border-b border-gray-200 ${
                        d.isToday ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                        : isColHover ? 'bg-gray-100'
                        : d.isWeekend ? 'bg-gray-100/70 text-[var(--text-muted)]'
                        : 'bg-gray-50 text-[var(--text-secondary)]'
                      }`}
                    >
                      <div>{['M','T','W','T','F','S','S'][d.dow]}</div>
                      <div className={`${d.isToday ? 'font-bold' : ''}`}>{d.day}</div>
                    </th>
                  );
                })}
                <th className="sticky top-0 z-20 px-2 py-2 text-center font-semibold text-[9px] uppercase text-emerald-700 bg-emerald-50 border-l border-b border-gray-200">Hol (mo)</th>
                <th className="sticky top-0 z-20 px-2 py-2 text-center font-semibold text-[9px] uppercase text-[var(--text-muted)] bg-gray-50 border-b border-gray-200">Entitlement</th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr><td colSpan={dayLabels.length + 3} className="px-4 py-6 text-center text-[var(--text-muted)] italic">No staff to show in this view.</td></tr>
              ) : grouped.map(({ department, members }) => (
                <DepartmentBlock
                  key={department?.id ?? '__none__'}
                  department={department}
                  members={members}
                  dayLabels={dayLabels}
                  cellMap={cellMap}
                  memberTotals={memberTotals}
                  hoverDay={hoverDay}
                  hoverMember={hoverMember}
                  setHoverDay={setHoverDay}
                  setHoverMember={setHoverMember}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Totals table (alt view when the toggle is on) ───────────────────────
const TOTAL_CATEGORIES: CellKind[] = ['holiday', 'bank_holiday', 'sickness', 'medical', 'compassionate', 'jury_duty', 'unpaid', 'other'];

function TotalsTable({
  grouped, categoryTotals, memberTotals, monthLabel,
}: {
  grouped: Array<{ department: Department | null; members: TeamMember[] }>;
  categoryTotals: (id: string) => Record<CellKind, { month: number; ytd: number }>;
  memberTotals: (id: string) => { month: number; ytd: number; bankYtd: number; entitlement: number; annual: number; proRated: boolean; remaining: number };
  monthLabel: string;
}) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl overflow-auto max-h-[calc(100vh-220px)]">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr className="bg-gray-50">
            <th className="sticky top-0 left-0 z-30 bg-gray-50 px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wide text-[var(--text-muted)] min-w-[180px] border-r border-b border-gray-200">Employee</th>
            {TOTAL_CATEGORIES.map(k => (
              <th key={k} colSpan={2} className="sticky top-0 z-20 bg-gray-50 px-0 pt-1.5 pb-0 text-center font-semibold text-[10px] uppercase border-r border-b border-gray-200" style={{ color: KIND_STYLE[k].bg }}>
                <span className="inline-flex items-center gap-1 justify-center">
                  <span style={{ width: 8, height: 8, borderRadius: 9999, background: KIND_STYLE[k].bg, display: 'inline-block' }} />
                  {KIND_STYLE[k].label}
                </span>
                <div className="grid grid-cols-2 mt-1 border-t border-gray-200" title={monthLabel}>
                  <span className="py-0.5 text-[8px] font-medium uppercase text-[var(--text-muted)] border-r border-gray-200">Month</span>
                  <span className="py-0.5 text-[8px] font-medium uppercase text-[var(--text-muted)]" title="Full holiday year — includes future approved bookings">FY</span>
                </div>
              </th>
            ))}
            <th className="sticky top-0 z-20 px-2 py-2 text-center font-semibold text-[9px] uppercase text-[var(--text-muted)] bg-gray-50 border-l border-b border-gray-200">Entitlement</th>
            <th className="sticky top-0 z-20 px-2 py-2 text-center font-semibold text-[9px] uppercase text-[var(--text-muted)] bg-gray-50 border-l border-b border-gray-200">Remaining</th>
          </tr>
        </thead>
        <tbody>
          {grouped.length === 0 ? (
            <tr><td colSpan={TOTAL_CATEGORIES.length * 2 + 3} className="px-4 py-6 text-center text-[var(--text-muted)] italic">No staff to show in this view.</td></tr>
          ) : grouped.map(({ department, members }) => {
            const deptColor = department?.color ?? '#94a3b8';
            return (
              <Fragment key={department?.id ?? '__none__'}>
                <tr className="border-b border-gray-100" style={{ background: deptColor + '12' }}>
                  <td colSpan={TOTAL_CATEGORIES.length * 2 + 3} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: deptColor }}>
                    {department?.name ?? 'No department'}
                  </td>
                </tr>
                {members.map(m => {
                  const cats = categoryTotals(m.id);
                  const totals = memberTotals(m.id);
                  return (
                    <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5 font-medium text-[var(--text-primary)] whitespace-nowrap border-r border-gray-200">
                        {m.full_name ?? m.email}
                      </td>
                      {TOTAL_CATEGORIES.map(k => {
                        const v = cats[k];
                        return (
                          <Fragment key={k}>
                            <td className="px-1.5 py-1 text-center font-semibold" style={{ color: KIND_STYLE[k].bg }}>
                              {v.month === 0 ? <span className="text-[var(--text-muted)]/40">—</span> : formatTotal(v.month)}
                            </td>
                            <td className="px-1.5 py-1 text-center text-[var(--text-secondary)] border-r border-gray-200">
                              {v.ytd === 0 ? <span className="text-[var(--text-muted)]/40">—</span> : formatTotal(v.ytd)}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="px-2 text-center font-medium bg-gray-50/40">
                        <Tooltip
                          label={totals.proRated
                            ? `Pro-rated entitlement for the current holiday year: ${totals.entitlement} of ${totals.annual} day${totals.annual === 1 ? '' : 's'} (first-year starter)`
                            : `Annual holiday entitlement: ${totals.entitlement} day${totals.entitlement === 1 ? '' : 's'}`}
                        >
                          <span className={`cursor-help ${totals.proRated ? 'text-indigo-700' : 'text-[var(--text-secondary)]'}`}>
                            {totals.entitlement}
                          </span>
                        </Tooltip>
                      </td>
                      <td className="px-2 text-center font-bold bg-emerald-50/40">
                        <Tooltip
                          label={`Remaining = Entitlement (${totals.entitlement}) − Holidays (${formatTotal(totals.ytd) || '0'}) − Bank holidays (${formatTotal(totals.bankYtd) || '0'}). Includes future approved bookings.`}
                        >
                          <span className={`cursor-help ${totals.remaining < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                            {formatTotal(totals.remaining)}
                          </span>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DepartmentBlock({
  department, members, dayLabels, cellMap, memberTotals, hoverDay, hoverMember, setHoverDay, setHoverMember,
}: {
  department: Department | null;
  members: TeamMember[];
  dayLabels: Array<{ day: number; iso: string; dow: number; isWeekend: boolean; isToday: boolean }>;
  cellMap: Map<string, Map<string, CellEntry>>;
  memberTotals: (id: string) => { month: number; ytd: number; bankYtd: number; entitlement: number; annual: number; proRated: boolean; remaining: number };
  hoverDay: string | null;
  hoverMember: string | null;
  setHoverDay: (iso: string | null) => void;
  setHoverMember: (id: string | null) => void;
}) {
  const deptColor = department?.color ?? '#94a3b8';
  return (
    <>
      <tr className="border-b border-gray-100" style={{ background: deptColor + '12' }}>
        <td colSpan={dayLabels.length + 3} className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: deptColor }}>
          {department?.name ?? 'No department'}
        </td>
      </tr>
      {members.map(m => {
        const totals = memberTotals(m.id);
        const isRowHover = hoverMember === m.id;
        const rowBg = isRowHover ? 'bg-gray-50/70' : '';
        return (
          <tr key={m.id} className={`border-b border-gray-100 ${rowBg}`}>
            <td
              className={`sticky left-0 z-10 px-3 py-1.5 font-medium text-[var(--text-primary)] whitespace-nowrap border-r border-gray-200 ${isRowHover ? 'bg-gray-50' : 'bg-white'}`}
              onMouseEnter={() => setHoverMember(m.id)}
            >
              {m.full_name ?? m.email}
            </td>
            {dayLabels.map(d => {
              const e = cellMap.get(m.id)?.get(d.iso);
              const isWeekend = d.isWeekend;
              const isColHover = hoverDay === d.iso;
              const isIntersect = isRowHover && isColHover;
              const cellBg = isIntersect ? 'bg-gray-200/60'
                : isColHover ? 'bg-gray-100/70'
                : isRowHover ? 'bg-gray-50/40'
                : isWeekend ? 'bg-gray-50/60'
                : '';
              return (
                <td
                  key={d.day}
                  onMouseEnter={() => { setHoverDay(d.iso); setHoverMember(m.id); }}
                  className={`p-0 text-center border-r border-gray-100 ${cellBg}`}
                  style={{ minWidth: 22, height: 24 }}
                >
                  {e ? (
                    <Tooltip label={`${m.full_name ?? m.email} — ${e.tooltip}`}>
                      <div className="w-full h-full flex items-center justify-center">
                        <Dot kind={e.kind} half={e.half} />
                      </div>
                    </Tooltip>
                  ) : <span>&nbsp;</span>}
                </td>
              );
            })}
            <td className="px-2 text-center text-emerald-700 font-bold bg-emerald-50/40 border-l border-gray-200">
              <Tooltip label={`Holiday days this month: ${formatTotal(totals.month) || '0'} · Full year: ${formatTotal(totals.ytd) || '0'} of ${totals.entitlement}`}>
                <span className="cursor-help">{formatTotal(totals.month)}</span>
              </Tooltip>
            </td>
            <td className="px-2 text-center text-[var(--text-secondary)] font-medium bg-gray-50/40">
              <Tooltip
                label={totals.proRated
                  ? `Pro-rated entitlement for the current holiday year: ${totals.entitlement} of ${totals.annual} day${totals.annual === 1 ? '' : 's'} (first-year starter)`
                  : `Annual holiday entitlement: ${totals.entitlement} day${totals.entitlement === 1 ? '' : 's'}`}
              >
                <span className={`cursor-help ${totals.proRated ? 'text-indigo-700' : ''}`}>
                  {totals.entitlement}
                </span>
              </Tooltip>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Dot({ kind, half }: { kind: CellKind; half: Half }) {
  const colour = KIND_STYLE[kind].bg;
  const baseStyle: React.CSSProperties = { width: 12, height: 12, borderRadius: 9999 };
  if (half === 'morning') {
    return <div style={{ ...baseStyle, background: `linear-gradient(to bottom, ${colour} 50%, transparent 50%)` }} />;
  }
  if (half === 'afternoon') {
    return <div style={{ ...baseStyle, background: `linear-gradient(to bottom, transparent 50%, ${colour} 50%)` }} />;
  }
  return <div style={{ ...baseStyle, background: colour }} />;
}

function Legend() {
  // Holiday first, then its two half-day variants, then everything else
  const after: CellKind[] = ['bank_holiday', 'sickness', 'medical', 'compassionate', 'jury_duty', 'unpaid', 'other'];
  const dotStyle = (background: React.CSSProperties['background']): React.CSSProperties => ({ width: 10, height: 10, borderRadius: 9999, background });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
      <span className="inline-flex items-center gap-1.5">
        <span style={dotStyle(KIND_STYLE.holiday.bg)} />
        <span className="text-[var(--text-muted)]">Holiday</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span style={dotStyle(`linear-gradient(to bottom, ${KIND_STYLE.holiday.bg} 50%, transparent 50%)`)} />
        <span className="text-[var(--text-muted)]">AM half-day</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span style={dotStyle(`linear-gradient(to bottom, transparent 50%, ${KIND_STYLE.holiday.bg} 50%)`)} />
        <span className="text-[var(--text-muted)]">PM half-day</span>
      </span>
      {after.map(k => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span style={dotStyle(KIND_STYLE[k].bg)} />
          <span className="text-[var(--text-muted)]">{KIND_STYLE[k].label}</span>
        </span>
      ))}
    </div>
  );
}
