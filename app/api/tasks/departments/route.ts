import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/tasks/departments
// Returns the list of template categories ("departments") that have at least
// one active task in the firm, with counts. Used by the Departments sub-nav
// in the Tasks tool.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ departments: [] }, { status: 401 });

  const supabase = createClient();

  // Pull active tasks joined to their template (for category). Supabase caps
  // each request at db.max_rows (default 1000), so page through until exhausted.
  const PAGE_SIZE = 1000;
  const counts = new Map<string, number>();
  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tasks')
      .select('template:task_templates!inner(category)')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .neq('status', 'complete')
      .range(from, to);
    if (error) {
      console.error('GET /api/tasks/departments', error);
      return NextResponse.json({ departments: [] }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      // Supabase nested select returns either an object or array depending on relationship; normalise
      const t = (row as { template: { category?: string } | { category?: string }[] | null }).template;
      const category = Array.isArray(t) ? t[0]?.category : t?.category;
      if (!category) continue;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    if (data.length < PAGE_SIZE) break;
  }

  const departments = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ departments });
}
