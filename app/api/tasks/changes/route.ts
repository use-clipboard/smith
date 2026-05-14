import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * GET /api/tasks/changes
 *
 * Returns recent task change-log entries for the current firm. Powers the
 * "Recurring Changes" view in the Tasks tool. Search is applied client-side.
 *
 * Query params:
 *   limit = max rows (default 500, capped at 2000)
 */
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const limitRaw = parseInt(req.nextUrl.searchParams.get('limit') ?? '500', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 500 : limitRaw, 1), 2000);

  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_change_log')
    .select(`
      id,
      task_id,
      change_type,
      field_name,
      old_value,
      new_value,
      task_title_at_change,
      changed_at,
      changed_by_user:users!task_change_log_changed_by_fkey(id, full_name, email),
      task:tasks(id, title, deleted_at),
      client:clients(id, name, client_ref)
    `)
    .eq('firm_id', ctx.firmId)
    .order('changed_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('GET /api/tasks/changes', error);
    return NextResponse.json({ error: 'Failed to load changes', changes: [] }, { status: 500 });
  }

  return NextResponse.json({ changes: data ?? [] });
}
