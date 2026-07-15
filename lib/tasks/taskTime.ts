// Bridge between the unified Timesheets ledger (time_entries) and the Tasks
// tool's TaskTimeEntry shape. Task time now lives in time_entries; these helpers
// map a time_entries row back to the shape the Tasks UI already consumes, so the
// UI components don't need to change.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaskTimeEntry } from '@/types';

export interface UnifiedTimeRow {
  id: string;
  task_id: string | null;
  step_id: string | null;
  user_id: string;
  entry_date: string;        // YYYY-MM-DD
  start_time: string | null; // 'HH:mm'
  minutes: number | null;
  notes: string | null;
  created_at: string;
  user?: { id: string; full_name: string | null; email: string } | null;
}

/** Columns to select from time_entries when serving task time.
 *  The users embed must name its foreign key: time_entries points at users
 *  twice (user_id and edited_by), so a bare `user:users(…)` is ambiguous and
 *  PostgREST rejects the whole request with PGRST201. */
export const UNIFIED_TIME_SELECT =
  'id, task_id, step_id, user_id, entry_date, start_time, minutes, notes, created_at, user:users!time_entries_user_id_fkey(id, full_name, email)';

/** A time_entries row → the TaskTimeEntry shape the Tasks UI expects. */
export function unifiedRowToTaskTimeEntry(r: UnifiedTimeRow): TaskTimeEntry {
  const start = r.start_time && r.start_time !== '—' ? r.start_time : '00:00';
  const startedAt = `${r.entry_date}T${start}:00`;
  const endedAt = new Date(new Date(startedAt).getTime() + (r.minutes ?? 0) * 60000).toISOString();
  return {
    id: r.id,
    task_id: r.task_id ?? '',
    step_id: r.step_id ?? null,
    user_id: r.user_id,
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: r.minutes ?? null,
    notes: r.notes ?? null,
    created_at: r.created_at,
    user: r.user ?? null,
  };
}

/** True if a Supabase error means the unified columns/table aren't there yet
 *  (undefined column / relation), so callers can fall back to task_time_entries.
 *
 *  Codes only. This used to also match any message mentioning task_id/step_id/
 *  time_entries, which swallowed unrelated failures — an ambiguous embed, an RLS
 *  denial — as "not migrated yet" and silently wrote task time to the legacy
 *  table with nothing logged. Anything that isn't one of these codes should
 *  surface as a real error rather than a quiet fallback. */
export function isMissingSchema(error: { code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42703' || error.code === '42P01' || error.code === 'PGRST205';
}

/**
 * Load task time entries (TaskTimeEntry shape) grouped by task id, from the
 * unified ledger with a legacy fallback. Used by the task detail + history
 * routes so they no longer read task_time_entries directly.
 */
export async function loadTaskTimeEntriesByTask(
  supabase: SupabaseClient,
  taskIds: string[],
): Promise<Map<string, TaskTimeEntry[]>> {
  const map = new Map<string, TaskTimeEntry[]>();
  if (taskIds.length === 0) return map;

  const push = (e: TaskTimeEntry) => {
    const arr = map.get(e.task_id) ?? [];
    arr.push(e);
    map.set(e.task_id, arr);
  };

  const uni = await supabase
    .from('time_entries')
    .select(UNIFIED_TIME_SELECT)
    .in('task_id', taskIds)
    .order('entry_date', { ascending: false });

  if (!uni.error) {
    for (const r of (uni.data ?? []) as unknown as UnifiedTimeRow[]) push(unifiedRowToTaskTimeEntry(r));
    return map;
  }
  if (!isMissingSchema(uni.error)) return map; // unknown error → don't break the task load

  const leg = await supabase
    .from('task_time_entries')
    .select('*, user:users(id, full_name, email)')
    .in('task_id', taskIds)
    .order('started_at', { ascending: false });
  for (const r of (leg.data ?? []) as unknown as TaskTimeEntry[]) push(r);
  return map;
}
