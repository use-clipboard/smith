'use client';

/**
 * DashboardDataProvider — fetches the dashboard's shared data ONCE and hands it
 * to the hero + widgets, instead of every widget firing its own request on
 * mount:
 *   • /api/dashboard/summary   — needsAttention, deadlines, notifications (one DB call)
 *   • /api/calendar/reminders  — today's events (external, calendar module only)
 *   • /api/hr/badge-counts     — holiday approvals + briefings (HR module only)
 *
 * Email + task counts are NOT fetched here — they're owned app-wide by
 * EmailCountProvider / TasksCountProvider (one fetch each, shared with the
 * sidebar badges), read via useEmailCount() / useTasksCount().
 *
 * Widgets read via useDashboardData(). The hook returns `null` when no provider
 * is mounted, so widgets can keep a self-fetch fallback for standalone use.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { useModules } from '@/components/ui/ModulesProvider';

export interface NeedsAttentionClient {
  clientId: string; name: string; clientRef: string | null;
  status: 'overdue' | 'due-soon'; reason: string;
}
export interface DeadlineItem { id: string; title: string; subtitle: string; dateISO: string; days: number; }
export interface CalEvent { id: string; title: string; start: string; }

export interface HrCounts { holidaysToApprove: number; briefingsToRead: number; }

export interface DashboardData {
  loading: boolean;
  needsAttention: NeedsAttentionClient[] | null;
  deadlines: DeadlineItem[] | null;
  calendar: { connected: boolean; events: CalEvent[] } | null;
  hr: HrCounts | null;            // null = HR module off
}

const Ctx = createContext<DashboardData | null>(null);

/** Returns the shared dashboard data, or null if no provider is mounted. */
export function useDashboardData(): DashboardData | null {
  return useContext(Ctx);
}

export default function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const { isModuleActive } = useModules();
  const hasCal = isModuleActive('google-calendar');
  const hasHr = isModuleActive('hr');

  const [data, setData] = useState<DashboardData>({
    loading: true, needsAttention: null, deadlines: null, calendar: null, hr: null,
  });

  useEffect(() => {
    let active = true;

    // Fire each source independently and merge as it lands, rather than awaiting
    // them together — otherwise the slow external calls (Gmail, Google Calendar)
    // hold the whole briefing on a skeleton even though the internal DB summary
    // is ready in a fraction of the time.

    // ── Internal DB summary — fast; unblocks the briefing on its own. ─────────
    fetch('/api/dashboard/summary')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(summary => {
        if (!active) return;
        setData(prev => ({
          ...prev,
          loading: false,
          needsAttention: summary?.needsAttention ?? [],
          deadlines: summary?.deadlines ?? [],
        }));
      });

    // ── External integrations — slower; fill in independently. ───────────────
    if (hasCal) {
      fetch('/api/calendar/reminders')
        .then(r => r.ok ? r.json() : null).catch(() => null)
        .then(d => { if (active) setData(prev => ({ ...prev, calendar: { connected: d?.connected ?? false, events: d?.events ?? [] } })); });
    }
    if (hasHr) {
      fetch('/api/hr/badge-counts')
        .then(r => r.ok ? r.json() : null).catch(() => null)
        .then(d => { if (active) setData(prev => ({ ...prev, hr: { holidaysToApprove: d?.pendingApprovals ?? 0, briefingsToRead: d?.newBriefings ?? 0 } })); });
    }

    return () => { active = false; };
  }, [hasCal, hasHr]);

  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}
