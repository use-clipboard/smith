'use client';

/**
 * DashboardDataProvider — fetches the dashboard's shared data ONCE and hands it
 * to the hero + widgets, instead of every widget firing its own request on
 * mount. Replaces ~6 calls with 3:
 *   • /api/dashboard/summary   — tasks, needsAttention, deadlines (one DB call)
 *   • /api/email/unread        — unread count (external, email module only)
 *   • /api/calendar/reminders  — today's events (external, calendar module only)
 *
 * Widgets read via useDashboardData(). The hook returns `null` when no provider
 * is mounted, so widgets can keep a self-fetch fallback for standalone use.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { useModules } from '@/components/ui/ModulesProvider';

export interface TaskCounts { overdue: number; dueWithin7: number; dueWithin30: number; }
export interface NeedsAttentionClient {
  clientId: string; name: string; clientRef: string | null;
  status: 'overdue' | 'due-soon'; reason: string;
}
export interface DeadlineItem { id: string; title: string; subtitle: string; dateISO: string; days: number; }
export interface CalEvent { id: string; title: string; start: string; }

export interface HrCounts { holidaysToApprove: number; briefingsToRead: number; }

export interface DashboardData {
  loading: boolean;
  tasks: TaskCounts | null;
  needsAttention: NeedsAttentionClient[] | null;
  deadlines: DeadlineItem[] | null;
  emails: number | null;          // null = module off / not loaded
  calendar: { connected: boolean; events: CalEvent[] } | null;
  hr: HrCounts | null;            // null = HR module off
  notifications: number | null;   // unread header notifications
}

const Ctx = createContext<DashboardData | null>(null);

/** Returns the shared dashboard data, or null if no provider is mounted. */
export function useDashboardData(): DashboardData | null {
  return useContext(Ctx);
}

export default function DashboardDataProvider({ children }: { children: React.ReactNode }) {
  const { isModuleActive } = useModules();
  const hasEmail = isModuleActive('email-triage');
  const hasCal = isModuleActive('google-calendar');
  const hasHr = isModuleActive('hr');

  const [data, setData] = useState<DashboardData>({
    loading: true, tasks: null, needsAttention: null, deadlines: null, emails: null, calendar: null, hr: null, notifications: null,
  });

  useEffect(() => {
    let active = true;
    async function load() {
      const [summary, emails, calendar, hr] = await Promise.all([
        fetch('/api/dashboard/summary').then(r => r.ok ? r.json() : null).catch(() => null),
        hasEmail
          ? fetch('/api/email/unread').then(r => r.ok ? r.json() : null).catch(() => null)
          : Promise.resolve(null),
        hasCal
          ? fetch('/api/calendar/reminders').then(r => r.ok ? r.json() : null).catch(() => null)
          : Promise.resolve(null),
        hasHr
          ? fetch('/api/hr/badge-counts').then(r => r.ok ? r.json() : null).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!active) return;
      setData({
        loading: false,
        tasks: summary?.tasks ?? { overdue: 0, dueWithin7: 0, dueWithin30: 0 },
        needsAttention: summary?.needsAttention ?? [],
        deadlines: summary?.deadlines ?? [],
        emails: hasEmail ? (emails?.count ?? 0) : null,
        calendar: hasCal ? { connected: calendar?.connected ?? false, events: calendar?.events ?? [] } : null,
        hr: hasHr ? { holidaysToApprove: hr?.pendingApprovals ?? 0, briefingsToRead: hr?.newBriefings ?? 0 } : null,
        notifications: summary?.notifications ?? 0,
      });
    }
    load();
    return () => { active = false; };
  }, [hasEmail, hasCal, hasHr]);

  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}
