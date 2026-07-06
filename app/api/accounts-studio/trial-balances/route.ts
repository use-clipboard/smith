import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';

export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const RowSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['income', 'expense', 'asset', 'liability', 'equity']),
  ledger: z.string().nullable().optional(),
  debit: z.number(),
  credit: z.number(),
});

const SaveBody = z.object({
  clientId: z.string().uuid(),
  periodEnd: z.string().regex(ISO),
  source: z.string().max(40).nullable().optional(),
  rows: z.array(RowSchema).max(2000),
});

// ── GET /api/accounts-studio/trial-balances?clientId=[&periodEnd=] ────────────
// Without periodEnd: list the client's saved TBs (metadata only).
// With periodEnd: return that one TB (with rows) — used to load / pull prior year.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const periodEnd = url.searchParams.get('periodEnd');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createClient();

  if (periodEnd) {
    if (!ISO.test(periodEnd)) return NextResponse.json({ error: 'Invalid periodEnd' }, { status: 400 });
    const { data, error } = await supabase
      .from('accounts_studio_trial_balances')
      .select('period_end, source, rows')
      .eq('firm_id', ctx.firmId).eq('client_id', clientId).eq('period_end', periodEnd)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      trialBalance: data ? { periodEnd: data.period_end as string, source: data.source as string | null, rows: data.rows } : null,
    });
  }

  const { data, error } = await supabase
    .from('accounts_studio_trial_balances')
    .select('id, period_end, source, rows, updated_at')
    .eq('firm_id', ctx.firmId).eq('client_id', clientId)
    .order('period_end', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const trialBalances = (data ?? []).map(r => ({
    id: r.id as string,
    periodEnd: r.period_end as string,
    source: r.source as string | null,
    rowCount: Array.isArray(r.rows) ? r.rows.length : 0,
    updatedAt: r.updated_at as string,
  }));
  return NextResponse.json({ trialBalances });
}

// ── POST /api/accounts-studio/trial-balances ─────────────────────────────────
// Upsert the TB for a client + year-end (one saved TB per period).
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof SaveBody>;
  try { body = SaveBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('accounts_studio_trial_balances')
    .upsert({
      firm_id: ctx.firmId,
      client_id: body.clientId,
      period_end: body.periodEnd,
      source: body.source ?? null,
      rows: body.rows,
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id,client_id,period_end' })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
