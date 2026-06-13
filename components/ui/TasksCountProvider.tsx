'use client';

/**
 * TasksCountProvider — the single owner of the signed-in user's task workload
 * counts for the whole app. Sits at the top of the shell so the sidebar Tasks
 * badge, the dashboard briefing and the dashboard Tasks widget all read ONE
 * shared result instead of each computing it separately.
 *
 * The count is non-trivial to compute server-side (it paginates the user's
 * task_steps then batch-fetches the live tasks — see /api/tasks/my-count), and
 * it was previously done twice per dashboard load: once for the sidebar badge
 * and again inside /api/dashboard/summary for the hero. This provider collapses
 * that to a single call, polled every 2 minutes (matching the old sidebar poll).
 *
 * Counts are null until the first load resolves, so consumers can show a
 * loading state rather than a misleading 0.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useModules } from './ModulesProvider';
import { createClient } from '@/lib/supabase';

export interface TaskCounts {
  count: number;        // total live tasks assigned to me
  overdue: number;      // due before today
  dueWithin7: number;   // due within the next 7 days
  dueWithin30: number;  // due within the next 30 days
}

interface TasksCountValue {
  counts: TaskCounts | null; // null = module off / not yet loaded
  refresh: () => void;
}

const ZERO: TaskCounts = { count: 0, overdue: 0, dueWithin7: 0, dueWithin30: 0 };
const Ctx = createContext<TasksCountValue>({ counts: null, refresh: () => {} });

/** Shared task workload counts. Safe to call anywhere under the app shell. */
export function useTasksCount(): TasksCountValue {
  return useContext(Ctx);
}

export default function TasksCountProvider({ children }: { children: React.ReactNode }) {
  const { isModuleActive } = useModules();
  const active = isModuleActive('tasks');
  const supabase = createClient();

  const [counts, setCounts] = useState<TaskCounts | null>(null);

  const refresh = useCallback(() => {
    if (!active) return;
    fetch('/api/tasks/my-count')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => {
        if (!d) return;
        setCounts({
          count: d.count ?? 0,
          overdue: d.overdue ?? 0,
          dueWithin7: d.dueWithin7 ?? 0,
          dueWithin30: d.dueWithin30 ?? 0,
        });
      });
  }, [active]);

  // Debounce bursts of realtime events (a bulk task update fires many) into a
  // single recount shortly after the dust settles.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshDebounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 300);
  }, [refresh]);

  // Initial fetch + a safety-net poll (realtime below is the primary path; this
  // covers a dropped socket or the pre-migration window before realtime is on).
  useEffect(() => {
    if (!active) { setCounts(null); return; }
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [active, refresh]);

  // Realtime: recount the moment a task or step changes (completed, created,
  // reassigned, due-date edited) — yours or a teammate's. RLS scopes the stream
  // to this firm, so no filter is needed. This is what makes "complete a task →
  // badge drops" feel instant across the sidebar, hero and widget.
  useEffect(() => {
    if (!active) return;
    const channel = supabase
      .channel('tasks-count-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => refreshDebounced())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_steps' }, () => refreshDebounced())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [active, supabase, refreshDebounced]);

  return <Ctx.Provider value={{ counts, refresh }}>{children}</Ctx.Provider>;
}

/** Convenience: counts with a zero fallback, for consumers that don't care about loading. */
export function useTaskCountsOrZero(): TaskCounts {
  return useTasksCount().counts ?? ZERO;
}
