// CH Secretarial — sync linked task due dates after a fresh refresh.
//
// Called after every ch_cache write (scheduled cron + manual refresh). For
// every active deadline → task link in the firm:
//
//   - If the client's CH number has changed since the link was created
//     (snapshot vs current), mark the link 'broken' with an explanatory
//     message. Don't touch the task — its due date is whatever it was last
//     set to.
//   - If the company isn't in the freshly-fetched data, or its deadline
//     for this type is null/missing, bump `consecutive_failures`. After 3
//     consecutive misses the link goes 'broken' (still doesn't touch the
//     task).
//   - If we have a real new deadline value:
//       · same as last_synced_deadline → no-op (status stays active,
//         consecutive_failures resets to 0).
//       · differs by < 90 days → slide: update tasks.due_date to
//         new_deadline + offset_days.
//       · differs by ≥ 90 days (annual renewal): auto-complete the
//         current task with an audit note + clone a fresh task for the
//         new cycle. Repoint the link at the clone.
//   - On any success path the link is set to 'active' with
//     consecutive_failures = 0, last_synced_deadline = newDeadline,
//     last_synced_at = now.
//
// Importantly: a null deadline NEVER triggers a renewal. The user
// explicitly asked for "no auto-renew when CH simply hasn't posted a new
// date" — the deadline passing without an update is for a human to review.
//
// Per-link errors are caught and logged. The function returns a small
// summary so callers (cron + manual refresh) can log how many links
// changed in this run.

import type { SupabaseClient } from '@supabase/supabase-js';

export type DeadlineType = 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due';

/** Forward-jump threshold for "this is an annual renewal" vs "this is a slide". */
const RENEWAL_THRESHOLD_DAYS = 90;
/** Consecutive refresh misses before a link is marked broken. */
const BROKEN_AFTER_FAILURES = 3;

/** Minimal company shape the sync reads. Matches the CH cache row JSONB. */
interface CHCompanyRow {
  companyNumber: string;
  accountsNextDue:       string | null;
  csNextDue:             string | null;
  nearestOfficerIdvDue:  string | null;
  nearestPscIdvDue:      string | null;
  status?:               string;
  error?:                unknown;
}

interface LinkRow {
  id: string;
  firm_id: string;
  client_id: string;
  task_id: string;
  deadline_type: DeadlineType;
  offset_days: number;
  last_synced_deadline: string | null;
  linked_company_number: string | null;
  consecutive_failures: number;
  status: 'active' | 'paused' | 'broken';
}

interface TaskRow {
  id: string;
  firm_id: string;
  client_id: string | null;
  created_by: string | null;
  template_id: string | null;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  recurrence_type: string | null;
  recurrence_interval_days: number | null;
}

function deadlineFor(c: CHCompanyRow, type: DeadlineType): string | null {
  switch (type) {
    case 'accounts_due':     return c.accountsNextDue;
    case 'cs_due':           return c.csNextDue;
    case 'officer_idv_due':  return c.nearestOfficerIdvDue;
    case 'psc_idv_due':      return c.nearestPscIdvDue;
  }
}

function readableDeadlineLabel(type: DeadlineType): string {
  switch (type) {
    case 'accounts_due':     return 'Accounts Due';
    case 'cs_due':           return 'Confirmation Statement Due';
    case 'officer_idv_due':  return 'Officer IDV Due';
    case 'psc_idv_due':      return 'PSC IDV Due';
  }
}

function daysBetweenIso(aIso: string, bIso: string): number {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function applyOffset(iso: string, offsetDays: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function normaliseCompanyNumber(n: string): string {
  return n.trim().toUpperCase().padStart(8, '0');
}

export interface SyncSummary {
  slid:     number;  // task date updated in-place
  renewed:  number;  // annual renewal — task auto-completed + clone created
  paused:   number;  // failure counter bumped, link still active
  broken:   number;  // newly marked broken this run
  unchanged: number; // no-op (deadline matched last_synced_deadline)
  skipped:  number;  // not relevant in this run (link already broken, etc.)
  failed:   number;  // unexpected error
}

/**
 * Per-firm sync. Pass the freshly-fetched companies (the same array about
 * to be written into ch_cache.companies). Returns a summary the caller can
 * log; throws nothing.
 */
export async function syncCHDeadlineLinks(
  supabase: SupabaseClient,
  firmId: string,
  companies: CHCompanyRow[],
): Promise<SyncSummary> {
  const summary: SyncSummary = { slid: 0, renewed: 0, paused: 0, broken: 0, unchanged: 0, skipped: 0, failed: 0 };

  // Only consider non-broken links. Broken links are inert until a human
  // intervenes (fixes the link or removes it).
  const { data: links } = await supabase
    .from('ch_deadline_task_links')
    .select('id, firm_id, client_id, task_id, deadline_type, offset_days, last_synced_deadline, linked_company_number, consecutive_failures, status')
    .eq('firm_id', firmId)
    .in('status', ['active', 'paused']);
  if (!links || links.length === 0) return summary;

  // Build the client_id → companies_house_id (current) map. If the current
  // value differs from the link's snapshot, we know the user changed the
  // CH number and the link must be broken.
  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, companies_house_id')
    .eq('firm_id', firmId)
    .in('id', Array.from(new Set((links as LinkRow[]).map(l => l.client_id))));
  const currentChByClient = new Map<string, string | null>();
  for (const c of (clientRows ?? []) as { id: string; companies_house_id: string | null }[]) {
    currentChByClient.set(c.id, c.companies_house_id);
  }

  // Index the refresh result by normalised CH number so we can look up
  // each company in O(1).
  const companyByCh = new Map<string, CHCompanyRow>();
  for (const co of companies) {
    if (co.companyNumber) companyByCh.set(normaliseCompanyNumber(co.companyNumber), co);
  }

  // Pull every referenced task once.
  const taskIds = Array.from(new Set((links as LinkRow[]).map(l => l.task_id)));
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, firm_id, client_id, created_by, template_id, title, description, status, due_date, recurrence_type, recurrence_interval_days')
    .in('id', taskIds);
  const taskById = new Map<string, TaskRow>();
  for (const t of (tasks ?? []) as TaskRow[]) taskById.set(t.id, t);

  for (const link of links as LinkRow[]) {
    try {
      // ── Guard: client's CH number changed since the link was created. ──
      const currentCh = currentChByClient.get(link.client_id) ?? null;
      const snapshot  = link.linked_company_number ?? null;
      if (currentCh && snapshot && normaliseCompanyNumber(currentCh) !== normaliseCompanyNumber(snapshot)) {
        await markBroken(supabase, link, `Client's Companies House number changed from ${snapshot} to ${currentCh}.`);
        summary.broken += 1;
        continue;
      }
      if (!currentCh) {
        // Client lost its CH number entirely — also break (the link no
        // longer has a Companies House record to follow).
        await markBroken(supabase, link, 'Client no longer has a Companies House number set.');
        summary.broken += 1;
        continue;
      }

      // ── Look up the freshly-fetched company. ──
      const company = companyByCh.get(normaliseCompanyNumber(snapshot ?? currentCh));
      if (!company || company.status === 'error') {
        // Missed this refresh (rate limit, CH outage, or per-company error).
        // Bump the failure counter; mark broken once the threshold is hit.
        await bumpFailure(supabase, link, company?.status === 'error' ? 'CH refresh returned an error for this company.' : 'Company missing from latest CH refresh.');
        if ((link.consecutive_failures ?? 0) + 1 >= BROKEN_AFTER_FAILURES) {
          summary.broken += 1;
        } else {
          summary.paused += 1;
        }
        continue;
      }
      const rawDeadline = deadlineFor(company, link.deadline_type);
      if (!rawDeadline) {
        // CH responded but didn't include a deadline of this type — equivalent
        // to a transient miss. Bumps the same counter; can also trip broken.
        await bumpFailure(supabase, link, `CH refresh did not include a ${readableDeadlineLabel(link.deadline_type)} value.`);
        if ((link.consecutive_failures ?? 0) + 1 >= BROKEN_AFTER_FAILURES) {
          summary.broken += 1;
        } else {
          summary.paused += 1;
        }
        continue;
      }

      // Live deadline available — successful sync. Reset failure counter +
      // status before deciding slide vs renewal.
      const task = taskById.get(link.task_id);
      if (!task) {
        // Task was deleted out from under us. Mark broken so the user
        // notices, and stop here — there's nothing to update.
        await markBroken(supabase, link, 'Linked task no longer exists.');
        summary.broken += 1;
        continue;
      }

      if (link.last_synced_deadline === rawDeadline) {
        // Already in sync. Still reset the counter + bump last_synced_at so
        // the link shows healthy in the UI.
        await markHealthy(supabase, link, rawDeadline);
        summary.unchanged += 1;
        continue;
      }

      const previous = link.last_synced_deadline;
      const newDue   = applyOffset(rawDeadline, link.offset_days);
      const renewal  = !!previous && daysBetweenIso(previous, rawDeadline) >= RENEWAL_THRESHOLD_DAYS;

      if (renewal) {
        // (a) Auto-complete current task with an audit note appended to
        //     its description so the user has a record of what we did.
        const auditNote = `\n\n— Auto-completed by SMITH on ${new Date().toISOString().slice(0, 10)}: Companies House ${readableDeadlineLabel(link.deadline_type)} rolled forward to ${rawDeadline}. A new task was created for the next cycle.`;
        const newDescription = (task.description ?? '') + auditNote;
        const { error: completeErr } = await supabase
          .from('tasks')
          .update({
            status:       'complete',
            completed_at: new Date().toISOString(),
            description:  newDescription,
            updated_at:   new Date().toISOString(),
          })
          .eq('id', task.id);
        if (completeErr) { summary.failed += 1; continue; }

        // (b) Clone a fresh task for the new cycle.
        const { data: cloned, error: cloneErr } = await supabase
          .from('tasks')
          .insert({
            firm_id:                  task.firm_id,
            client_id:                task.client_id,
            created_by:               task.created_by,
            template_id:              task.template_id,
            title:                    task.title,
            description:              task.description ?? null,
            status:                   'not_started',
            due_date:                 newDue,
            recurrence_type:          task.recurrence_type,
            recurrence_interval_days: task.recurrence_interval_days,
          })
          .select('id')
          .single();
        if (cloneErr || !cloned) { summary.failed += 1; continue; }

        // (b2) Clone the workflow — task_steps + task_step_edges. Without
        //      this every annual renewal would drop the user's step
        //      structure, which is silently wrong for any template-built
        //      task. Step statuses reset to 'not_started' so the new
        //      cycle isn't pre-completed by the previous run's state.
        await cloneTaskWorkflow(supabase, task.id, cloned.id);

        // (c) Repoint the link.
        await supabase
          .from('ch_deadline_task_links')
          .update({
            task_id:                cloned.id,
            last_synced_deadline:   rawDeadline,
            last_synced_at:         new Date().toISOString(),
            status:                 'active',
            consecutive_failures:   0,
            last_error:             null,
            updated_at:             new Date().toISOString(),
          })
          .eq('id', link.id);
        summary.renewed += 1;
      } else {
        // Slide: update existing task's due date.
        const { error: slideErr } = await supabase
          .from('tasks')
          .update({ due_date: newDue, updated_at: new Date().toISOString() })
          .eq('id', task.id);
        if (slideErr) { summary.failed += 1; continue; }

        // Backward-jump heads-up: if the new deadline is more than 30 days
        // *earlier* than the last-synced one, the user is going to be
        // surprised ("why is my August task suddenly due in March?"). This
        // is normal for Officer/PSC IDV when a new officer joins with an
        // earlier deadline — we append a small audit note so the surprise
        // explains itself.
        if (previous) {
          const delta = daysBetweenIso(previous, rawDeadline);
          if (delta <= -30) {
            const reason = link.deadline_type === 'officer_idv_due'
              ? "Officer IDV deadline brought forward — a new officer's IDV is due sooner than the previous earliest."
              : link.deadline_type === 'psc_idv_due'
                ? "PSC IDV deadline brought forward — a new PSC's IDV is due sooner than the previous earliest."
                : 'Companies House deadline brought forward.';
            const heads = `\n\n— SMITH (${new Date().toISOString().slice(0, 10)}): ${readableDeadlineLabel(link.deadline_type)} moved earlier by ${Math.abs(delta)} days, from ${previous} to ${rawDeadline}. ${reason}`;
            await supabase
              .from('tasks')
              .update({ description: (task.description ?? '') + heads, updated_at: new Date().toISOString() })
              .eq('id', task.id);
          }
        }

        await markHealthy(supabase, link, rawDeadline);
        summary.slid += 1;
      }
    } catch (e) {
      console.error('syncCHDeadlineLinks link', link.id, e);
      summary.failed += 1;
    }
  }

  return summary;
}

// ── Internal helpers ───────────────────────────────────────────────────

async function markHealthy(supabase: SupabaseClient, link: LinkRow, deadline: string): Promise<void> {
  await supabase
    .from('ch_deadline_task_links')
    .update({
      status:                 'active',
      consecutive_failures:   0,
      last_synced_deadline:   deadline,
      last_synced_at:         new Date().toISOString(),
      last_error:             null,
      updated_at:             new Date().toISOString(),
    })
    .eq('id', link.id);
}

async function bumpFailure(supabase: SupabaseClient, link: LinkRow, reason: string): Promise<void> {
  const nextCount = (link.consecutive_failures ?? 0) + 1;
  const willBreak = nextCount >= BROKEN_AFTER_FAILURES;
  await supabase
    .from('ch_deadline_task_links')
    .update({
      consecutive_failures: nextCount,
      status:               willBreak ? 'broken' : 'paused',
      last_error:           reason,
      last_synced_at:       new Date().toISOString(),
      updated_at:           new Date().toISOString(),
    })
    .eq('id', link.id);
}

/**
 * Copy a task's workflow (steps + edges) onto a new task id. Resets each
 * step's runtime state so the cloned workflow looks like a fresh one. Used
 * by the annual renewal path so step-based templates don't lose their
 * structure each year.
 */
async function cloneTaskWorkflow(supabase: SupabaseClient, fromTaskId: string, toTaskId: string): Promise<void> {
  // Steps — fetch, strip ids + completion state, insert against the new task.
  const { data: steps } = await supabase
    .from('task_steps')
    .select('template_step_id, step_key, title, description, assignee_id, is_client_step, tool_module_id, tool_output_id, email_reminder_enabled, email_reminder_config, email_reminder_subject, email_reminder_message, client_instructions, client_can_upload, position_x, position_y')
    .eq('task_id', fromTaskId);
  if (steps && steps.length > 0) {
    await supabase.from('task_steps').insert(
      steps.map(s => ({
        ...s,
        task_id:      toTaskId,
        status:       'not_started',
        completed_at: null,
      })),
    );
  }

  // Edges — straight copy onto the new task id.
  const { data: edges } = await supabase
    .from('task_step_edges')
    .select('from_step_key, to_step_key, label')
    .eq('task_id', fromTaskId);
  if (edges && edges.length > 0) {
    await supabase.from('task_step_edges').insert(
      edges.map(e => ({ ...e, task_id: toTaskId })),
    );
  }
}

async function markBroken(supabase: SupabaseClient, link: LinkRow, reason: string): Promise<void> {
  await supabase
    .from('ch_deadline_task_links')
    .update({
      status:         'broken',
      last_error:     reason,
      last_synced_at: new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    })
    .eq('id', link.id);
}
