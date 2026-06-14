import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * GET /api/team/[id]/list?type=activity|tasks|clients|documents
 * Lazy-loaded fuller lists behind the profile's tabs (the Overview tab only
 * shows summaries). Firm-scoped; service role so it works for any colleague.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const type = new URL(req.url).searchParams.get('type');
  const targetId = params.id;
  const svc = createServiceClient();

  const { data: u } = await svc.from('users').select('firm_id').eq('id', targetId).single();
  if (!u || u.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (type === 'activity') {
    const { data } = await svc
      .from('outputs')
      .select('id, feature, created_at, clients(name, client_ref, status)')
      .eq('user_id', targetId)
      .order('created_at', { ascending: false })
      .limit(50);
    return NextResponse.json({ items: data ?? [] });
  }

  if (type === 'documents') {
    const { data } = await svc
      .from('documents')
      .select('id, file_name, document_type, created_at, drive_file_id, file_url, clients(name, client_ref)')
      .eq('uploaded_by', targetId)
      .order('created_at', { ascending: false })
      .limit(50);
    return NextResponse.json({ items: data ?? [] });
  }

  if (type === 'tasks' || type === 'clients') {
    // Task ids where the target is a step assignee.
    const STEP_PAGE = 1000;
    const stepTaskIds = new Set<string>();
    for (let page = 0; ; page++) {
      const { data, error } = await svc
        .from('task_steps').select('task_id')
        .eq('assignee_id', targetId)
        .range(page * STEP_PAGE, (page + 1) * STEP_PAGE - 1);
      if (error) break;
      if (!data || data.length === 0) break;
      for (const r of data) stepTaskIds.add(r.task_id as string);
      if (data.length < STEP_PAGE) break;
    }
    const ids = [...stepTaskIds];
    const tasks: { id: string; title: string | null; status: string; due_date: string | null; client_id: string | null }[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await svc
        .from('tasks')
        .select('id, title, status, due_date, client_id')
        .eq('firm_id', ctx.firmId)
        .is('deleted_at', null)
        .in('id', ids.slice(i, i + 100));
      if (data) tasks.push(...data);
    }
    // Client names for any referenced clients.
    const clientIds = [...new Set(tasks.map(t => t.client_id).filter(Boolean) as string[])];
    const names = new Map<string, { name: string; client_ref: string | null }>();
    for (let i = 0; i < clientIds.length; i += 100) {
      const { data } = await svc.from('clients').select('id, name, client_ref').in('id', clientIds.slice(i, i + 100));
      for (const c of data ?? []) names.set(c.id, { name: c.name, client_ref: c.client_ref });
    }

    if (type === 'tasks') {
      const items = tasks
        .map(t => ({
          id: t.id,
          title: t.title ?? 'Untitled task',
          status: t.status,
          due: t.due_date,
          clientId: t.client_id,
          clientName: t.client_id ? (names.get(t.client_id)?.name ?? null) : null,
        }))
        // Open first, then by due date.
        .sort((a, b) => {
          const ao = a.status === 'complete' ? 1 : 0, bo = b.status === 'complete' ? 1 : 0;
          if (ao !== bo) return ao - bo;
          return (a.due ?? '9999').localeCompare(b.due ?? '9999');
        })
        .slice(0, 60);
      return NextResponse.json({ items });
    }

    // type === 'clients' — group their tasks by client (total + open).
    const byClient = new Map<string, { total: number; open: number }>();
    for (const t of tasks) {
      if (!t.client_id) continue;
      const agg = byClient.get(t.client_id) ?? { total: 0, open: 0 };
      agg.total++;
      if (t.status !== 'complete') agg.open++;
      byClient.set(t.client_id, agg);
    }
    const items = [...byClient.entries()]
      .map(([clientId, v]) => ({
        clientId,
        name: names.get(clientId)?.name ?? 'Unknown client',
        clientRef: names.get(clientId)?.client_ref ?? null,
        total: v.total,
        open: v.open,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 60);
    return NextResponse.json({ items });
  }

  return NextResponse.json({ items: [] });
}
