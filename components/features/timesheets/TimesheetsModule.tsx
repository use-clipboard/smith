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
import { fmtStopwatch, timerElapsedMs } from '@/lib/timesheets/format';

const BASE_TABS: { id: TimesheetTab; label: string; icon: typeof Clock }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'my_timesheet', label: 'My Timesheet', icon: CalendarRange },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Rates', icon: SlidersHorizontal },
];

export default function TimesheetsModule() {
  const { ready, timers, nowMs, canAddTimer, isAdmin, hasReports, weekStatuses, userId, approvalMode, openStartModal } = useTimesheets();
  const [tab, setTab] = useState<TimesheetTab>('overview');
  // The timer currently counting (if any) — shown live in the header.
  const activeTimer = timers.find(t => !t.paused) ?? null;

  // The Approvals tab stays visible for admins/managers, but the PENDING COUNT
  // must match what the user can actually approve under the firm's approval mode
  // (and the Approvals list itself): in 'admins' mode any admin approves every
  // submitted week; in 'manager' mode a manager approves only the weeks routed to
  // them — so an admin who manages no one correctly shows 0 (no `isAdmin ||`).
  const isManager = hasReports || Object.values(weekStatuses).some(w => w.managerId === userId);
  const canApprove = isAdmin || isManager;
  const canSeeApproval = (w: { managerId: string | null }) =>
    approvalMode === 'admins' ? isAdmin : w.managerId === userId;
  const pendingApprovals = Object.values(weekStatuses)
    .filter(w => w.status === 'submitted' && canSeeApproval(w)).length;
  const tabs = canApprove
    ? [...BASE_TABS, { id: 'approvals' as TimesheetTab, label: 'Approvals', icon: ShieldCheck }]
    : BASE_TABS;

  const headerRight = (
    <div className="flex items-center gap-2">
      {activeTimer && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: `${activeTimer.color}1A` }}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: activeTimer.color }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: activeTimer.color }} />
          </span>
          <span className="font-mono text-[13px] font-bold tabular-nums" style={{ color: activeTimer.color }}>{fmtStopwatch(timerElapsedMs(activeTimer, nowMs))}</span>
          <span className="max-w-[120px] truncate text-[12px] text-[var(--text-secondary)]">{activeTimer.label || activeTimer.clientName || 'Internal'}</span>
        </div>
      )}
      <button onClick={openStartModal} disabled={!canAddTimer} className="btn-primary disabled:opacity-50">
        <Play size={15} /> {timers.length > 0 ? 'New timer' : 'Start timer'}
      </button>
    </div>
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
