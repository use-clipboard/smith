import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logTaxAudit } from '@/lib/tax-studio/audit';

export const dynamic = 'force-dynamic';

// The return object is large and evolves with the UI (see
// components/features/tax-studio/types.ts). It's stored verbatim in the jsonb
// `data` column; only the handful of fields the API relies on are asserted.
const ReturnData = z
  .object({
    id: z.string().optional(),
    clientId: z.string().uuid().nullable().optional(),
    clientName: z.string().min(1).max(300),
    returnType: z.string(),
    taxYear: z.string(),
    preparedBy: z.string().optional(),
  })
  .passthrough();

const CreateBody = z.object({ data: ReturnData });

// ── GET /api/tax-studio/returns ──────────────────────────────────────────────
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('tax_studio_returns')
    .select('id, data, created_by, updated_at, client_id')
    .eq('firm_id', ctx.firmId)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const returns = (data ?? []).map(row => ({
    id: row.id as string,
    data: { ...(row.data as Record<string, unknown>), id: row.id },
    updatedAt: row.updated_at as string,
    mine: row.created_by === ctx.userId,
    // The FK column is set NULL when the client is deleted (the return row
    // survives). The denormalised data.clientId stays stale, so this is the
    // authoritative "is the client still linked?" signal.
    clientLinked: row.client_id !== null,
  }));
  return NextResponse.json({ returns });
}

// ── POST /api/tax-studio/returns ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.email)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  const { data: profile } = await supabase
    .from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const authorName = (profile?.full_name as string | null)?.trim() || (profile?.email as string | null) || 'SMITH user';

  const clientId = (body.data.clientId as string | null | undefined) ?? null;
  const returnData: Record<string, unknown> = {
    ...body.data, preparedBy: authorName,
    timeline: [
      ...(Array.isArray(body.data.timeline) ? body.data.timeline : []),
      { id: 't-0', at: new Date().toISOString(), kind: 'created', label: 'Return created', actor: authorName },
    ],
  };

  const { data, error } = await supabase
    .from('tax_studio_returns')
    .insert({
      firm_id: ctx.firmId,
      client_id: clientId,
      created_by: ctx.userId,
      data: returnData,
    })
    .select('id, data, created_by, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logTaxAudit({
    firmId: ctx.firmId, returnId: data.id as string, clientId,
    clientName: body.data.clientName, actorId: ctx.userId,
    action: 'created', summary: `Started a ${body.data.returnType} return for ${body.data.taxYear}`,
  });

  return NextResponse.json({
    return: {
      id: data.id as string,
      data: { ...(data.data as Record<string, unknown>), id: data.id },
      updatedAt: data.updated_at as string,
      mine: true,
    },
  });
}
