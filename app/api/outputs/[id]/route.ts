import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { logAudit } from '@/lib/audit/log';

// GET /api/outputs/[id] — fetch a single output incl. result_data (for download / open)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('outputs')
    .select(`
      id, feature, target_software, client_id, client_name, user_id,
      transaction_count, source_filenames, result_data, created_at, firm_id,
      user:users!user_id ( id, full_name, email ),
      client:clients!client_id ( id, name, client_ref, vat_number )
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/outputs/:id]', error);
    return NextResponse.json({ error: 'Failed to load output' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ output: data });
}

// DELETE /api/outputs/[id] — admin can delete any in firm; staff only their own
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Fetch the row to check ownership / firm (+ feature + name for the audit log)
  const { data: row, error: fetchErr } = await supabase
    .from('outputs')
    .select('id, user_id, firm_id, client_id, feature, client_name')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[DELETE /api/outputs/:id] fetch', fetchErr);
    return NextResponse.json({ error: 'Failed to load output' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isOwner = row.user_id === ctx.userId;
  const isAdmin = ctx.userRole === 'admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Only the author or an admin can delete this analysis' }, { status: 403 });
  }

  const { error: delErr } = await supabase.from('outputs').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (delErr) {
    console.error('[DELETE /api/outputs/:id]', delErr);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }

  // Audit — keyed by the output's feature (= the tool discriminator).
  await logAudit({
    firmId: row.firm_id as string,
    tool: (row.feature as string) || 'output',
    action: 'deleted',
    entityId: params.id,
    entityLabel: (row.client_name as string | null) ?? null,
    clientId: (row.client_id as string | null) ?? null,
    actorId: ctx.userId,
    summary: `Deleted ${(row.client_name as string | null) || 'a saved record'}`,
  });

  return NextResponse.json({ ok: true });
}
