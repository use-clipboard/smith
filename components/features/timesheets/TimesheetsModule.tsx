'use client';

import { useEffect, useState } from 'react';
import { Clock, LayoutDashboard, CalendarRange, BarChart3, SlidersHorizontal, ShieldCheck, Play, Sparkles, Timer, Wand2 } from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import { useTimesheets } from './TimesheetsProvider';
import type { TimesheetTab } from '@/lib/timesheets/types';
import OverviewDashboard from './overview/OverviewDashboard';
import MyTimesheet from './mytimesheet/MyTimesheet';
import Reports from './reports/Reports';
import RatesSettings from './settings/RatesSettings';
import Approvals from './approvals/Approvals';
import TimerStartModal from './timer/TimerStartModal';
import { fmtStopwatch } from '@/lib/timesheets/format';

const BASE_TABS: { id: TimesheetTab; label: string; icon: typeof Clock }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'my_timesheet', label: 'My Timesheet', icon: CalendarRange },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Rates', icon: SlidersHorizontal },
];

export default function TimesheetsModule() {
  const { ready, allowed, ensureSeeded, timer, elapsedMs, isAdmin, weekStatuses, userId } = useTimesheets();
  const [tab, setTab] = useState<TimesheetTab>('overview');
  const [startingTimer, setStartingTimer] = useState(false);

  useEffect(() => { if (ready && allowed) ensureSeeded(); }, [ready, allowed, ensureSeeded]);

  // Preview gate — non-allowed users see a teaser while Timesheets is in "Soon".
  if (!allowed) {
    return (
      <ToolLayout title="Timesheets" description="AI-assisted time recording for accountancy firms." icon={Clock} iconColor="#7C3AED">
        <div className="mx-auto mt-6 max-w-lg">
          <div className="overflow-hidden rounded-[24px] border border-white/60 bg-white/70 text-center shadow-[0_8px_32px_rgba(31,38,88,0.10)] backdrop-blur-md">
            <div className="relative flex flex-col items-center gap-3 px-8 py-10"
              style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
              <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur"><Clock size={28} className="text-white" /></div>
              <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">Coming soon</span>
              <h2 className="text-xl font-bold text-white">Timesheets is almost here</h2>
              <p className="max-w-sm text-[13px] text-white/80">A time-recording tool that feels like an intelligent assistant — quietly capturing work as it happens, so you just confirm it.</p>
            </div>
            <div className="grid grid-cols-1 gap-3 px-8 py-7 sm:grid-cols-3">
              {[
                { icon: Timer, label: 'One-click timer', sub: 'Track any client in a tap' },
                { icon: Wand2, label: 'AI suggestions', sub: 'Work captured automatically' },
                { icon: Sparkles, label: 'Live insights', sub: 'Utilisation & recovery at a glance' },
              ].map(f => (
                <div key={f.label} className="flex flex-col items-center gap-1.5 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><f.icon size={18} /></div>
                  <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{f.sub}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-black/5 px-8 py-4">
              <p className="text-[12px] text-[var(--text-muted)]">We&apos;re polishing it now — it&apos;ll appear here for your firm shortly.</p>
            </div>
          </div>
        </div>
      </ToolLayout>
    );
  }

  // Admins approve anyone (and any week with no manager); managers approve
  // weeks routed to them.
  const isManager = Object.values(weekStatuses).some(w => w.managerId === userId);
  const canApprove = isAdmin || isManager;
  const pendingApprovals = Object.values(weekStatuses)
    .filter(w => w.status === 'submitted' && (isAdmin || w.managerId === userId)).length;
  const tabs = canApprove
    ? [...BASE_TABS, { id: 'approvals' as TimesheetTab, label: 'Approvals', icon: ShieldCheck }]
    : BASE_TABS;

  const headerRight = timer.running ? (
    <div className="flex items-center gap-2 rounded-xl bg-[var(--accent)]/10 px-3 py-2">
      <span className="relative flex h-2 w-2">
        {!timer.paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />}
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
      </span>
      <span className="font-mono text-[13px] font-bold tabular-nums text-[var(--accent)]">{fmtStopwatch(elapsedMs)}</span>
      <span className="max-w-[120px] truncate text-[12px] text-[var(--text-secondary)]">{timer.clientName || 'Internal'}</span>
    </div>
  ) : (
    <button onClick={() => setStartingTimer(true)} className="btn-primary"><Play size={15} /> Start timer</button>
  );

  return (
    <ToolLayout
      title="Timesheets"
      description="Track your time, manage tasks and see firm performance at a glance."
      icon={Clock}
      iconColor="#7C3AED"
      wide
      headerRight={headerRight}
    >
      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-black/5">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[13.5px] font-semibold transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
              {t.id === 'approvals' && pendingApprovals > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{pendingApprovals}</span>
              )}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />}
            </button>
          );
        })}
      </div>

      {!ready ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-[20px] bg-white/50" />)}
        </div>
      ) : (
        <>
          {tab === 'overview' && <OverviewDashboard />}
          {tab === 'my_timesheet' && <MyTimesheet />}
          {tab === 'reports' && <Reports />}
          {tab === 'settings' && <RatesSettings />}
          {tab === 'approvals' && canApprove && <Approvals />}
        </>
      )}

      {startingTimer && <TimerStartModal onClose={() => setStartingTimer(false)} />}
    </ToolLayout>
  );
}
