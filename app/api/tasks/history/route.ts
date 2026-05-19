import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/tasks/history
// Returns completed and soft-deleted tasks with full audit data:
// steps (with completion timestamps), edges, time entries (with notes).
// Used by the History view in the Tasks tool.
//
// Query params:
//   filter   = 'all' | 'completed' | 'deleted'  (default 'all')
//   q        = optional title search
//   limit    = max rows (default 500, capped at 2000)
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter') ?? 'all';
  const q = url.searchParams.get('q') ?? '';
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '500', 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 500 : limitRaw, 1), 2000);

  const supabase = createClient();
  let query = supabase
    .from('tasks')
    .select(`
      *,
      client:clients(id, name, client_ref),
      created_by_user:users!tasks_created_by_fkey(id, full_name, email),
      deleted_by_user:users!tasks_deleted_by_fkey(id, full_name, email),
      completed_by_user:users!tasks_completed_by_fkey(id, full_name, email),
      steps:task_steps(*, assignee:users(id, full_name, email)),
      edges:task_step_edges(*),
      time_entries:task_time_entries(*, user:users(id, full_name, email))
    `)
    .eq('firm_id', ctx.firmId)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  // Filter rules
  if (filter === 'completed') {
    query = query.eq('status', 'complete').is('deleted_at', null);
  } else if (filter === 'deleted') {
    query = query.not('deleted_at', 'is', null);
  } else {
    // 'all' — completed OR soft-deleted
    query = query.or('status.eq.complete,deleted_at.not.is.null');
  }

  if (q) query = query.ilike('title', `%${q}%`);

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/tasks/history', error);
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}
