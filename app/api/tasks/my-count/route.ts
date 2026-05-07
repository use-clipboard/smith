import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/tasks/my-count
// Returns the number of active (non-complete, non-draft) tasks that have
// at least one step assigned to the current user.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ count: 0 }, { status: 401 });

  const supabase = createClient();

  // Find task IDs where a step is assigned to this user
  const { data: stepRows, error } = await supabase
    .from('task_steps')
    .select('task_id')
    .eq('assignee_id', ctx.userId);

  if (error || !stepRows?.length) return NextResponse.json({ count: 0 });

  const taskIds = [...new Set(stepRows.map(r => r.task_id))];

  // Count tasks from that set that are active (not complete, not draft)
  const { count, error: countErr } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', ctx.firmId)
    .in('id', taskIds)
    .not('status', 'in', '("complete","draft")');

  if (countErr) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: count ?? 0 });
}
