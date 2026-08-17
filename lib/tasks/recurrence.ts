// Shared recurrence logic for tasks.
//
// A recurring task spawns its next occurrence when it transitions INTO the
// 'complete' status. That transition can happen two ways:
//   • the task PUT route (status set directly, or via "complete all")
//   • syncTaskStatus in the step PUT route (last step ticked → task auto-completes)
// Both call spawnNextRecurrence, so the logic lives here once.
//
// spawnNextRecurrence is idempotent per parent: it refuses to create a second
// child for the same completed task, which guards against the two paths (or
// concurrent step ticks) both firing for one completion.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { syncManyStepReminders } from '@/lib/tasks/reminderProducer';

export function computeNextDueDate(
  currentDue: string | null,
  recType: string,
  intervalDays: number | null,
): string | null {
  // Anchor at UTC midnight so the arithmetic and the YYYY-MM-DD output never
  // drift by a day across server timezones.
  const base = currentDue ? new Date(`${currentDue}T00:00:00Z`) : new Date();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();

  const addDays = (n: number): Date => {
    const x = new Date(base.getTime());
    x.setUTCDate(x.getUTCDate() + n);
    return x;
  };
  // Add whole months, clamping the day to the target month's last day so
  // e.g. 31 Jan + 1 month → 28 Feb (not 3 Mar) and 29 Feb + 12 months → 28 Feb.
  const addMonths = (n: number): Date => {
    const idx = m + n;
    const ty = y + Math.floor(idx / 12);
    const tm = ((idx % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tm, Math.min(d, lastDay)));
  };

  let next: Date;
  switch (recType) {
    case 'weekly':       next = addDays(7); break;
    case 'bi-weekly':    next = addDays(14); break;
    case 'four-weekly':  next = addDays(28); break;
    case 'monthly':      next = addMonths(1); break;
    case 'quarterly':    next = addMonths(3); break;
    case 'annually':     next = addMonths(12); break; // +12 months clamps 29 Feb → 28 Feb
    case 'custom':       next = addDays(intervalDays ?? 30); break;
    default:             return null;
  }
  return next.toISOString().split('T')[0];
}

/**
 * Create the next occurrence of a completed recurring task, cloning its steps
 * and edges. No-op if the task isn't recurring or has already spawned a child.
 */
export async function spawnNextRecurrence(
  supabase: any,
  completedTaskId: string,
  firmId: string,
  userId: string,
): Promise<void> {
  const { data: completed } = await supabase
    .from('tasks')
    .select('*, steps:task_steps(*), edges:task_step_edges(*)')
    .eq('id', completedTaskId)
    .single();

  if (!completed) return;
  if (!completed.recurrence_type || completed.recurrence_type === 'once') return;

  // Idempotency: a task spawns its next occurrence exactly once. If a child
  // already exists (the other completion path, or a concurrent step tick,
  // beat us to it) do nothing.
  const { count: existingChildren } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('parent_task_id', completedTaskId);
  if ((existingChildren ?? 0) > 0) return;

  const nextDue = computeNextDueDate(
    completed.due_date,
    completed.recurrence_type,
    completed.recurrence_interval_days,
  );

  const { data: newTask, error } = await supabase.from('tasks').insert({
    firm_id: firmId,
    client_id: completed.client_id,
    template_id: completed.template_id,
    created_by: userId || completed.created_by,
    title: completed.title,
    description: completed.description,
    status: 'not_started',
    due_date: nextDue,
    is_internal: completed.is_internal,
    recurrence_type: completed.recurrence_type,
    recurrence_interval_days: completed.recurrence_interval_days,
    parent_task_id: completedTaskId,
  }).select().single();

  if (error || !newTask) { console.error('spawnNextRecurrence', error); return; }

  if (completed.steps?.length > 0) {
    const { data: newSteps, error: stepErr } = await supabase.from('task_steps').insert(
      completed.steps.map((s: any) => ({
        task_id: newTask.id,
        // Carry template lineage forward so the "Custom" badge stays accurate
        template_step_id: s.template_step_id ?? null,
        step_key: s.step_key,
        title: s.title,
        description: s.description,
        assignee_id: s.assignee_id,
        is_client_step: s.is_client_step,
        // Workflow structure — without step_type the Start/End nodes degrade
        // into regular steps, which silently breaks the NEXT recurrence.
        step_type: s.step_type ?? 'regular',
        start_trigger_config: s.start_trigger_config ?? null,
        end_config: s.end_config ?? null,
        tool_module_id: s.tool_module_id,
        email_reminder_enabled: s.email_reminder_enabled,
        email_reminder_config: s.email_reminder_config,
        email_reminder_subject: s.email_reminder_subject ?? null,
        email_reminder_message: s.email_reminder_message ?? null,
        status_automation: s.status_automation ?? null,
        client_instructions: s.client_instructions ?? null,
        client_can_upload: s.client_can_upload ?? false,
        position_x: s.position_x,
        position_y: s.position_y,
        status: 'not_started',
      })),
    ).select('id, email_reminder_enabled, is_client_step');
    if (stepErr) console.error('spawnNextRecurrence steps', stepErr);

    // Mint a fresh client portal token for every cloned client step — without
    // this the recurring occurrence's client steps have no working portal link
    // (and their reminder emails would point at a dead URL). token + expires_at
    // use the DB defaults (gen_random_bytes + now()+30 days), same as create.
    const clientStepIds = (newSteps ?? []).filter((s: any) => s.is_client_step).map((s: any) => s.id);
    if (clientStepIds.length > 0) {
      const { error: tokenErr } = await supabase.from('task_client_tokens').insert(
        clientStepIds.map((stepId: string) => ({ task_id: newTask.id, step_id: stepId, firm_id: firmId })),
      );
      if (tokenErr) console.error('spawnNextRecurrence client tokens', tokenErr);
    }

    // Queue email reminders for the new occurrence's reminder-enabled steps.
    const reminderStepIds = (newSteps ?? []).filter((s: any) => s.email_reminder_enabled).map((s: any) => s.id);
    if (reminderStepIds.length > 0) {
      await syncManyStepReminders(supabase, reminderStepIds);
    }
  }

  if (completed.edges?.length > 0) {
    const { error: edgeErr } = await supabase.from('task_step_edges').insert(
      completed.edges.map((e: any) => ({
        task_id: newTask.id,
        from_step_key: e.from_step_key,
        to_step_key: e.to_step_key,
        label: e.label,
        // Carry the branch/timeout conditions so recurring instances keep
        // their workflow behaviour, not just their layout.
        condition_type: e.condition_type ?? null,
        condition_config: e.condition_config ?? null,
        source_handle: e.source_handle ?? null,
        target_handle: e.target_handle ?? null,
      })),
    );
    if (edgeErr) console.error('spawnNextRecurrence edges', edgeErr);
  }
}
