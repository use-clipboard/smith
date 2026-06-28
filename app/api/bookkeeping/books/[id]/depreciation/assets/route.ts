import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { isFixedAssetLedger } from '@/lib/bookkeeping/fixedAssets';

// ── /api/bookkeeping/books/[id]/depreciation/assets ──────────────────────────
// CRUD for brought-forward assets — the itemised opening assets still being
// depreciated. Addition assets are synced from Cost-additions splits and are
// NOT created here (only their description can be tweaked via PATCH).

const CreateBody = z.object({
  ledger: z.string().min(1),
  description: z.string().min(1).max(300),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost: z.number().min(0),
  opening_accumulated_depn: z.number().min(0).default(0),
  /** Charity fund this asset belongs to (NULL on non-charity books). */
  fund_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  if (!isFixedAssetLedger(body.ledger)) {
    return NextResponse.json({ error: 'Not a fixed-asset ledger' }, { status: 400 });
  }
  if (body.opening_accumulated_depn > body.cost) {
    return NextResponse.json({ error: 'Opening accumulated depreciation cannot exceed cost.' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('bookkeeping_assets')
    .insert({
      book_id: params.id,
      ledger: body.ledger,
      source: 'brought_forward',
      split_id: null,
      description: body.description.trim(),
      purchase_date: body.purchase_date,
      cost: body.cost,
      opening_accumulated_depn: body.opening_accumulated_depn,
      fund_id: body.fund_id ?? null,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'asset',
    entity_id: data.id,
    action: 'create',
    diff: { source: 'brought_forward', ledger: body.ledger, description: data.description, cost: body.cost },
  });

  return NextResponse.json({ asset: data });
}

// PATCH ?asset_id=… → edit a b/fwd asset (or just the description of an addition).
const PatchBody = z.object({
  description: z.string().min(1).max(300).optional(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cost: z.number().min(0).optional(),
  opening_accumulated_depn: z.number().min(0).optional(),
  fund_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const assetId = new URL(req.url).searchParams.get('asset_id');
  if (!assetId) return NextResponse.json({ error: 'asset_id is required' }, { status: 400 });

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data: asset, error: assetErr } = await supabase
    .from('bookkeeping_assets')
    .select('*')
    .eq('id', assetId)
    .eq('book_id', params.id)
    .single();
  if (assetErr || !asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });

  // Once depreciation has been posted against the asset its cost and opening
  // accumulated depreciation are baked into journals already on the ledger —
  // changing them here would silently desync the asset register from the
  // posted charges. Block those edits and point the user at Un-post first.
  // (A description-only rename is always harmless.)
  const changesFinancials =
    body.cost !== undefined ||
    body.purchase_date !== undefined ||
    body.opening_accumulated_depn !== undefined;
  if (changesFinancials) {
    const { count } = await supabase
      .from('bookkeeping_depreciation_charges')
      .select('id', { count: 'exact', head: true })
      .eq('asset_id', assetId);
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Depreciation has already been posted for this asset. Un-post the affected period(s) before changing its cost, purchase date or opening depreciation.',
        },
        { status: 400 },
      );
    }
  }

  // Additions mirror their Cost-additions split — cost & date come from the
  // underlying transaction and stay locked here. The description is always
  // editable. Opening accumulated depreciation is a *migration* figure that
  // isn't derived from the booking split (e.g. an asset bought in a prior
  // year whose depreciation-to-date was tracked in other software), so it's
  // editable on additions too — that's how the asset register gets reconciled
  // to the ledger's "Depn - b/fwd" balance on a mid-life migration.
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.description !== undefined) update.description = body.description.trim();
  if (asset.source === 'brought_forward') {
    if (body.purchase_date !== undefined) update.purchase_date = body.purchase_date;
    if (body.cost !== undefined) update.cost = body.cost;
  } else if (body.cost !== undefined || body.purchase_date !== undefined) {
    return NextResponse.json(
      { error: 'Additions take their cost and date from the booking transaction — edit that instead.' },
      { status: 400 },
    );
  }
  if (body.opening_accumulated_depn !== undefined) update.opening_accumulated_depn = body.opening_accumulated_depn;

  const nextCost = (update.cost as number | undefined) ?? asset.cost;
  const nextOpening = (update.opening_accumulated_depn as number | undefined) ?? asset.opening_accumulated_depn;
  if (nextOpening > nextCost) {
    return NextResponse.json({ error: 'Opening accumulated depreciation cannot exceed cost.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('bookkeeping_assets')
    .update(update)
    .eq('id', assetId)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'asset',
    entity_id: assetId,
    action: 'update',
    diff: update,
  });

  return NextResponse.json({ asset: data });
}

// DELETE ?asset_id=… → remove a b/fwd asset. Additions can't be deleted here
// (they live and die with their Cost-additions split).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const assetId = new URL(req.url).searchParams.get('asset_id');
  if (!assetId) return NextResponse.json({ error: 'asset_id is required' }, { status: 400 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id, admin_locked')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (book.admin_locked && ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Book is admin-locked' }, { status: 403 });
  }

  const { data: asset } = await supabase
    .from('bookkeeping_assets')
    .select('id, source')
    .eq('id', assetId)
    .eq('book_id', params.id)
    .single();
  if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  if (asset.source === 'addition') {
    return NextResponse.json(
      { error: 'This asset was booked by a Cost-additions posting — delete that transaction to remove it.' },
      { status: 400 },
    );
  }

  // Block delete if any depreciation has been posted against it.
  const { count } = await supabase
    .from('bookkeeping_depreciation_charges')
    .select('id', { count: 'exact', head: true })
    .eq('asset_id', assetId);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Depreciation has already been posted for this asset — it can no longer be deleted.' },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('bookkeeping_assets')
    .delete()
    .eq('id', assetId)
    .eq('book_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('bookkeeping_audit').insert({
    book_id: params.id,
    user_id: ctx.userId,
    entity_type: 'asset',
    entity_id: assetId,
    action: 'delete',
    diff: {},
  });

  return NextResponse.json({ ok: true });
}
