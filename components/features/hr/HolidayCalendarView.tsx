'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Calendar as CalIcon, X } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import type { TeamMember, HolidayRow } from './HrClient';

interface Props {
  team: TeamMember[];
  userId: string;
  userRole: 'admin' | 'staff';
}

interface AbsenceRow {
  id: string;
  user_id: string;
  start_date: string;
  start_half: 'full' | 'morning' | 'afternoon';
  end_date: string;
  end_half: 'full' | 'morning' | 'afternoon';
  category: 'sickness' | 'unpaid_leave' | 'compassionate' | 'jury_duty' | 'medical_appointment' | 'other';
  user: { id: string; full_name: string | null; email: string } | null;
}

const ABSENCE_TINT: Record<AbsenceRow['category'], string> = {
  sickness: '#ef4444',
  unpaid_leave: '#6b7280',
  compassionate: '#f43f5e',
  jury_duty: '#a855f7',
  medical_appointment: '#0ea5e9',
  other: '#64748b',
};

const HOLIDAY_TINT = '#16a34a';       // green for booked holidays
const BANK_HOLIDAY_TINT = '#f59e0b';  // amber for bank holidays

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const fmtIso = (y: number, m: number, d: number): string => `${y.toString().padStart(4, '0')}-${(m + 1).toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

export default function HolidayCalendarView({ team, userId }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthStart = useMemo(() => fmtIso(year, month, 1), [year, month]);
  const monthEnd = useMemo(() => {
    const d = new Date(year, month + 1, 0);
    return fmtIso(d.getFullYear(), d.getMonth(), d.getDate());
  }, [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    // Fetch firm-wide approved holidays + absences. Both endpoints support scope=team
    // but absences uses a different param shape; we just fetch broadly and filter client-side.
    const [hRes, aRes] = await Promise.all([
      fetch(`/api/hr/holidays?scope=firm`),
      fetch(`/api/hr/absence?scope=team`).then(r => r.ok ? r : null),
    ]);
    const hData = await hRes.json();
    const aData = aRes ? await aRes.json() : { absences: [] };
    setHolidays(hData.holidays ?? []);
    setAbsences(aData.absences ?? aData.records ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const days = useMemo(() => buildMonthGrid(year, month), [year, month]);

  // Map iso → events that touch that day. `half` is the half-day applicable to *this* day.
  const eventsByDay = useMemo(() => {
    type Half = 'full' | 'morning' | 'afternoon';
    type DayEvent = { kind: 'holiday' | 'absence'; row: HolidayRow | AbsenceRow; half: Half };
    const map = new Map<string, DayEvent[]>();
    const include = (iso: string, e: DayEvent) => {
      const arr = map.get(iso) ?? [];
      arr.push(e);
      map.set(iso, arr);
    };
    function halfForDay(iso: string, startIso: string, startHalf: Half, endIso: string, endHalf: Half): Half {
      if (iso === startIso && iso === endIso) return startHalf;
      if (iso === startIso) return startHalf;
      if (iso === endIso) return endHalf;
      return 'full';
    }
    for (const h of holidays) {
      iterateRange(h.start_date, h.end_date, monthStart, monthEnd, iso => {
        const half = halfForDay(iso, h.start_date, h.start_half as Half, h.end_date, h.end_half as Half);
        include(iso, { kind: 'holiday', row: h, half });
      });
    }
    for (const a of absences) {
      iterateRange(a.start_date, a.end_date, monthStart, monthEnd, iso => {
        const half = halfForDay(iso, a.start_date, a.start_half, a.end_date, a.end_half);
        include(iso, { kind: 'absence', row: a, half });
      });
    }
    return map;
  }, [holidays, absences, monthStart, monthEnd]);

  const monthLabel = new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const today = todayIso();

  function jumpMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }
  function jumpToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex items-center gap-1 bg-white border border-[var(--border)] rounded-lg p-0.5">
          <button onClick={() => jumpMonth(-1)} aria-label="Previous month" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><ChevronLeft size={14} /></button>
          <button onClick={jumpToday} className="px-3 py-1 text-xs font-medium hover:bg-[var(--bg-nav-hover)] rounded">Today</button>
          <button onClick={() => jumpMonth(1)} aria-label="Next month" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><ChevronRight size={14} /></button>
        </div>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{monthLabel}</h2>
        <Legend />
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading calendar…</div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] bg-gray-50 border-b border-gray-100">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} className="px-2 py-2 text-center">{d}</div>
            ))}
          </div>
          {/* 6 weeks max */}
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const inMonth = d.month === month;
              const isToday = d.iso === today;
              const isWeekend = d.dow === 5 || d.dow === 6;
              const events = eventsByDay.get(d.iso) ?? [];
              const cellBg = inMonth ? (isWeekend ? 'bg-gray-50/40' : 'bg-white') : 'bg-gray-50/70 text-gray-400';
              return (
                <button
                  key={i}
                  onClick={() => events.length > 0 && setSelectedDay(d.iso)}
                  className={`relative min-h-[88px] border-b border-r border-gray-100 px-1.5 py-1.5 text-left transition-colors ${cellBg} ${events.length > 0 ? 'hover:bg-[var(--bg-nav-hover)] cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs font-semibold ${isToday ? 'bg-[var(--accent)] text-white rounded-full h-5 w-5 inline-flex items-center justify-center' : ''}`}>
                      {d.day}
                    </span>
                    {events.length > 0 && (
                      <span className="text-[9px] font-bold text-[var(--text-muted)]">{events.length}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {events.slice(0, 4).map((e, idx) => {
                      const member = team.find(m => m.id === e.row.user_id);
                      let colour: string;
                      let label: string;
                      if (e.kind === 'absence') {
                        colour = ABSENCE_TINT[(e.row as AbsenceRow).category];
                        label = (e.row as AbsenceRow).category.replace('_', ' ');
                      } else {
                        const h = e.row as HolidayRow;
                        colour = h.is_bank_holiday ? BANK_HOLIDAY_TINT : HOLIDAY_TINT;
                        label = h.is_bank_holiday ? (h.bank_holiday_title ?? 'Bank holiday') : 'Holiday';
                      }
                      const half = e.half;
                      const dotStyle: React.CSSProperties = half === 'morning'
                        ? { background: `linear-gradient(to bottom, ${colour} 50%, #e5e7eb 50%)` }
                        : half === 'afternoon'
                          ? { background: `linear-gradient(to bottom, #e5e7eb 50%, ${colour} 50%)` }
                          : { background: colour };
                      const tooltipLabel = `${member?.full_name ?? member?.email ?? 'Someone'} — ${label}${half === 'morning' ? ' (AM half-day)' : half === 'afternoon' ? ' (PM half-day)' : ''}`;
                      return (
                        <Tooltip key={idx} label={tooltipLabel}>
                          <div
                            className="h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border-2 border-white"
                            style={dotStyle}
                          >
                            {initials(member?.full_name ?? null, member?.email ?? '?')}
                          </div>
                        </Tooltip>
                      );
                    })}
                    {events.length > 4 && (
                      <div className="h-5 inline-flex items-center text-[9px] text-[var(--text-muted)] font-bold ml-0.5">+{events.length - 4}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedDay && (
        <DayDetail
          iso={selectedDay}
          events={eventsByDay.get(selectedDay) ?? []}
          team={team}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

function Legend() {
  const items: Array<{ colour: string; label: string }> = [
    { colour: HOLIDAY_TINT,      label: 'Holiday' },
    { colour: BANK_HOLIDAY_TINT, label: 'Bank holiday' },
    { colour: '#ef4444',         label: 'Sickness' },
    { colour: '#0ea5e9',         label: 'Medical' },
    { colour: '#f43f5e',         label: 'Compassionate' },
    { colour: '#a855f7',         label: 'Jury duty' },
    { colour: '#6b7280',         label: 'Unpaid' },
    { colour: '#64748b',         label: 'Other' },
  ];
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.colour }} />{i.label}
        </span>
      ))}
    </div>
  );
}

function DayDetail({ iso, events, team, onClose }: {
  iso: string;
  events: Array<{ kind: 'holiday' | 'absence'; row: HolidayRow | AbsenceRow }>;
  team: TeamMember[];
  onClose: () => void;
}) {
  const fmt = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2"><CalIcon size={14} className="text-[var(--accent)]" />{fmt(iso)}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><X size={14} /></button>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] italic">No-one out on this day.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e, i) => {
              const member = team.find(m => m.id === e.row.user_id);
              const name = member?.full_name ?? member?.email ?? 'Unknown';
              const subtitle = e.kind === 'absence'
                ? (e.row as AbsenceRow).category.replace('_', ' ')
                : 'holiday';
              const span = `${e.row.start_date === e.row.end_date ? '' : `${e.row.start_date} → ${e.row.end_date}`}`;
              return (
                <li key={i} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white ${avatarColour(e.row.user_id)}`}>
                    {initials(member?.full_name ?? null, member?.email ?? '?')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="text-xs text-[var(--text-muted)] capitalize">{subtitle}{span ? ` · ${span}` : ''}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// Build a 6×7 month grid starting from the Monday before-or-on day 1.
interface GridDay { iso: string; day: number; month: number; dow: number }
function buildMonthGrid(year: number, month: number): GridDay[] {
  const first = new Date(year, month, 1);
  // Monday=0..Sunday=6
  const dow = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - dow);
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({
      iso: fmtIso(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      month: d.getMonth(),
      dow: (d.getDay() + 6) % 7,
    });
  }
  return days;
}

function iterateRange(startIso: string, endIso: string, clampStart: string, clampEnd: string, fn: (iso: string) => void) {
  const start = startIso < clampStart ? clampStart : startIso;
  const end = endIso > clampEnd ? clampEnd : endIso;
  if (start > end) return;
  const startD = new Date(start + 'T12:00:00Z');
  const endD = new Date(end + 'T12:00:00Z');
  for (let d = new Date(startD); d <= endD; d.setUTCDate(d.getUTCDate() + 1)) {
    fn(d.toISOString().slice(0, 10));
  }
}
