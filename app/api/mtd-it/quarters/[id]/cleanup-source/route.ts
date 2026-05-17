import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/mtd-it/quarters/[id]/cleanup-source
//
// Wipes every file in mtd-it-source-docs/{quarter_id}/ and nulls the
// file_url column on the matching mtd_it_documents rows. Used by the
// Save-to-records modal when it's been opened by a Save & complete
// action AND the firm has the auto-delete-on-complete setting on — the
// modal fires this on close, giving the user a one-stop "archive then
// clean up" flow.
//
// Firm-scoped via quarter → client → firm_id. Any firm member can run
// it; deletion is destructive but mirrors what happens automatically.

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  // Firm-scope check
  const supabase = createClient();
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, clients!inner(firm_id)')
    .eq('id', params.id)
    .maybeSingle();
  const firmId = (q as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!q || firmId !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const service = createServiceClient();

  try {
    const { data: listed, error: listErr } = await service.storage
      .from('mtd-it-source-docs')
      .list(params.id, { limit: 500 });
    if (listErr) {
      console.error('cleanup-source list', listErr);
      return NextResponse.json({ error: 'Failed to list files' }, { status: 500 });
    }
    if (!listed || listed.length === 0) {
      return NextResponse.json({ ok: true, removed: 0 });
    }
    const paths = listed.map(f => `${params.id}/${f.name}`);
    const { error: rmErr } = await service.storage.from('mtd-it-source-docs').remove(paths);
    if (rmErr) {
      console.error('cleanup-source remove', rmErr);
      return NextResponse.json({ error: 'Failed to remove files' }, { status: 500 });
    }
    // Null out file_url on documents rows so the "View source" button hides
    // gracefully instead of throwing a 404 on the signed-URL fetch.
    await service.from('mtd_it_documents').update({ file_url: null }).eq('quarter_id', params.id);

    return NextResponse.json({ ok: true, removed: paths.length });
  } catch (e) {
    console.error('cleanup-source', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Cleanup failed' }, { status: 500 });
  }
}
