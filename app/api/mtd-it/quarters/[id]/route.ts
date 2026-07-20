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
  // Escape hatch: allow an explicit status regression (e.g. an admin reset).
  // Normal save/navigation never sends this, so status stays monotonic.
  force:                z.boolean().optional(),
}).strict();

// Workflow ordering. A quarter's status only ever moves FORWARD along this
// ladder during normal use — re-opening an earlier step to look must never drag
// the status back (the bug this guards against). Higher number = later stage.
const STATUS_RANK: Record<string, number> = {
  not_started: 0, draft: 1, complete: 2, sent: 3, approved: 4, submitted: 5,
};

async function loadQuarterForFirm(quarterId: string, firmId: string): Promise<{ client_id: string; quarter: number; tax_year: number; status: string } | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('client_id, quarter, tax_year, status, clients!inner(firm_id)')
    .eq('id', quarterId)
    .maybeSingle();
  if (!data) return null;
  const c = (data as unknown as { clients?: { firm_id?: string } }).clients;
  if (c?.firm_id !== firmId) return null;
  return { client_id: data.client_id as string, quarter: data.quarter as number, tax_year: data.tax_year as number, status: data.status as string };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const qmeta = await loadQuarterForFirm(params.id, ctx.firmId);
  if (!qmeta) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const supabase = createClient();
  const { force, ...patch } = parsed.data;
  const updates: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };

  // Monotonic status guard. If a status is supplied that's EARLIER in the
  // workflow than the one already reached, drop it — the quarter keeps its
  // furthest-reached status. This is what stops re-opening a submitted quarter
  // (to look at something) from quietly dragging it back to draft/sent. Other
  // fields (consolidated, fx_rates, …) still apply. `force` overrides for an
  // intentional reset.
  let statusApplied: string | undefined = patch.status;
  if (patch.status && !force) {
    const curRank = STATUS_RANK[qmeta.status] ?? 0;
    const newRank = STATUS_RANK[patch.status] ?? 0;
    if (newRank < curRank) {
      delete updates.status;
      statusApplied = undefined;
    }
  }

  // Stamp the filing moment the first time a quarter reaches 'submitted' (the
  // submit route does the same). updated_at moves on every edit, so anything
  // asking "when was this filed?" needs its own timestamp.
  if (statusApplied === 'submitted' && qmeta.status !== 'submitted') {
    updates.submitted_at = new Date().toISOString();
  }

  const { error } = await supabase.from('mtd_it_quarters').update(updates).eq('id', params.id);
  if (error) {
    console.error('PATCH /api/mtd-it/quarters/[id]', error);
    return NextResponse.json({ error: 'Failed to update quarter' }, { status: 500 });
  }

  // Log status transitions to the activity feed — only when the status actually
  // changed (a guard-dropped or no-op status writes nothing).
  if (statusApplied && statusApplied !== qmeta.status) {
    createServiceClient().from('mtd_it_activity').insert({
      firm_id: ctx.firmId, client_id: qmeta.client_id, quarter_id: params.id,
      quarter: qmeta.quarter, tax_year: qmeta.tax_year, user_id: ctx.userId,
      kind: 'status_change', detail: statusApplied,
    }).then(() => {}, () => {});
  }

  // Source-doc cleanup on 'complete' is handled out-of-band by the
  // Save-to-records modal calling /cleanup-source on close — that order
  // gives the user a chance to archive to Drive/Vault first. We
  // intentionally don't auto-cleanup here, because PATCH may run from
  // code paths that don't surface the archive prompt.
  // Return the effective status (post-guard) so callers can sync their UI
  // instead of assuming the requested status was applied.
  return NextResponse.json({ ok: true, status: statusApplied ?? qmeta.status });
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

  const qmeta = await loadQuarterForFirm(params.id, ctx.firmId);
  if (!qmeta) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

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
