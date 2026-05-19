import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/outputs?feature=full_analysis&search=&software=&user_id=&client_id=&date_from=&date_to=&mine_only=&sort=&dir=
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const url = new URL(req.url);

  const feature   = url.searchParams.get('feature') ?? 'full_analysis';
  const search    = (url.searchParams.get('search') ?? '').trim();
  const software  = url.searchParams.get('software');
  const userId    = url.searchParams.get('user_id');
  const clientId  = url.searchParams.get('client_id');
  const dateFrom  = url.searchParams.get('date_from');
  const dateTo    = url.searchParams.get('date_to');
  const mineOnly  = url.searchParams.get('mine_only') === '1';
  const sort      = url.searchParams.get('sort') ?? 'created_at';
  const dir       = (url.searchParams.get('dir') ?? 'desc') === 'asc' ? 'asc' : 'desc';

  let query = supabase
    .from('outputs')
    .select(`
      id, feature, target_software, client_id, client_name, user_id,
      transaction_count, source_filenames, created_at,
      period_from:result_data->>dateFrom,
      period_to:result_data->>dateTo,
      user:users!user_id ( id, full_name, email ),
      client:clients!client_id ( id, name, client_ref )
    `)
    .eq('feature', feature)
    .eq('firm_id', ctx.firmId);

  if (software) query = query.eq('target_software', software);
  if (mineOnly) query = query.eq('user_id', ctx.userId);
  else if (userId) query = query.eq('user_id', userId);
  if (clientId) query = query.eq('client_id', clientId);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo)   query = query.lte('created_at', dateTo + 'T23:59:59.999Z');

  if (search) {
    const s = search.replace(/[%,]/g, '');
    query = query.or(`client_name.ilike.%${s}%,target_software.ilike.%${s}%`);
  }

  const allowedSorts = new Set(['created_at', 'target_software', 'client_name', 'transaction_count']);
  query = query.order(allowedSorts.has(sort) ? sort : 'created_at', { ascending: dir === 'asc' });
  query = query.limit(500);

  const { data, error } = await query;
  if (error) {
    console.error('[GET /api/outputs]', error);
    return NextResponse.json({ error: 'Failed to load outputs' }, { status: 500 });
  }

  // Surface the first linked task per output so the history table can
  // show a "task already exists" marker without a second round trip.
  // Excludes complete/cancelled tasks so a long-finished task doesn't
  // permanently grey out the Create-task action.
  const outputIds = (data ?? []).map(o => (o as { id: string }).id);
  const linkedTaskByOutput = new Map<string, { id: string; title: string; status: string }>();
  if (outputIds.length > 0) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, source_output_id')
      .eq('firm_id', ctx.firmId)
      .in('source_output_id', outputIds)
      .not('status', 'in', '(complete,cancelled)');
    for (const t of (tasks ?? []) as Array<{ id: string; title: string; status: string; source_output_id: string }>) {
      // Keep the first task we encounter per output — if multiple exist
      // the indicator still leads back to a real task.
      if (!linkedTaskByOutput.has(t.source_output_id)) {
        linkedTaskByOutput.set(t.source_output_id, { id: t.id, title: t.title, status: t.status });
      }
    }
  }

  const outputsWithTask = (data ?? []).map(o => ({
    ...o,
    linked_task: linkedTaskByOutput.get((o as { id: string }).id) ?? null,
  }));

  return NextResponse.json({ outputs: outputsWithTask });
}
