// Shared types + defaults + loader for the firm's on-hold / inactive client
// policy. One source of truth used by:
//   - /api/tasks/settings/client-status-policy   (read / update)
//   - /api/clients/[id] PATCH                    (trigger side-effects on
//                                                 status transitions)
//   - /api/tasks                                 (apply hide-from-default
//                                                 filter on the server)
//   - components/features/tasks/*                (grey-out / overdue-count
//                                                 / show-on-hold toggle)

import type { SupabaseClient } from '@supabase/supabase-js';

export interface TaskOnHoldPolicy {
  pause_recurrence:     boolean;
  exclude_from_overdue: boolean;
  grey_out_rows:        boolean;
  hide_from_default:    boolean;
}

export interface TaskInactivePolicy {
  auto_cancel_open: boolean;
  break_ch_links:   boolean;
  hide_from_default: boolean;
}

export interface TaskClientStatusPolicy {
  on_hold:  TaskOnHoldPolicy;
  inactive: TaskInactivePolicy;
}

export const DEFAULT_POLICY: TaskClientStatusPolicy = {
  on_hold: {
    pause_recurrence:     true,
    exclude_from_overdue: true,
    grey_out_rows:        true,
    hide_from_default:    true,
  },
  inactive: {
    auto_cancel_open:  true,
    break_ch_links:    true,
    hide_from_default: true,
  },
};

/** Merge a partial policy from the DB on top of defaults so missing fields
 *  fall back gracefully (handy when we add new toggles later). */
export function normalisePolicy(raw: unknown): TaskClientStatusPolicy {
  const r = (raw ?? {}) as Partial<TaskClientStatusPolicy>;
  return {
    on_hold:  { ...DEFAULT_POLICY.on_hold,  ...(r.on_hold  ?? {}) },
    inactive: { ...DEFAULT_POLICY.inactive, ...(r.inactive ?? {}) },
  };
}

/** Load the firm's policy. Returns defaults when the row hasn't been
 *  upgraded yet (older DB without the column). */
export async function loadFirmPolicy(supabase: SupabaseClient, firmId: string): Promise<TaskClientStatusPolicy> {
  const { data } = await supabase
    .from('firms')
    .select('task_client_status_policy')
    .eq('id', firmId)
    .maybeSingle();
  return normalisePolicy((data as { task_client_status_policy?: unknown } | null)?.task_client_status_policy);
}
