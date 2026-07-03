'use client';

import { useState } from 'react';
import { Clock, LayoutDashboard, CalendarRange, BarChart3, SlidersHorizontal, ShieldCheck, Play } from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import { useTimesheets } from './TimesheetsProvider';
import type { TimesheetTab } from '@/lib/timesheets/types';
import OverviewDashboard from './overview/OverviewDashboard';
import MyTimesheet from './mytimesheet/MyTimesheet';
import Reports from './reports/Reports';
import RatesSettings from './settings/RatesSettings';
import Approvals from './approvals/Approvals';
import { fmtStopwatch } from '@/lib/timesheets/format';

const BASE_TABS: { id: TimesheetTab; label: string; icon: typeof Clock }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'my_timesheet', label: 'My Timesheet', icon: CalendarRange },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Rates', icon: SlidersHorizontal },
];

export default function TimesheetsModule() {
  const { ready, timer, elapsedMs, isAdmin, hasReports, weekStatuses, userId, openStartModal } = useTimesheets();
  const [tab, setTab] = useState<TimesheetTab>('overview');

  // Admins approve anyone (and any week with no manager); managers approve
  // weeks routed to them.
  const isManager = hasReports || Object.values(weekStatuses).some(w => w.managerId === userId);
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
    <button onClick={openStartModal} className="btn-primary"><Play size={15} /> Start timer</button>
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
    </ToolLayout>
  );
}
