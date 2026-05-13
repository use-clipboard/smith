import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/tasks/templates/[id]/usage
// Returns how many active (non-complete, non-draft, non-deleted) tasks
// reference this template. Used by the TemplateBuilder to decide whether
// to show the "apply to existing tasks" propagation prompt when saving.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', ctx.firmId)
    .eq('template_id', params.id)
    .is('deleted_at', null)
    .not('status', 'in', '("complete","draft")');

  if (error) {
    console.error('GET /api/tasks/templates/[id]/usage', error);
    return NextResponse.json({ activeCount: 0 });
  }
  return NextResponse.json({ activeCount: count ?? 0 });
}
