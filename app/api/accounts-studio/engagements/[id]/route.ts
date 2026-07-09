import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';

export const dynamic = 'force-dynamic';

const EngagementData = z
  .object({
    id: z.string().optional(),
    clientId: z.string().uuid().nullable().optional(),
    companyName: z.string().min(1).max(300),
    published: z.boolean().optional(),
  })
  .passthrough();

const PatchBody = z.object({ data: EngagementData });

async function requireCtx() {
  const ctx = await getUserContext();
  if (!ctx) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!canAccessAccountsStudio(ctx.email)) return { error: NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 }) };
  return { ctx };
}

// ── GET /api/accounts-studio/engagements/[id] ────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, error } = await requireCtx();
  if (error) return error;

  const supabase = createClient();
  const { data, error: dbErr } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data, created_by, updated_at')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    engagement: {
      id: data.id as string,
      data: { ...(data.data as Record<string, unknown>), id: data.id },
      updatedAt: data.updated_at as string,
      mine: data.created_by === ctx.userId,
    },
  });
}

// ── PATCH /api/accounts-studio/engagements/[id] ──────────────────────────────
// Autosave: replace the stored engagement snapshot.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, error } = await requireCtx();
  if (error) return error;

  let body: z.infer<typeof PatchBody>;
  try { body = PatchBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const clientId = (body.data.clientId as string | null | undefined) ?? null;

  // The client-approval / submission lifecycle is owned by the dedicated routes
  // (send-approval, approve/[token], mark-submitted). Preserve those fields from
  // the stored row so a normal autosave can never move the chain backward (or
  // clobber a client's approval the accountant hasn't seen yet).
  const { data: existing } = await supabase
    .from('accounts_studio_engagements')
    .select('data, published')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  const prev = (existing?.data ?? {}) as Record<string, unknown>;
  const APPROVAL_KEYS = ['approvalStatus', 'sentAt', 'approvedAt', 'approvedByName', 'rejectedAt', 'changesNote', 'submittedAt'] as const;
  const preserved: Record<string, unknown> = {};
  for (const k of APPROVAL_KEYS) if (prev[k] !== undefined) preserved[k] = prev[k];
  // Never let published regress from a submitted set of accounts.
  const publishedNow = prev.approvalStatus === 'submitted' ? true : (body.data.published ?? !!existing?.published ?? false);

  const { data, error: dbErr } = await supabase
    .from('accounts_studio_engagements')
    .update({
      data: { ...body.data, ...preserved, id: params.id },
      client_id: clientId,
      published: publishedNow,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .select('id, updated_at')
    .maybeSingle();
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ ok: true, updatedAt: data.updated_at });
}

// ── DELETE /api/accounts-studio/engagements/[id] ─────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { ctx, error } = await requireCtx();
  if (error) return error;

  const supabase = createClient();
  const { error: dbErr } = await supabase
    .from('accounts_studio_engagements')
    .delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
