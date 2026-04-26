import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';

async function getAuthFirmId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorised', firmId: null };
  const { data: profile } = await supabase
    .from('users').select('firm_id').eq('id', user.id).single();
  if (!profile?.firm_id) return { error: 'No firm found', firmId: null };
  return { error: null, firmId: profile.firm_id as string };
}

/** GET: return the firm's cached CH data and refresh status */
export async function GET() {
  const { error, firmId } = await getAuthFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const service = createServiceClient();
  const { data } = await service
    .from('ch_cache')
    .select('companies, refreshed_at, refresh_status, refresh_error, companies_fetched, companies_total, refresh_type')
    .eq('firm_id', firmId!)
    .single();

  if (!data) return NextResponse.json({ companies: [], refreshedAt: null, status: null });

  return NextResponse.json({
    companies: data.companies ?? [],
    refreshedAt: data.refreshed_at,
    status: data.refresh_status,
    error: data.refresh_error,
    companiesFetched: data.companies_fetched,
    companiesTotal: data.companies_total,
    refreshType: (data as { refresh_type?: string }).refresh_type ?? 'manual',
  });
}

const postSchema = z.object({
  companies: z.array(z.unknown()),
  status: z.enum(['success', 'partial', 'failed']),
  error: z.string().optional(),
  companiesFetched: z.number(),
  companiesTotal: z.number(),
  refreshType: z.enum(['manual', 'scheduled']).default('manual'),
});

/** POST: save fresh CH data to the cache (called after a manual refresh completes) */
export async function POST(request: NextRequest) {
  const { error, firmId } = await getAuthFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { error: upsertError } = await service
    .from('ch_cache')
    .upsert({
      firm_id: firmId!,
      companies: parsed.data.companies,
      refreshed_at: new Date().toISOString(),
      refresh_status: parsed.data.status,
      refresh_error: parsed.data.error ?? null,
      companies_fetched: parsed.data.companiesFetched,
      companies_total: parsed.data.companiesTotal,
      refresh_type: parsed.data.refreshType,
    }, { onConflict: 'firm_id' });

  if (upsertError) {
    console.error('POST /api/ch-secretarial/cache', upsertError);
    return NextResponse.json({ error: 'Failed to save cache' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
