import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/mtd-it/clients/bulk-import
//   Body: { client_refs: string[] }
//   Marks every matching client (by client_ref, within the user's firm) as
//   mtd_it=true. Returns which refs were matched and which were not found.
const Schema = z.object({
  client_refs: z.array(z.string().min(1)).min(1).max(2000),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  // Normalise: trim + uppercase comparison is too aggressive (refs are case-sensitive
  // in this app), so only trim. De-duplicate while preserving order for clear reporting.
  const seen = new Set<string>();
  const refs = parsed.data.client_refs
    .map(r => r.trim())
    .filter(r => r.length > 0 && !seen.has(r) && (seen.add(r), true));

  if (refs.length === 0) {
    return NextResponse.json({ matched: [], not_found: [], added: 0 });
  }

  const supabase = createClient();
  const { data: matched, error } = await supabase
    .from('clients')
    .select('id, client_ref, mtd_it')
    .eq('firm_id', ctx.firmId)
    .in('client_ref', refs);

  if (error) {
    console.error('POST /api/mtd-it/clients/bulk-import select', error);
    return NextResponse.json({ error: 'Failed to lookup clients' }, { status: 500 });
  }

  const matchedRefs = new Set((matched ?? []).map(c => c.client_ref).filter(Boolean) as string[]);
  const not_found = refs.filter(r => !matchedRefs.has(r));

  const toUpdate = (matched ?? []).filter(c => !c.mtd_it).map(c => c.id);
  let added = 0;
  if (toUpdate.length > 0) {
    const { error: upErr } = await supabase
      .from('clients')
      .update({ mtd_it: true })
      .in('id', toUpdate);
    if (upErr) {
      console.error('POST /api/mtd-it/clients/bulk-import update', upErr);
      return NextResponse.json({ error: 'Failed to update clients' }, { status: 500 });
    }
    added = toUpdate.length;
  }

  return NextResponse.json({
    matched: Array.from(matchedRefs),
    not_found,
    added,
    already_on: (matched ?? []).filter(c => c.mtd_it).length,
  });
}
