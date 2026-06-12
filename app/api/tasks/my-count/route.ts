import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/tasks/my-count
// Returns the user's live workload — matches the inner "My Tasks" badge:
// active tasks (status != complete/draft) that have at least one INCOMPLETE
// step assigned to me. Soft-deleted are excluded.
//   count       — total live tasks
//   overdue     — subset whose due_date is before today
//   dueWithin7  — subset whose due_date is between today and 7 days out
// Used for the Tasks sidebar badge + the red/orange alert markers.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ count: 0, overdue: 0, dueWithin7: 0 }, { status: 401 });

  const supabase = createClient();

  // Find task IDs where a step is assigned to me AND that step itself is still incomplete
  // (matches the front-end filter in TasksPage that drives the "My Tasks" sub-nav badge).
  // Paginate to bypass Supabase's 1000-row default cap.
  const STEP_PAGE = 1000;
  const stepRows: { task_id: string; status: string }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('task_steps')
      .select('task_id, status')
      .eq('assignee_id', ctx.userId)
      .range(page * STEP_PAGE, (page + 1) * STEP_PAGE - 1);
    if (error) return NextResponse.json({ count: 0, overdue: 0, dueWithin7: 0 });
    if (!data || data.length === 0) break;
    stepRows.push(...data);
    if (data.length < STEP_PAGE) break;
  }

  const liveTaskIds = [...new Set(
    stepRows
      .filter(r => r.status !== 'complete' && r.status !== 'skipped')
      .map(r => r.task_id)
  )];
  if (liveTaskIds.length === 0) return NextResponse.json({ count: 0, overdue: 0, dueWithin7: 0 });

  // Pull those tasks and bucket — batch the IN clause so we don't blow the URL length cap.
  const BATCH = 100;
  const tasks: { id: string; due_date: string | null; status: string }[] = [];
  for (let i = 0; i < liveTaskIds.length; i += BATCH) {
    const slice = liveTaskIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('tasks')
      .select('id, due_date, status')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .not('status', 'in', '("complete","draft")')
      .in('id', slice);
    if (error) return NextResponse.json({ count: 0, overdue: 0, dueWithin7: 0 });
    if (data) tasks.push(...data);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);
  const monthOut = new Date(today);
  monthOut.setDate(monthOut.getDate() + 30);

  let overdue = 0;
  let dueWithin7 = 0;
  let dueWithin30 = 0;
  for (const t of tasks) {
    if (t.status === 'complete') continue;
    if (!t.due_date) continue;
    const due = new Date(t.due_date);
    if (due < today) { overdue++; continue; }
    // Nested upcoming buckets: within-30 includes within-7.
    if (due <= monthOut) dueWithin30++;
    if (due <= weekOut) dueWithin7++;
  }

  return NextResponse.json({
    count: tasks.length,
    overdue,
    dueWithin7,
    dueWithin30,
  });
}
