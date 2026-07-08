'use client';

import { useMemo, useState } from 'react';
import { Clock, Percent, Gauge, Repeat2, PoundSterling, AlarmClock } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import {
  inRange, totals, utilisation, byClient, byStaffDepartment, byDay, bucketActivity, perStaffRange, delta,
} from '@/lib/timesheets/compute';
import { addDays, startOfWeek, todayIso, fmtDuration, fmtHours, fmtPct, fmtGBPCompact } from '@/lib/timesheets/format';
import { colorAt } from '@/lib/timesheets/palette';
import { KpiCard, SegToggle, GlassCard, SectionHeader } from '../shared/ui';
import RadialGauge from '../charts/RadialGauge';
import WeeklyActivityChart from '../charts/WeeklyActivityChart';
import DonutPanel, { DonutRow } from './DonutPanel';
import AiSuggestionsPanel from './AiSuggestionsPanel';
import { TeamCapacityPanel, StaffLeaderboard } from './TeamPanels';
import RecentEntries from './RecentEntries';

type Scope = 'me' | 'team';
type Period = 'this' | 'last' | 'month' | 'year';

interface RangeInfo {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** How many weeks the range spans — scales capacity for utilisation. */
  weeks: number;
  noun: string;                          // 'week' | 'month' | 'year' — for labels
  chartTitle: string;
  chartBuckets: 'weekday' | 'day' | 'month';
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function computeRange(period: Period): RangeInfo {
  const today = todayIso();
  if (period === 'this' || period === 'last') {
    const anchor = period === 'this' ? today : addDays(today, -7);
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return { from, to, prevFrom: addDays(from, -7), prevTo: addDays(to, -7), weeks: 1, noun: 'week', chartTitle: 'Weekly activity', chartBuckets: 'weekday' };
  }
  if (period === 'month') {
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    const din = daysInMonth(y, m);
    const mm = today.slice(0, 7);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    const pms = `${py}-${String(pm).padStart(2, '0')}`;
    return {
      from: `${mm}-01`, to: `${mm}-${String(din).padStart(2, '0')}`,
      prevFrom: `${pms}-01`, prevTo: `${pms}-${String(daysInMonth(py, pm)).padStart(2, '0')}`,
      weeks: din / 7, noun: 'month', chartTitle: 'Daily activity', chartBuckets: 'day',
    };
  }
  const y = +today.slice(0, 4);
  return {
    from: `${y}-01-01`, to: `${y}-12-31`, prevFrom: `${y - 1}-01-01`, prevTo: `${y - 1}-12-31`,
    weeks: 52, noun: 'year', chartTitle: 'Monthly activity', chartBuckets: 'month',
  };
}

function buildDonutRows(slices: { id: string; label: string; minutes: number }[], max = 6): DonutRow[] {
  const top = slices.slice(0, max).map((s, i) => ({ ...s, color: colorAt(i) }));
  const rest = slices.slice(max);
  if (rest.length) {
    top.push({ id: '__other', label: `Other (${rest.length})`, minutes: rest.reduce((a, b) => a + b.minutes, 0), color: '#CBD5E1' });
  }
  return top;
}

export default function OverviewDashboard() {
  const { entries, staff, suggestions, meId, dailyTargetHours } = useTimesheets();
  const [scope, setScope] = useState<Scope>('me');
  const [period, setPeriod] = useState<Period>('this');

  const range = useMemo(() => computeRange(period), [period]);
  const scopeUser = scope === 'me' ? meId : undefined;
  const me = staff.find(s => s.id === meId) ?? staff[0];

  const data = useMemo(() => {
    const cur = inRange(entries, range.from, range.to, scopeUser);
    const prev = inRange(entries, range.prevFrom, range.prevTo, scopeUser);
    const t = totals(cur);
    const tPrev = totals(prev);

    const weeklyCapacity = scope === 'me' ? (me?.weeklyCapacityHours ?? 37.5) : staff.reduce((s, x) => s + x.weeklyCapacityHours, 0);
    const util = utilisation(t.billable, weeklyCapacity * range.weeks);

    const dayBuckets = range.chartBuckets === 'weekday'
      ? byDay(cur, range.from)
      : bucketActivity(cur, range.from, range.to, range.chartBuckets === 'day' ? 'day' : 'month');

    return {
      t, tPrev, util,
      clientRows: buildDonutRows(byClient(cur)),
      deptRows: buildDonutRows(byStaffDepartment(cur, staff)),
      dayBuckets,
      staffRows: perStaffRange(entries, staff, range.from, range.to, range.weeks),
      unrecorded: suggestions.reduce((s, x) => s + x.suggestedMinutes, 0),
    };
  }, [entries, range, scope, scopeUser, staff, me, suggestions]);

  const { t, tPrev } = data;
  const dTotal = delta(t.total, tPrev.total);
  const dValue = delta(t.chargeablePence, tPrev.chargeablePence);
  // Target line: per-day for weekday/day bars, per-month (~21 working days) for
  // the yearly monthly bars. Scaled by headcount in the whole-firm view.
  const scopeMult = scope === 'me' ? 1 : staff.length;
  const bucketTargetHours = (range.chartBuckets === 'month' ? dailyTargetHours * 21 : dailyTargetHours) * scopeMult;

  // Recent entries: personal, most recent first (not period-scoped).
  const recent = useMemo(
    () => [...entries].filter(e => e.userId === meId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [entries, meId],
  );

  return (
    <div className="space-y-5">
      {/* Scope + period controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegToggle<Scope>
          options={[{ value: 'me', label: 'My activity' }, { value: 'team', label: 'Whole firm' }]}
          value={scope} onChange={setScope}
        />
        <SegToggle<Period>
          options={[
            { value: 'this', label: 'This week' },
            { value: 'last', label: 'Last week' },
            { value: 'month', label: 'This month' },
            { value: 'year', label: 'This year' },
          ]}
          value={period} onChange={setPeriod}
        />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={`Time this ${range.noun}`} value={fmtHours(t.total)} icon={Clock} tint="#6366F1" deltaRatio={dTotal.ratio} sub={`vs last ${range.noun}`} />
        <KpiCard label="Billable" value={fmtPct(t.billablePct)} icon={Percent} tint="#10B981" sub={fmtDuration(t.billable)} />
        <KpiCard
          label="Utilisation" value={fmtPct(data.util)} icon={Gauge} tint="#8B5CF6"
          gauge={<RadialGauge value={data.util} color="#8B5CF6" label={fmtPct(data.util)} />}
        />
        <KpiCard
          label="Recovery rate" value={fmtPct(t.recoveryRate)} icon={Repeat2} tint="#0EA5E9"
          gauge={<RadialGauge value={t.recoveryRate} color="#0EA5E9" label={fmtPct(t.recoveryRate)} />}
        />
        <KpiCard label="Chargeable value" value={fmtGBPCompact(t.chargeablePence)} icon={PoundSterling} tint="#F59E0B" deltaRatio={dValue.ratio} sub={`vs last ${range.noun}`} />
        <KpiCard label="Unrecorded time" value={fmtDuration(data.unrecorded)} icon={AlarmClock} tint="#F43F5E" sub={`${suggestions.length} to confirm`} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Left / main */}
        <div className="space-y-5 xl:col-span-2">
          <GlassCard>
            <SectionHeader
              title={range.chartTitle}
              subtitle={`${fmtHours(t.total)} logged · ${fmtPct(t.billablePct)} billable`}
            />
            <WeeklyActivityChart days={data.dayBuckets} targetHours={bucketTargetHours} />
          </GlassCard>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <DonutPanel title="Time by client" subtitle={`Where the ${range.noun} went`} rows={data.clientRows} centerLabel="Total" />
            <DonutPanel title="Time by department" subtitle="Across the practice" rows={data.deptRows} centerLabel="Total" />
          </div>

          <RecentEntries entries={recent} />
        </div>

        {/* Right / rail */}
        <div className="space-y-5">
          <AiSuggestionsPanel />
          <TeamCapacityPanel rows={data.staffRows} periodNoun={range.noun} />
          <StaffLeaderboard rows={data.staffRows} periodNoun={range.noun} />
        </div>
      </div>
    </div>
  );
}
