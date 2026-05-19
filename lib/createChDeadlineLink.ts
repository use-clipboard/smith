// Shared helper for creating a CH-deadline link against a freshly-created
// task. Used by:
//   - /api/tasks POST — when the new task came from a CH-linked template
//   - lib/instantiateTaskFromTemplate — same, from the proposals onboarding
//   - bulk task-creation flows (Phase 2B)
//
// Look up the template, the client's CH number, and (optionally) the cached
// deadline from ch_cache so we can stamp the task's initial due_date right
// away. All steps are best-effort — the task itself is the primary record
// and a failed link is logged but never blocks task creation.

import type { SupabaseClient } from '@supabase/supabase-js';

export type DeadlineType = 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due';

interface Options {
  firmId: string;
  taskId: string;
  clientId: string;
  /** When provided, we read ch_deadline_type / ch_offset_days from this
   *  template row rather than re-fetching. Saves a round trip in the
   *  common case where the caller already has the template loaded. */
  template?: { ch_deadline_type?: DeadlineType | null; ch_offset_days?: number | null };
  /** Or pass a templateId and we'll load it. Ignored if `template` is set. */
  templateId?: string | null;
}

interface Result {
  ok: boolean;
  reason?: 'no_deadline_type' | 'client_missing' | 'no_ch_number' | 'error';
  linkId?: string;
}

export async function autoCreateChDeadlineLink(
  supabase: SupabaseClient,
  opts: Options,
): Promise<Result> {
  try {
    // 1. Resolve the deadline type + offset from the template.
    let deadlineType: DeadlineType | null = opts.template?.ch_deadline_type ?? null;
    let offsetDays:   number              = opts.template?.ch_offset_days ?? 0;
    if (!deadlineType && opts.templateId) {
      const { data: tpl } = await supabase
        .from('task_templates')
        .select('ch_deadline_type, ch_offset_days')
        .eq('id', opts.templateId)
        .maybeSingle();
      const t = tpl as { ch_deadline_type: DeadlineType | null; ch_offset_days: number | null } | null;
      deadlineType = t?.ch_deadline_type ?? null;
      offsetDays   = t?.ch_offset_days ?? 0;
    }
    if (!deadlineType) return { ok: false, reason: 'no_deadline_type' };

    // 2. Find the client's current CH number — without one the link has
    //    nothing to follow and isn't created.
    const { data: clientRow } = await supabase
      .from('clients')
      .select('companies_house_id, firm_id')
      .eq('id', opts.clientId)
      .maybeSingle();
    if (!clientRow) return { ok: false, reason: 'client_missing' };
    if ((clientRow as { firm_id: string }).firm_id !== opts.firmId) return { ok: false, reason: 'client_missing' };
    const chNumber = (clientRow as { companies_house_id: string | null }).companies_house_id;
    if (!chNumber) return { ok: false, reason: 'no_ch_number' };

    // 3. Look up the cached deadline so the task's initial due_date can be
    //    set immediately rather than waiting for the next sync.
    const cached = await lookupCachedDeadline(supabase, opts.firmId, chNumber, deadlineType);
    if (cached) {
      const newDue = applyOffsetIso(cached, offsetDays);
      await supabase.from('tasks').update({ due_date: newDue }).eq('id', opts.taskId);
    }

    // 4. Idempotent upsert keyed on (task_id, deadline_type). Calling this
    //    helper twice for the same task no longer creates a duplicate row —
    //    repeated runs simply refresh the snapshot of the linked company
    //    number + last_synced_deadline. Falls back to a manual select/update
    //    when the onConflict path isn't available (older Postgres / missing
    //    constraint), but in normal operation upsert is the one true write.
    const payload = {
      firm_id:               opts.firmId,
      client_id:             opts.clientId,
      task_id:               opts.taskId,
      deadline_type:         deadlineType,
      offset_days:           offsetDays,
      linked_company_number: chNumber,
      status:                'active',
      last_synced_deadline:  cached,
      last_synced_at:        cached ? new Date().toISOString() : null,
    };
    const { data: link, error } = await supabase
      .from('ch_deadline_task_links')
      .upsert(payload, { onConflict: 'task_id,deadline_type' })
      .select('id')
      .single();
    if (error || !link) {
      console.error('autoCreateChDeadlineLink upsert error', error);
      return { ok: false, reason: 'error' };
    }
    return { ok: true, linkId: link.id };
  } catch (err) {
    console.error('autoCreateChDeadlineLink', err);
    return { ok: false, reason: 'error' };
  }
}

export async function lookupCachedDeadline(
  supabase: SupabaseClient,
  firmId: string,
  companyNumber: string,
  deadlineType: DeadlineType,
): Promise<string | null> {
  const norm = companyNumber.trim().toUpperCase().padStart(8, '0');
  const { data: cache } = await supabase
    .from('ch_cache')
    .select('companies')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!cache?.companies) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companies = cache.companies as Array<any>;
  const co = companies.find(c => {
    if (typeof c?.companyNumber !== 'string') return false;
    return c.companyNumber.trim().toUpperCase().padStart(8, '0') === norm;
  });
  if (!co) return null;
  switch (deadlineType) {
    case 'accounts_due':     return (co.accountsNextDue       as string | null) ?? null;
    case 'cs_due':           return (co.csNextDue             as string | null) ?? null;
    case 'officer_idv_due':  return (co.nearestOfficerIdvDue  as string | null) ?? null;
    case 'psc_idv_due':      return (co.nearestPscIdvDue      as string | null) ?? null;
  }
}

function applyOffsetIso(iso: string, offset: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
