import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { isModuleActiveForFirm } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import type { DeadlineType } from '@/lib/createChDeadlineLink';

/**
 * GET /api/ch-secretarial/client-deadlines?clientId=<uuid>
 *
 * Powers the "Companies House deadline" recurrence option in the task
 * creation modals. Tells the caller whether the selected client is eligible
 * for CH-deadline linking (firm has the CH Secretarial module, client is a
 * limited company / LLP, and has a Companies House number) and — when
 * eligible — the four cached deadline dates so the picker can show real dates
 * beside each option.
 *
 * Never a live CH call: reads the per-firm ch_cache that the nightly refresh
 * keeps up to date. A null date means the deadline isn't cached yet (e.g. the
 * company hasn't been refreshed, or IDV not yet posted) — still selectable,
 * the date is resolved server-side on save / next sync.
 */

const DEADLINE_TYPES: DeadlineType[] = ['accounts_due', 'cs_due', 'officer_idv_due', 'psc_idv_due'];

/** Does this client's business_type qualify for CH-deadline linking? */
function isChEntityType(businessType: string | null): boolean {
  if (!businessType) return false;
  const t = businessType.toLowerCase();
  return t.includes('limited') || t.includes('ltd') || t === 'limited_company'
    || t.includes('llp') || t === 'llp';
}

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  }

  const chModuleActive = isModuleActiveForFirm('ch-secretarial', ctx.activeModules);

  const supabase = createClient();

  // Resolve the client's entity type + CH number (RLS scopes to the firm, but
  // we also verify firm_id defensively).
  const { data: clientRow } = await supabase
    .from('clients')
    .select('companies_house_id, business_type, firm_id')
    .eq('id', clientId)
    .maybeSingle();

  const client = clientRow as { companies_house_id: string | null; business_type: string | null; firm_id: string } | null;
  if (!client || client.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const businessType = client.business_type ?? null;
  const companiesHouseId = client.companies_house_id ?? null;
  const eligible = chModuleActive && isChEntityType(businessType) && !!companiesHouseId;

  // Empty deadlines unless eligible — no point reading the cache otherwise.
  const deadlines: Record<DeadlineType, string | null> = {
    accounts_due: null,
    cs_due: null,
    officer_idv_due: null,
    psc_idv_due: null,
  };

  if (eligible && companiesHouseId) {
    const { data: cache } = await supabase
      .from('ch_cache')
      .select('companies')
      .eq('firm_id', ctx.firmId)
      .maybeSingle();

    const companies = (cache?.companies as Array<Record<string, unknown>> | null) ?? [];
    const norm = companiesHouseId.trim().toUpperCase().padStart(8, '0');
    const co = companies.find(c => {
      const n = c?.companyNumber;
      return typeof n === 'string' && n.trim().toUpperCase().padStart(8, '0') === norm;
    });
    if (co) {
      deadlines.accounts_due    = (co.accountsNextDue      as string | null) ?? null;
      deadlines.cs_due          = (co.csNextDue            as string | null) ?? null;
      deadlines.officer_idv_due = (co.nearestOfficerIdvDue as string | null) ?? null;
      deadlines.psc_idv_due     = (co.nearestPscIdvDue     as string | null) ?? null;
    }
  }

  return NextResponse.json({
    eligible,
    chModuleActive,
    businessType,
    companiesHouseId,
    deadlines,
    deadlineTypes: DEADLINE_TYPES,
  });
}
