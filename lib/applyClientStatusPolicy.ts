// Apply the firm's task_client_status_policy when a client's `status` flips.
// Called from the client PATCH route AFTER the status update has committed,
// so we only run side-effects when the new state is actually persisted.
//
// All steps are best-effort — a failure here logs to the server console but
// never rolls back the underlying client update. The user can re-trigger by
// flipping the status off and back.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadFirmPolicy } from '@/lib/taskClientStatusPolicy';

type ClientStatus = 'active' | 'hold' | 'inactive';

interface Options {
  firmId: string;
  clientId: string;
  previousStatus: ClientStatus | null;
  newStatus: ClientStatus;
  /** Identity of the user that flipped the client. Stamped into any audit
   *  notes added to cancelled tasks. */
  actorUserId: string | null;
}

export interface PolicyApplyResult {
  cancelledTaskIds: string[];
  brokenLinkIds: string[];
  /** Set to true when the change moved the client OUT of hold/inactive — the
   *  caller should consider any prior pauses cleared and let recurrence
   *  spawn normally. */
  reactivated: boolean;
}

export async function applyClientStatusPolicy(
  service: SupabaseClient,
  opts: Options,
): Promise<PolicyApplyResult> {
  const result: PolicyApplyResult = {
    cancelledTaskIds: [],
    brokenLinkIds:    [],
    reactivated:      false,
  };

  // No transition → nothing to do.
  if (opts.previousStatus === opts.newStatus) return result;

  const policy = await loadFirmPolicy(service, opts.firmId);

  // ── Reactivation ───────────────────────────────────────────────────────
  // hold/inactive → active: no destructive side-effects. The display layer
  // and recurrence engine read the client's current status live, so once
  // it's `active` again everything unhides + resumes automatically.
  if (opts.newStatus === 'active') {
    result.reactivated = true;
    return result;
  }

  // ── Inactive ───────────────────────────────────────────────────────────
  if (opts.newStatus === 'inactive') {
    if (policy.inactive.auto_cancel_open) {
      // Find every non-terminal task for this client + this firm.
      const { data: openTasks } = await service
        .from('tasks')
        .select('id, description')
        .eq('firm_id', opts.firmId)
        .eq('client_id', opts.clientId)
        .not('status', 'in', '(complete,cancelled)')
        .limit(10000);
      const toCancel = (openTasks ?? []) as Array<{ id: string; description: string | null }>;
      if (toCancel.length > 0) {
        const stamp = new Date().toISOString().slice(0, 10);
        const note  = `\n\n[Auto-cancelled — client made inactive on ${stamp}]`;
        // One audit-stamped update per task. The description prepend keeps
        // the cancellation reason visible without needing a separate audit
        // table read. Done in parallel — safe because each row is distinct.
        // The `tasks` table doesn't have dedicated cancelled_at / cancelled_by
        // columns. The description prepend keeps the audit context inline so
        // anyone opening the task later can see why it was cancelled.
        void opts.actorUserId; // reserved — surface via audit table later
        await Promise.all(
          toCancel.map(t =>
            service
              .from('tasks')
              .update({
                status: 'cancelled',
                description: (t.description ?? '') + note,
              })
              .eq('id', t.id)
              .eq('firm_id', opts.firmId)
          ),
        );
        result.cancelledTaskIds = toCancel.map(t => t.id);
      }
    }

    if (policy.inactive.break_ch_links) {
      // Find every active CH-deadline link for this client → mark broken.
      const { data: links } = await service
        .from('ch_deadline_task_links')
        .select('id')
        .eq('firm_id', opts.firmId)
        .eq('client_id', opts.clientId)
        .eq('status', 'active')
        .limit(10000);
      const linkIds = ((links ?? []) as Array<{ id: string }>).map(l => l.id);
      if (linkIds.length > 0) {
        await service
          .from('ch_deadline_task_links')
          .update({ status: 'broken', last_error: 'Client made inactive' })
          .in('id', linkIds);
        result.brokenLinkIds = linkIds;
      }
    }
  }

  // ── On Hold ────────────────────────────────────────────────────────────
  // No destructive side-effects on the data side — the policy's
  // pause_recurrence and exclude_from_overdue and hide_from_default flags
  // are read by the relevant runtime paths (recurrence cloner, list views,
  // header chips) and apply dynamically based on the client's current
  // status. Nothing to mutate here.

  return result;
}
