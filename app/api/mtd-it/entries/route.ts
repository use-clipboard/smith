import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/mtd-it/entries?quarter_id=...
//   List every entry for one quarter. Firm scope is enforced by joining
//   through mtd_it_quarters → clients → firm_id.
// POST /api/mtd-it/entries
//   Create a single entry (manual entry from the review screen). The
//   manual flag is set so the editor can distinguish AI-extracted rows
//   from user-typed ones.
// PUT  /api/mtd-it/entries
//   Bulk save — accepts arrays of `creates`, `updates`, and `deletes`
//   so the editor can commit a whole session's worth of edits in one
//   round trip when the user clicks Save.

const STREAM = z.enum(['sole', 'uk_rental', 'foreign_rental']);
const TYPE   = z.enum(['income', 'expense']);

type NewEntry = { property_id?: string | null; share_pct?: number | null };

/**
 * Default share_pct from the property's ownership set up in Setup.
 *
 * Setup is where the firm records who owns what, so that's the source of truth
 * for the share — nobody should be retyping it per row. Applied at INSERT only,
 * and only when the caller didn't send one, so a share deliberately typed on a
 * row is never overwritten later.
 *
 * Untagged rows keep 100: we don't know whose share to apply, and 100 errs
 * towards over- rather than under-declaring.
 */
async function withPropertyShares<T extends NewEntry>(
  supabase: ReturnType<typeof createClient>,
  rows: T[],
): Promise<T[]> {
  const needed = [...new Set(
    rows.filter(r => r.share_pct == null && r.property_id).map(r => r.property_id as string),
  )];
  if (needed.length === 0) return rows;
  const { data } = await supabase
    .from('mtd_it_properties')
    .select('id, ownership_pct')
    .in('id', needed);
  const share = new Map((data ?? []).map(p => [p.id as string, Number(p.ownership_pct ?? 100)]));
  return rows.map(r =>
    r.share_pct == null && r.property_id
      ? { ...r, share_pct: share.get(r.property_id) ?? 100 }
      : r,
  );
}

const EntryBase = {
  // Optional client-minted UUID. The bulk editor generates a row's id up front
  // so a save can be reconciled without depending on the order Postgres returns
  // inserted rows (see lib/mtdIt/saveReconcile). Absent on the single-create
  // POST path, where the DB default fills it in.
  id:              z.string().uuid().optional(),
  stream:          STREAM,
  trade_id:        z.string().uuid().nullable().optional(),
  property_id:     z.string().uuid().nullable().optional(),
  source_file_name: z.string().nullable().optional(),
  page_number:     z.number().int().nullable().optional(),
  entry_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description:     z.string().nullable().optional(),
  supplier:        z.string().nullable().optional(),
  invoice_number:  z.string().nullable().optional(),
  category:        z.string().min(1),
  entry_type:      TYPE,
  gross_amount:    z.number(),
  net_amount:      z.number().nullable().optional(),
  vat_amount:      z.number().nullable().optional(),
  currency:        z.string().min(1).max(3),
  fx_rate:         z.number().nullable().optional(),
  gbp_amount:      z.number().nullable().optional(),
  share_pct:       z.number().min(0).max(100).optional(),
  manual:          z.boolean().optional(),
  flagged_reason:  z.string().nullable().optional(),
  flag_dismissed:  z.boolean().optional(),
  drive_link:      z.string().nullable().optional(),
};

const CreateSchema = z.object({ quarter_id: z.string().uuid(), ...EntryBase });
const PatchSchema  = z.object(EntryBase).partial();

async function quarterBelongsToFirm(quarterId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('client_id, clients!inner(firm_id)')
    .eq('id', quarterId)
    .maybeSingle();
  const c = (data as unknown as { clients?: { firm_id?: string } } | null)?.clients;
  return c?.firm_id === firmId;
}

// ── GET ────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const quarterId = new URL(req.url).searchParams.get('quarter_id');
  if (!quarterId) return NextResponse.json({ error: 'quarter_id required' }, { status: 400 });
  if (!(await quarterBelongsToFirm(quarterId, ctx.firmId))) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_entries')
    .select('*')
    .eq('quarter_id', quarterId)
    .order('entry_date', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.error('GET /api/mtd-it/entries', error);
    return NextResponse.json({ error: 'Failed to load entries' }, { status: 500 });
  }
  return NextResponse.json({ entries: data ?? [] });
}

// ── POST (single create — used for manual entries) ─────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  if (!(await quarterBelongsToFirm(parsed.data.quarter_id, ctx.firmId))) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const supabase = createClient();
  const [row] = await withPropertyShares(supabase, [{ ...parsed.data, manual: parsed.data.manual ?? true }]);
  const { data, error } = await supabase
    .from('mtd_it_entries')
    .insert(row)
    .select()
    .single();
  if (error) {
    console.error('POST /api/mtd-it/entries', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
  // First real entry promotes the quarter out of 'not_started'.
  await supabase
    .from('mtd_it_quarters')
    .update({ status: 'draft' })
    .eq('id', parsed.data.quarter_id)
    .eq('status', 'not_started');
  return NextResponse.json({ entry: data }, { status: 201 });
}

// ── PUT (bulk save — creates + updates + deletes in one round trip) ────
// Updates allow partial payloads (every EntryBase field optional) plus the
// required id. PatchSchema (defined earlier) already makes everything
// optional, so we extend it with `id` rather than re-spelling the shape.
const UpdateSchema = PatchSchema.extend({ id: z.string().uuid() });
const BulkSchema = z.object({
  quarter_id: z.string().uuid(),
  creates:    z.array(z.object(EntryBase)).default([]),
  updates:    z.array(UpdateSchema).default([]),
  deletes:    z.array(z.string().uuid()).default([]),
});

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { quarter_id, creates, updates, deletes } = parsed.data;
  if (!(await quarterBelongsToFirm(quarter_id, ctx.firmId))) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const supabase = createClient();

  // Creates. Upsert on the client-supplied id rather than a plain insert: an
  // autosave whose response was lost to the network is retried with the SAME
  // ids, and an upsert makes that retry idempotent instead of inserting the
  // rows a second time. Rows without an id (legacy callers) still insert
  // normally — Postgres fills the default.
  let createdRows: Array<{ id: string }> = [];
  if (creates.length > 0) {
    const rows = await withPropertyShares(supabase, creates.map(c => ({ ...c, quarter_id, manual: c.manual ?? true })));
    const { data, error } = await supabase
      .from('mtd_it_entries')
      .upsert(rows, { onConflict: 'id' })
      .select('id');
    if (error) {
      console.error('PUT /api/mtd-it/entries createMany', error);
      return NextResponse.json({ error: 'Failed to create entries' }, { status: 500 });
    }
    createdRows = data ?? [];
  }

  // Deletes — verify each belongs to the same quarter before removing.
  if (deletes.length > 0) {
    const { error } = await supabase
      .from('mtd_it_entries')
      .delete()
      .in('id', deletes)
      .eq('quarter_id', quarter_id);
    if (error) {
      console.error('PUT /api/mtd-it/entries deleteMany', error);
      return NextResponse.json({ error: 'Failed to delete entries' }, { status: 500 });
    }
  }

  // Updates — applied sequentially so a single bad row doesn't poison the rest.
  // Supabase doesn't support bulk updates with different values per row in one
  // statement, so we issue one PATCH per row. Quarters are small (tens of rows
  // typical, low hundreds worst case) so this is fine.
  for (const u of updates) {
    const { id, ...patch } = u;
    const { error } = await supabase
      .from('mtd_it_entries')
      .update(patch)
      .eq('id', id)
      .eq('quarter_id', quarter_id);
    if (error) {
      console.error('PUT /api/mtd-it/entries update', id, error);
      // Don't bail out — surface a partial-failure response so the editor
      // can highlight just the rows that didn't save.
      return NextResponse.json({ error: 'Failed to update one or more entries', failed_id: id }, { status: 500 });
    }
  }

  // Any change promotes the quarter out of 'not_started'. Only bumps the
  // not-started case so draft/complete/sent/approved survive untouched.
  if (creates.length + updates.length + deletes.length > 0) {
    await supabase
      .from('mtd_it_quarters')
      .update({ status: 'draft' })
      .eq('id', quarter_id)
      .eq('status', 'not_started');
  }

  // Flag the active approval as "edited since approved" if any changes
  // were applied AND the quarter is currently approved. Non-fatal if it
  // fails — the entries were already written.
  if (creates.length + updates.length + deletes.length > 0) {
    try {
      const { data: qStatus } = await supabase
        .from('mtd_it_quarters')
        .select('status')
        .eq('id', quarter_id)
        .maybeSingle();
      if (qStatus && (qStatus as { status: string }).status === 'approved') {
        await supabase
          .from('mtd_it_quarter_approvals')
          .update({ edited_since_approved_at: new Date().toISOString() })
          .eq('quarter_id', quarter_id)
          .not('approved_at', 'is', null)
          .is('voided_at', null)
          .is('edited_since_approved_at', null);
      }
    } catch (e) {
      console.warn('PUT /api/mtd-it/entries edited_since_approved bump failed (non-fatal):', e);
    }
  }

  return NextResponse.json({
    created: createdRows.length,
    updated: updates.length,
    deleted: deletes.length,
    // Ids of the rows just created, in the same order as `creates`. The editor
    // needs these to attach a DB id to each new row — without them it can't
    // tell "saved" from "new", and a second save would insert duplicates.
    created_ids: createdRows.map(r => r.id),
  });
}

// ── DELETE ───────────────────────────────────────────────────────────────
// DELETE /api/mtd-it/entries?quarter_id=...&stream=...
//   Remove every entry for one stream on a quarter. Used when a stream is
//   toggled OFF in setup: its entries would otherwise be orphaned (invisible
//   in the editor, yet still leaking into the client approval page / a filing).
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const quarter_id = url.searchParams.get('quarter_id');
  const streamParam = url.searchParams.get('stream');
  const stream = STREAM.safeParse(streamParam);
  if (!quarter_id || !stream.success) {
    return NextResponse.json({ error: 'quarter_id and a valid stream are required' }, { status: 400 });
  }
  if (!(await quarterBelongsToFirm(quarter_id, ctx.firmId))) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('mtd_it_entries')
    .delete()
    .eq('quarter_id', quarter_id)
    .eq('stream', stream.data);
  if (error) {
    console.error('DELETE /api/mtd-it/entries', error);
    return NextResponse.json({ error: 'Failed to delete entries' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
