import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { isModuleActiveForFirm } from '@/lib/modules';
import { syncCHDeadlineLinks } from '@/lib/chDeadlineSync';
import { fetchCompany, RateLimitError } from '../route';

/**
 * POST /api/ch-secretarial/scan-client  { clientId }
 *
 * On-demand Companies House scan for ONE client — so a task can be linked to a
 * CH deadline before the client has been through a full CH Secretarial refresh
 * (the onboarding pain point). Fetches the company live, MERGES it into the
 * firm's ch_cache (one row per firm, a companies[] array — so we read-modify-
 * write, never replace), and returns the four deadline dates. The freshly
 * scanned client then also shows up in the CH Secretarial tool.
 */

const Body = z.object({ clientId: z.string().uuid() });

function isChEntityType(businessType: string | null): boolean {
  if (!businessType) return false;
  const t = businessType.toLowerCase();
  return t.includes('limited') || t.includes('ltd') || t === 'limited_company' || t.includes('llp');
}

function normNumber(n: string): string {
  return n.trim().toUpperCase().padStart(8, '0');
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isModuleActiveForFirm('ch-secretarial', ctx.activeModules)) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createClient();
  const { data: clientRow } = await supabase
    .from('clients')
    .select('companies_house_id, business_type, firm_id')
    .eq('id', parsed.data.clientId)
    .maybeSingle();
  const client = clientRow as { companies_house_id: string | null; business_type: string | null; firm_id: string } | null;
  if (!client || client.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (!isChEntityType(client.business_type) || !client.companies_house_id) {
    return NextResponse.json({ error: 'This client has no Companies House number to scan.' }, { status: 400 });
  }

  // Per-firm CH API key (service client bypasses RLS on firms).
  const service = createServiceClient();
  const { data: firm } = await service.from('firms').select('ch_api_key').eq('id', ctx.firmId).single();
  const apiKey = (firm as { ch_api_key?: string } | null)?.ch_api_key;
  if (!apiKey) return NextResponse.json({ error: 'NO_API_KEY' }, { status: 422 });

  // Live fetch — the only network call.
  let company;
  try {
    company = await fetchCompany(client.companies_house_id, apiKey);
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
    console.error('scan-client fetchCompany', err);
    return NextResponse.json({ error: 'Could not reach Companies House. Please try again.' }, { status: 502 });
  }

  // Merge into the firm's cache row (read-modify-write — never clobber the
  // other companies already cached).
  const { data: existing } = await service
    .from('ch_cache').select('companies').eq('firm_id', ctx.firmId).maybeSingle();
  const arr = (Array.isArray(existing?.companies) ? [...(existing!.companies as Array<Record<string, unknown>>)] : []);
  const target = normNumber(client.companies_house_id);
  const idx = arr.findIndex(c => typeof c?.companyNumber === 'string' && normNumber(c.companyNumber as string) === target);
  if (idx >= 0) arr[idx] = company as unknown as Record<string, unknown>;
  else arr.push(company as unknown as Record<string, unknown>);

  if (existing) {
    // Preserve the existing refresh metadata (this isn't a full refresh) — just
    // update the companies array + the total.
    await service.from('ch_cache').update({ companies: arr, companies_total: arr.length }).eq('firm_id', ctx.firmId);
  } else {
    await service.from('ch_cache').insert({
      firm_id: ctx.firmId,
      companies: arr,
      refreshed_at: new Date().toISOString(),
      refresh_status: 'partial',
      companies_fetched: 1,
      companies_total: 1,
      refresh_type: 'manual',
    });
  }

  // Slide any task already linked to this company's deadlines onto the fresh
  // dates (best-effort — the scan itself has already succeeded).
  try {
    await syncCHDeadlineLinks(service, ctx.firmId, [company as unknown as {
      companyNumber: string; accountsNextDue: string | null; csNextDue: string | null;
      nearestOfficerIdvDue: string | null; nearestPscIdvDue: string | null;
    }]);
  } catch (e) {
    console.error('scan-client deadline-links sync failed', e);
  }

  return NextResponse.json({
    success: true,
    deadlines: {
      accounts_due: company.accountsNextDue ?? null,
      cs_due: company.csNextDue ?? null,
      officer_idv_due: company.nearestOfficerIdvDue ?? null,
      psc_idv_due: company.nearestPscIdvDue ?? null,
    },
  });
}
