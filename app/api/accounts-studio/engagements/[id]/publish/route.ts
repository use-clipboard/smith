import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';

export const dynamic = 'force-dynamic';

const Body = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().optional(),
  clientCode: z.string().nullable().optional(),
  companyName: z.string().default(''),
  entityType: z.string().default(''),
  framework: z.string().default(''),
  periodStart: z.string().default(''),
  periodEnd: z.string().default(''),
  // Headline figures for the AI-outputs card.
  turnover: z.number().nullable().optional(),
  netProfit: z.number().nullable().optional(),
  totalAssets: z.number().nullable().optional(),
  netAssets: z.number().nullable().optional(),
  outputId: z.string().uuid().nullable().optional(),
});

// ── POST /api/accounts-studio/engagements/[id]/publish ───────────────────────
// Records an `outputs` audit row for a published set of statutory accounts so it
// surfaces against the client record (AI Outputs). Idempotent per engagement via
// the returned outputId (re-publish updates the same row).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  const resultData = {
    engagementId: params.id,
    companyName: body.companyName,
    entityType: body.entityType,
    framework: body.framework,
    periodStart: body.periodStart,
    periodEnd: body.periodEnd,
    dateFrom: body.periodStart,
    dateTo: body.periodEnd,
    turnover: body.turnover ?? null,
    netProfit: body.netProfit ?? null,
    totalAssets: body.totalAssets ?? null,
    netAssets: body.netAssets ?? null,
    publishedAt: new Date().toISOString(),
  };

  const cols: Record<string, unknown> = {
    client_id: body.clientId ?? null,
    client_name: body.clientName ?? body.companyName ?? null,
    target_software: body.framework || null,
    result_data: resultData,
  };

  // Re-publish updates the existing audit row.
  if (body.outputId) {
    const { data, error } = await supabase
      .from('outputs').update(cols).eq('id', body.outputId).eq('firm_id', ctx.firmId)
      .select('id').maybeSingle();
    if (!error && data) return NextResponse.json({ outputId: data.id });
  }

  const { data, error } = await supabase
    .from('outputs')
    .insert({ firm_id: ctx.firmId, user_id: ctx.userId, feature: 'accounts_studio', source_filenames: [], ...cols })
    .select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ outputId: data.id });
}
