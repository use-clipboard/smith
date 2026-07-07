import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';

export const dynamic = 'force-dynamic';

// GET /api/accounts-studio/prior-disclosures?clientId=&periodEnd=&excludeId=
//
// Returns the drafted note wording from this client's most recent EARLIER set of
// accounts, so the user can roll a note's text forward year to year. periodEnd
// is dd-mm-yyyy; we return the notes (id → title + HTML) from the latest
// engagement for the client whose year-end is before the current one.

/** dd-mm-yyyy → sortable yyyymmdd number (0 if unparseable). */
function sortable(dmy: string): number {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((dmy || '').trim());
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 0;
}

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const periodEnd = url.searchParams.get('periodEnd') || '';
  const excludeId = url.searchParams.get('excludeId') || '';
  if (!clientId) return NextResponse.json({ found: false, notes: {} });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', clientId);
  if (error) return NextResponse.json({ found: false, notes: {} });

  const cur = sortable(periodEnd);
  const candidates = (data ?? [])
    .filter(r => r.id !== excludeId)
    .map(r => ({ id: r.id as string, d: r.data as Record<string, unknown> }))
    .map(r => ({ ...r, pe: sortable((r.d?.periodEnd as string) ?? '') }))
    .filter(r => r.pe > 0 && (cur === 0 || r.pe < cur))
    .sort((a, b) => b.pe - a.pe);

  const prior = candidates[0];
  if (!prior) return NextResponse.json({ found: false, notes: {} });

  const disclosures = Array.isArray(prior.d.disclosures) ? prior.d.disclosures as { id?: string; title?: string; content?: string }[] : [];
  const notes: Record<string, { title: string; content: string }> = {};
  for (const s of disclosures) {
    if (s?.id && typeof s.content === 'string' && s.content.trim()) {
      notes[s.id] = { title: s.title ?? s.id, content: s.content };
    }
  }
  return NextResponse.json({ found: true, periodEnd: (prior.d.periodEnd as string) ?? '', notes });
}
