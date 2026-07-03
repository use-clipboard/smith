'use client';

import { useMemo, useState } from 'react';
import { Clock, Percent, Gauge, Repeat2, PoundSterling, AlarmClock } from 'lucide-react';
import { useTimesheets } from '../TimesheetsProvider';
import {
  inWeek, totals, utilisation, byClient, byStaffDepartment, byDay, perStaff, delta,
} from '@/lib/timesheets/compute';
import { addDays, todayIso, fmtDuration, fmtHours, fmtPct, fmtGBPCompact } from '@/lib/timesheets/format';
import { colorAt } from '@/lib/timesheets/palette';
import { KpiCard, SegToggle, GlassCard, SectionHeader } from '../shared/ui';
import RadialGauge from '../charts/RadialGauge';
import WeeklyActivityChart from '../charts/WeeklyActivityChart';
import DonutPanel, { DonutRow } from './DonutPanel';
import AiSuggestionsPanel from './AiSuggestionsPanel';
import { TeamCapacityPanel, StaffLeaderboard } from './TeamPanels';
import RecentEntries from './RecentEntries';

type Scope = 'me' | 'team';
type Period = 'this' | 'last';

function buildDonutRows(slices: { id: string; label: string; minutes: number }[], max = 6): DonutRow[] {
  const top = slices.slice(0, max).map((s, i) => ({ ...s, color: colorAt(i) }));
  const rest = slices.slice(max);
  if (rest.length) {
    top.push({ id: '__other', label: `Other (${rest.length})`, minutes: rest.reduce((a, b) => a + b.minutes, 0), color: '#CBD5E1' });
  }
  return top;
}

export default function OverviewDashboard() {
  const { entries, staff, suggestions, meId, mode, loadSampleWeek, loadingSample, dailyTargetHours } = useTimesheets();
  const [scope, setScope] = useState<Scope>('me');
  const [period, setPeriod] = useState<Period>('this');

  const anchor = period === 'this' ? todayIso() : addDays(todayIso(), -7);
  const prevAnchor = addDays(anchor, -7);
  const scopeUser = scope === 'me' ? meId : undefined;
  const me = staff.find(s => s.id === meId) ?? staff[0];

  const data = useMemo(() => {
    const week = inWeek(entries, anchor, scopeUser);
    const prevWeek = inWeek(entries, prevAnchor, scopeUser);
    const t = totals(week);
    const tPrev = totals(prevWeek);

    const capacityHours = scope === 'me' ? (me?.weeklyCapacityHours ?? 37.5) : staff.reduce((s, x) => s + x.weeklyCapacityHours, 0);
    const util = utilisation(t.billable, capacityHours);

    const staffRows = perStaff(entries, staff, anchor);
    const unrecorded = suggestions.reduce((s, x) => s + x.suggestedMinutes, 0);

    return {
      week, t, tPrev, util,
      clientRows: buildDonutRows(byClient(week)),
      deptRows: buildDonutRows(byStaffDepartment(week, staff)),
      dayBuckets: byDay(week, anchor),
      staffRows,
      unrecorded,
    };
  }, [entries, anchor, prevAnchor, scope, scopeUser, staff, me, suggestions]);

  const { t, tPrev } = data;
  const dTotal = delta(t.total, tPrev.total);
  const dValue = delta(t.chargeablePence, tPrev.chargeablePence);
  // Firm daily target (per person); the whole-firm view scales it by headcount.
  const dailyTarget = scope === 'me' ? dailyTargetHours : dailyTargetHours * staff.length;

  // Recent entries: personal, most recent first.
  const recent = useMemo(
    () => [...entries].filter(e => e.userId === meId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [entries, meId],
  );

  const showSamplePrompt = mode === 'live' && entries.length === 0;

  return (
    <div className="space-y-5">
      {showSamplePrompt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-[var(--accent)]/20 bg-[var(--accent)]/[0.06] p-4">
          <div>
            <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Your timesheets are connected and empty</p>
            <p className="text-xs text-[var(--text-muted)]">Start a timer or add entries to build real data — or drop in a sample week (your own time, against your real clients) to explore the dashboards.</p>
          </div>
          <button onClick={loadSampleWeek} disabled={loadingSample} className="btn-secondary shrink-0">
            {loadingSample ? 'Adding…' : 'Load sample week'}
          </button>
        </div>
      )}

      {/* Scope + period controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegToggle<Scope>
          options={[{ value: 'me', label: 'My activity' }, { value: 'team', label: 'Whole firm' }]}
          value={scope} onChange={setScope}
        />
        <SegToggle<Period>
          options={[{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]}
          value={period} onChange={setPeriod}
        />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Time this week" value={fmtHours(t.total)} icon={Clock} tint="#6366F1" deltaRatio={dTotal.ratio} sub="vs last week" />
        <KpiCard label="Billable" value={fmtPct(t.billablePct)} icon={Percent} tint="#10B981" sub={fmtDuration(t.billable)} />
        <KpiCard
          label="Utilisation" value={fmtPct(data.util)} icon={Gauge} tint="#8B5CF6"
          gauge={<RadialGauge value={data.util} color="#8B5CF6" label={fmtPct(data.util)} />}
        />
        <KpiCard
          label="Recovery rate" value={fmtPct(t.recoveryRate)} icon={Repeat2} tint="#0EA5E9"
          gauge={<RadialGauge value={t.recoveryRate} color="#0EA5E9" label={fmtPct(t.recoveryRate)} />}
        />
        <KpiCard label="Chargeable value" value={fmtGBPCompact(t.chargeablePence)} icon={PoundSterling} tint="#F59E0B" deltaRatio={dValue.ratio} sub="vs last week" />
        <KpiCard label="Unrecorded time" value={fmtDuration(data.unrecorded)} icon={AlarmClock} tint="#F43F5E" sub={`${suggestions.length} to confirm`} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Left / main */}
        <div className="space-y-5 xl:col-span-2">
          <GlassCard>
            <SectionHeader
              title="Weekly activity"
              subtitle={`${fmtHours(t.total)} logged · ${fmtPct(t.billablePct)} billable`}
            />
            <WeeklyActivityChart days={data.dayBuckets} targetHours={dailyTarget} />
          </GlassCard>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <DonutPanel title="Time by client" subtitle="Where the week went" rows={data.clientRows} centerLabel="Total" />
            <DonutPanel title="Time by department" subtitle="Across the practice" rows={data.deptRows} centerLabel="Total" />
          </div>

          <RecentEntries entries={recent} />
        </div>

        {/* Right / rail */}
        <div className="space-y-5">
          <AiSuggestionsPanel />
          <TeamCapacityPanel rows={data.staffRows} />
          <StaffLeaderboard rows={data.staffRows} />
        </div>
      </div>
    </div>
  );
}
