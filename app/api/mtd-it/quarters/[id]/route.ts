import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const StreamsSchema = z.object({
  sole:           z.boolean(),
  uk_rental:      z.boolean(),
  foreign_rental: z.boolean(),
});

const PatchSchema = z.object({
  streams_snapshot:     StreamsSchema.optional(),
  consolidated:         z.boolean().optional(),
  fx_rates:             z.record(z.string(), z.number().positive()).optional(),
  status:               z.enum(['draft', 'complete', 'sent', 'approved', 'submitted']).optional(),
  notes:                z.string().nullable().optional(),
}).strict();

async function checkQuarterFirmAccess(quarterId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('client_id, clients!inner(firm_id)')
    .eq('id', quarterId)
    .maybeSingle();
  if (!data) return false;
  // Supabase typings make this loose — coerce defensively
  const c = (data as unknown as { clients?: { firm_id?: string } }).clients;
  return c?.firm_id === firmId;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const ok = await checkQuarterFirmAccess(params.id, ctx.firmId);
  if (!ok) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const supabase = createClient();
  const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

  const { error } = await supabase.from('mtd_it_quarters').update(updates).eq('id', params.id);
  if (error) {
    console.error('PATCH /api/mtd-it/quarters/[id]', error);
    return NextResponse.json({ error: 'Failed to update quarter' }, { status: 500 });
  }

  // Source-doc cleanup on 'complete' is handled out-of-band by the
  // Save-to-records modal calling /cleanup-source on close — that order
  // gives the user a chance to archive to Drive/Vault first. We
  // intentionally don't auto-cleanup here, because PATCH may run from
  // code paths that don't surface the archive prompt.
  return NextResponse.json({ ok: true });
}

// DELETE /api/mtd-it/quarters/[id]
//   Admin-only. Wipes the quarter and everything attached to it:
//   - All mtd_it_entries (cascades via FK)
//   - All mtd_it_documents (cascades via FK)
//   - All mtd_it_quarter_approvals (cascades via FK)
//   - All source-document files in the mtd-it-source-docs storage bucket
//
//   This is destructive and not undoable — the confirmation modal in the UI
//   warns the user clearly. The FK cascades handle the relational data; we
//   manually clean the storage bucket because that lives outside Postgres.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can delete a quarter' }, { status: 403 });
  }

  const ok = await checkQuarterFirmAccess(params.id, ctx.firmId);
  if (!ok) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  const service = createServiceClient();

  // 1) Wipe any source-document files in storage. We list everything under
  //    the {quarter_id}/ folder and pass the full list to remove(). Errors
  //    here are logged but don't abort the delete — the DB row is the
  //    source of truth, files become orphans at worst.
  try {
    const { data: listed, error: listErr } = await service.storage
      .from('mtd-it-source-docs')
      .list(params.id, { limit: 1000 });
    if (listErr) {
      console.warn('DELETE quarter storage list', listErr);
    } else if (listed && listed.length > 0) {
      const paths = listed.map(f => `${params.id}/${f.name}`);
      const { error: removeErr } = await service.storage.from('mtd-it-source-docs').remove(paths);
      if (removeErr) console.warn('DELETE quarter storage remove', removeErr);
    }
  } catch (e) {
    console.warn('DELETE quarter storage cleanup failed (non-fatal):', e);
  }

  // 2) Delete the quarter row. Entries / documents / approvals all FK-cascade
  //    onto mtd_it_quarters with ON DELETE CASCADE, so they're wiped too.
  const { error: delErr } = await service.from('mtd_it_quarters').delete().eq('id', params.id);
  if (delErr) {
    console.error('DELETE /api/mtd-it/quarters/[id]', delErr);
    return NextResponse.json({ error: 'Failed to delete quarter' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
