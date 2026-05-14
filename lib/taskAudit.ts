/**
 * Task audit log helpers — write-side only.
 *
 * Every PUT/POST/DELETE on a task should call one of these so the
 * "Recurring Changes" view in the Tasks tool has a complete record.
 *
 * Failures are swallowed and logged: an audit miss must never break
 * the underlying task mutation.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type ChangeType = 'created' | 'updated' | 'completed' | 'reopened' | 'deleted';

interface AuditContext {
  taskId:    string;
  firmId:    string;
  clientId:  string | null;
  userId:    string;
  taskTitle: string;
}

interface AuditRow {
  task_id:               string;
  firm_id:               string;
  client_id:             string | null;
  changed_by:            string;
  change_type:           ChangeType;
  field_name:            string | null;
  old_value:             string | null;
  new_value:             string | null;
  task_title_at_change:  string | null;
}

// Fields tracked when a task is edited via PUT. Anything not in this list
// is silently ignored even if the route accepts it.
export const AUDITED_FIELDS = [
  'title',
  'description',
  'client_id',
  'status',
  'due_date',
  'is_internal',
  'recurrence_type',
  'recurrence_interval_days',
] as const;

export type AuditedField = (typeof AUDITED_FIELDS)[number];

function valueToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return null; }
}

/**
 * Write a single audit row. Caller already knows the context.
 * Use the diff helper below for typical update flows.
 */
async function insertAudit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  rows: AuditRow[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await supabase.from('task_change_log').insert(rows);
    if (error) console.error('task_change_log insert failed', error);
  } catch (err) {
    console.error('task_change_log insert threw', err);
  }
}

export async function logTaskCreated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ctx: AuditContext,
): Promise<void> {
  return insertAudit(supabase, [{
    task_id:              ctx.taskId,
    firm_id:              ctx.firmId,
    client_id:            ctx.clientId,
    changed_by:           ctx.userId,
    change_type:          'created',
    field_name:           null,
    old_value:            null,
    new_value:            null,
    task_title_at_change: ctx.taskTitle,
  }]);
}

export async function logTaskDeleted(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ctx: AuditContext,
): Promise<void> {
  return insertAudit(supabase, [{
    task_id:              ctx.taskId,
    firm_id:              ctx.firmId,
    client_id:            ctx.clientId,
    changed_by:           ctx.userId,
    change_type:          'deleted',
    field_name:           null,
    old_value:            null,
    new_value:            null,
    task_title_at_change: ctx.taskTitle,
  }]);
}

/**
 * Compare before/after dictionaries on the audited fields and write one row
 * per change. A status flip to/from 'complete' is recorded as 'completed' or
 * 'reopened' rather than a generic 'updated' so the activity feed is readable.
 */
export async function logTaskUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  ctx: AuditContext,
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): Promise<void> {
  const rows: AuditRow[] = [];

  for (const field of AUDITED_FIELDS) {
    if (!(field in after)) continue;          // not part of this update
    const oldRaw = before[field];
    const newRaw = after[field];
    if (oldRaw === newRaw) continue;
    // Treat null/undefined as equivalent — saves spurious "→ null" rows
    if ((oldRaw == null) && (newRaw == null)) continue;

    let changeType: ChangeType = 'updated';
    if (field === 'status') {
      if (newRaw === 'complete' && oldRaw !== 'complete') changeType = 'completed';
      else if (oldRaw === 'complete' && newRaw !== 'complete') changeType = 'reopened';
    }

    rows.push({
      task_id:              ctx.taskId,
      firm_id:              ctx.firmId,
      client_id:            ctx.clientId,
      changed_by:           ctx.userId,
      change_type:          changeType,
      field_name:           field,
      old_value:            valueToString(oldRaw),
      new_value:            valueToString(newRaw),
      task_title_at_change: ctx.taskTitle,
    });
  }

  return insertAudit(supabase, rows);
}
