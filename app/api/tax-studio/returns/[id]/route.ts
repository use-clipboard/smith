import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logTaxAudit } from '@/lib/tax-studio/audit';

export const dynamic = 'force-dynamic';

const ReturnData = z
  .object({
    id: z.string().optional(),
    clientId: z.string().uuid().nullable().optional(),
    clientName: z.string().min(1).max(300),
  })
  .passthrough();

const PatchBody = z.object({ data: ReturnData });

async function requireCtx() {
  const ctx = await getUserContext();
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!canAccessTaxStudio(ctx.email)) return { error: NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 }) };
  return { ctx };
}

// ── GET /api/tax-studio/returns/[id] ─────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, error } = await requireCtx();
  if (error) return error;

  const supabase = createClient();
  const { data, error: dbErr } = await supabase
    .from('tax_studio_returns')
    .select('id, data, created_by, updated_at')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    return: {
      id: data.id as string,
      data: { ...(data.data as Record<string, unknown>), id: data.id },
      updatedAt: data.updated_at as string,
      mine: data.created_by === ctx.userId,
    },
  });
}

// ── PATCH /api/tax-studio/returns/[id] ───────────────────────────────────────
// Autosave — replace the stored snapshot. The approval/submission lifecycle
// fields are preserved from the stored row so a routine autosave can never move
// the chain backward.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, error } = await requireCtx();
  if (error) return error;

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const clientId = (body.data.clientId as string | null | undefined) ?? null;

  const { data: existing } = await supabase
    .from('tax_studio_returns')
    .select('data')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  const prev = (existing?.data ?? {}) as Record<string, unknown>;
  const LIFECYCLE_KEYS = ['approvalStatus', 'sentAt', 'approvedAt', 'submittedAt', 'submissionRef'] as const;
  const preserved: Record<string, unknown> = {};
  for (const k of LIFECYCLE_KEYS) {
    // Only preserve a stored lifecycle field if the incoming payload doesn't
    // itself advance it (so the Approval/Submit stages can still set them).
    if (prev[k] !== undefined && body.data[k] === undefined) preserved[k] = prev[k];
  }

  const { data, error: dbErr } = await supabase
    .from('tax_studio_returns')
    .update({
      data: { ...body.data, ...preserved, id: params.id },
      client_id: clientId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .select('id, updated_at')
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, updatedAt: data.updated_at });
}

// ── DELETE /api/tax-studio/returns/[id] ──────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, error } = await requireCtx();
  if (error) return error;

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('tax_studio_returns')
    .select('data, client_id')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();

  const { error: dbErr } = await supabase
    .from('tax_studio_returns')
    .delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  if (existing) {
    const e = (existing.data ?? {}) as { clientName?: string };
    await logTaxAudit({
      firmId: ctx.firmId, returnId: null,
      clientId: (existing.client_id as string | null) ?? null,
      clientName: e.clientName ?? null, actorId: ctx.userId,
      action: 'deleted', summary: `Deleted the return${e.clientName ? ` for ${e.clientName}` : ''}`,
    });
  }
  return NextResponse.json({ ok: true });
}
