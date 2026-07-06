import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { chGet, normaliseCompanyNumber, ChRateLimitError, ChBadKeyError } from '@/lib/companiesHouse';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface CHAddr { address_line_1?: string; address_line_2?: string; locality?: string; region?: string; postal_code?: string; country?: string }
interface CHProfile {
  company_number?: string;
  company_name?: string;
  type?: string;
  company_status?: string;
  date_of_creation?: string;
  registered_office_address?: CHAddr;
  sic_codes?: string[];
  accounts?: { next_due?: string; next_accounts?: { due_on?: string } };
}
interface CHOfficersResp { items?: Array<{ name?: string; officer_role?: string; resigned_on?: string }> }

/** yyyy-mm-dd → dd-mm-yyyy (empty in → null). */
function isoToUk(iso?: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${m}-${y}` : null;
}

/** CH company `type` → Accounts Studio entity type. */
function entityFromChType(t?: string): string {
  const v = (t ?? '').toLowerCase();
  if (v === 'llp') return 'llp';
  if (v === 'limited-partnership') return 'partnership';
  if (v === 'community-interest-company' || v.includes('community-interest')) return 'cic';
  if (v === 'charitable-incorporated-organisation' || v.includes('charitable')) return 'charity';
  return 'limited_company';
}

function joinAddress(a?: CHAddr): string | null {
  if (!a) return null;
  const parts = [a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

// ── GET /api/accounts-studio/company-lookup?clientId=&number= ─────────────────
// Look up a company on Companies House (by explicit number, or the client's
// stored companies_house_id) and return a compact profile mapped for Accounts
// Studio. Reuses the firm's CH API key.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('accounts-studio')) return moduleNotActive('accounts-studio');

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  let number = url.searchParams.get('number');

  const supabase = createClient();

  // Resolve the number from the client record when not given explicitly.
  if (!number && clientId) {
    const { data: client } = await supabase
      .from('clients').select('companies_house_id').eq('id', clientId).eq('firm_id', ctx.firmId).maybeSingle();
    number = (client?.companies_house_id as string | null) ?? null;
  }
  if (!number) return NextResponse.json({ found: false, reason: 'no_number' });

  // Firm's CH API key (service client — mirrors CH Secretarial).
  const service = createServiceClient();
  const { data: firm } = await service.from('firms').select('ch_api_key').eq('id', ctx.firmId).single();
  const apiKey = (firm as { ch_api_key?: string } | null)?.ch_api_key;
  if (!apiKey) return NextResponse.json({ found: false, reason: 'no_api_key' });

  const n = normaliseCompanyNumber(number);
  try {
    const profile = await chGet<CHProfile>(`/company/${n}`, apiKey);
    if (!profile) return NextResponse.json({ found: false, reason: 'not_found' });

    // Officers are best-effort — a profile is still useful without them.
    let directors: string[] = [];
    try {
      const officers = await chGet<CHOfficersResp>(`/company/${n}/officers?items_per_page=100`, apiKey);
      directors = (officers?.items ?? [])
        .filter(o => !o.resigned_on && /director|member/i.test(o.officer_role ?? ''))
        .map(o => cleanName(o.name))
        .filter(Boolean);
    } catch { /* ignore officer errors */ }

    const accountsDue = isoToUk(profile.accounts?.next_accounts?.due_on ?? profile.accounts?.next_due ?? null);

    return NextResponse.json({
      found: true,
      company: {
        companyNumber: profile.company_number ?? n,
        companyName: profile.company_name ?? '',
        entityType: entityFromChType(profile.type),
        chType: profile.type ?? '',
        status: profile.company_status ?? '',
        incorporationDate: isoToUk(profile.date_of_creation),
        registeredOffice: joinAddress(profile.registered_office_address),
        sicCodes: profile.sic_codes ?? [],
        accountsNextDue: accountsDue,
        directors,
      },
    });
  } catch (e) {
    if (e instanceof ChRateLimitError) return NextResponse.json({ found: false, reason: 'rate_limited' }, { status: 429 });
    if (e instanceof ChBadKeyError) return NextResponse.json({ found: false, reason: 'bad_key' }, { status: 422 });
    return NextResponse.json({ found: false, reason: 'error', error: e instanceof Error ? e.message : 'lookup failed' }, { status: 500 });
  }
}

/** CH officer names come "SURNAME, Forename" — flip to "Forename Surname". */
function cleanName(raw?: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (!m) return s;
  return `${m[2].trim()} ${m[1].trim()}`.replace(/\s+/g, ' ');
}
