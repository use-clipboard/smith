import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/clients/[id]/snapshot
// A lightweight "at a glance" summary of a client for the Email Triage context
// panel: open task count, document count (the `documents` table — files
// uploaded through the AI tools / client portal, so it works for every firm
// regardless of modules), and the client's most recent AI-tool activity
// (same source as the dashboard's Recent Activity widget — last 3 runs).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const clientId = params.id;
  const supabase = createClient();

  const [openTasksRes, docsCountRes, outputsRes] = await Promise.all([
    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firmId).eq('client_id', clientId)
      .is('deleted_at', null).not('status', 'in', '("complete","draft")'),
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId),
    supabase.from('outputs').select('id, feature, created_at')
      .eq('client_id', clientId).order('created_at', { ascending: false }).limit(3),
  ]);

  const recentActivity = ((outputsRes.data ?? []) as { id: string; feature: string; created_at: string }[])
    .map(o => ({
      id: o.id,
      label: `${o.feature.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} run`,
      at: o.created_at,
    }));

  return NextResponse.json({
    openTasks: openTasksRes.count ?? 0,
    documents: docsCountRes.count ?? 0,
    recentActivity,
  });
}
