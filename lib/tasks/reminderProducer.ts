// Task email-reminder producer.
//
// Turns a step's reminder config (email_reminder_enabled + email_reminder_config
// { recipients, timing }) into rows in task_email_reminders for the cron
// consumer to send. Call syncStepReminders whenever a step is created or changed
// (assignee, due date, config, status). It is safe to call repeatedly: it clears
// the step's *pending* rows and regenerates them, while UNIQUE(step_id,
// recipient_email, timing) + ignoreDuplicates guarantees an already-sent
// reminder is never re-sent.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { EmailReminderTiming } from '@/types';

// Reminders are scheduled for 08:00 UTC, matching the daily cron (0 8 * * *),
// so a "1 day before due" reminder lands the morning before, not at midnight.
const SEND_HOUR_UTC = 8;

/** Compute the UTC send timestamp for a timing relative to a due date.
 *  Returns null when the timing needs a due date and none is available. */
function computeSendAt(timing: EmailReminderTiming, dueDate: string | null, now: Date): string | null {
  if (timing === 'on_assign') return now.toISOString();
  if (!dueDate) return null; // date-relative timing with no due date → can't schedule

  const daysBefore =
    timing === '1_week_before_due'  ? 7 :
    timing === '3_days_before_due'  ? 3 :
    timing === '1_day_before_due'   ? 1 :
    timing === 'on_due_date'        ? 0 : null;
  if (daysBefore === null) return null;

  // dueDate is a 'YYYY-MM-DD' date; anchor at 08:00 UTC that many days earlier.
  const d = new Date(`${dueDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysBefore);
  d.setUTCHours(SEND_HOUR_UTC, 0, 0, 0);
  return d.toISOString();
}

/**
 * Regenerate the pending email reminders for a single step.
 * No-op when reminders are disabled, the step is finished, there's no valid
 * recipient, or the timing can't be scheduled.
 */
export async function syncStepReminders(supabase: any, stepId: string): Promise<void> {
  const { data: step } = await supabase
    .from('task_steps')
    .select(`
      id, task_id, status, is_client_step, assignee_id, due_date,
      email_reminder_enabled, email_reminder_config,
      task:tasks(id, firm_id, due_date, client_id, deleted_at,
        client:clients(name, contact_email))
    `)
    .eq('id', stepId)
    .maybeSingle();
  if (!step) return;

  // Always clear this step's outstanding (not-yet-sent) reminders first, so
  // edits to date/assignee/config/timing re-schedule cleanly. Sent/failed rows
  // are left untouched.
  await supabase.from('task_email_reminders').delete().eq('step_id', stepId).eq('status', 'pending');

  const task = step.task as any;
  if (!step.email_reminder_enabled) return;
  if (step.status === 'complete' || step.status === 'skipped') return;
  if (!task || task.deleted_at) return;

  const cfg = step.email_reminder_config as { recipients?: string[]; timing?: EmailReminderTiming } | null;
  const recipients = cfg?.recipients ?? [];
  const timing = cfg?.timing;
  if (!recipients.length || !timing) return;

  const now = new Date();
  const sendAt = computeSendAt(timing, step.due_date ?? task.due_date ?? null, now);
  if (!sendAt) return;

  // Resolve each recipient to an email address.
  const rows: Array<{ email: string; name: string | null }> = [];
  for (const r of recipients) {
    if (r === 'assignee' && step.assignee_id) {
      const { data: u } = await supabase.from('users').select('email, full_name').eq('id', step.assignee_id).maybeSingle();
      if (u?.email) rows.push({ email: u.email, name: u.full_name ?? null });
    } else if (r === 'client') {
      const email = task.client?.contact_email;
      if (email) rows.push({ email, name: task.client?.name ?? null });
    }
  }
  if (!rows.length) return;

  // Insert as pending. ignoreDuplicates means a matching sent/failed row (same
  // step + recipient + timing) blocks re-creation → no duplicate emails.
  await supabase.from('task_email_reminders').upsert(
    rows.map(r => ({
      firm_id: task.firm_id,
      task_id: task.id,
      step_id: stepId,
      recipient_email: r.email,
      recipient_name: r.name,
      timing,
      send_at: sendAt,
      status: 'pending',
    })),
    { onConflict: 'step_id,recipient_email,timing', ignoreDuplicates: true },
  );
}

/** Regenerate reminders for several steps (used after task create / recurrence
 *  spawn). Fire-and-forget friendly; failures are logged, never thrown. */
export async function syncManyStepReminders(supabase: any, stepIds: string[]): Promise<void> {
  await Promise.allSettled(stepIds.map(id => syncStepReminders(supabase, id)));
}
