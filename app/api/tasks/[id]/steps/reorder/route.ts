import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/tasks/[id]/steps/reorder
// Accepts an ordered list of step ids and writes their new position_y in
// ascending order so the workflow sort respects the user's drag-and-drop.
const BodySchema = z.object({
  orderedStepIds: z.array(z.string().uuid()).min(1),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can reorder steps.' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();

  // Verify the task is in this firm and exists
  const { data: task } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  // Assign incremental position_y values; multiplied so manual flow-chart drags later still fit between
  const now = new Date().toISOString();
  await Promise.all(
    parsed.data.orderedStepIds.map((stepId, idx) =>
      supabase
        .from('task_steps')
        .update({ position_y: (idx + 1) * 100, updated_at: now })
        .eq('id', stepId)
        .eq('task_id', params.id)
    )
  );

  return NextResponse.json({ success: true });
}
