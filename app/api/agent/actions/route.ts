import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/agent/actions — paginated audit log of Agent Smith actions for this firm.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('agent_actions')
    .select('id, action_type, summary, plain_description, affected_count, applied_at, expires_at, undone_at, undo_error, performed_by_user:users!agent_actions_performed_by_fkey(id, full_name, email), undone_by_user:users!agent_actions_undone_by_fkey(id, full_name, email)')
    .eq('firm_id', ctx.firmId)
    .order('applied_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('GET /api/agent/actions', error);
    return NextResponse.json({ error: 'Failed to load actions' }, { status: 500 });
  }
  return NextResponse.json({ actions: data ?? [] });
}
