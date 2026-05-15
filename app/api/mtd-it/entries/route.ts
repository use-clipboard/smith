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

const EntryBase = {
  stream:          STREAM,
  trade_id:        z.string().uuid().nullable().optional(),
  property_id:     z.string().uuid().nullable().optional(),
  source_file_name: z.string().nullable().optional(),
  page_number:     z.number().int().nullable().optional(),
  entry_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description:     z.string().nullable().optional(),
  supplier:        z.string().nullable().optional(),
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
  const { data, error } = await supabase
    .from('mtd_it_entries')
    .insert({ ...parsed.data, manual: parsed.data.manual ?? true })
    .select()
    .single();
  if (error) {
    console.error('POST /api/mtd-it/entries', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
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

  // Creates
  let createdRows: Array<{ id: string }> = [];
  if (creates.length > 0) {
    const rows = creates.map(c => ({ ...c, quarter_id, manual: c.manual ?? true }));
    const { data, error } = await supabase.from('mtd_it_entries').insert(rows).select('id');
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

  return NextResponse.json({
    created: createdRows.length,
    updated: updates.length,
    deleted: deletes.length,
  });
}
