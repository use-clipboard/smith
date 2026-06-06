import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { normaliseNino } from '@/lib/hmrc/mtdItServer';

// ── POST /api/mtd-it/agent/import-identifiers ────────────────────────────────
// Bulk-set NINO / Self Assessment UTR for many clients at once (grid edit or
// CSV import). Each row matches a client by id or by client_ref within the
// firm. Admin only. Returns a per-row outcome so the UI can show what stuck.
const UTR = /^\d{10}$/;

const Body = z.object({
  rows: z.array(z.object({
    clientId:  z.string().uuid().optional(),
    clientRef: z.string().optional(),
    nino:      z.string().optional(),
    utr:       z.string().optional(),
  })).min(1).max(2000),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const service = createServiceClient();
  // Load the firm's clients once for ref → id resolution.
  const { data: clients } = await service
    .from('clients').select('id, client_ref').eq('firm_id', ctx.firmId);
  const byId = new Map((clients ?? []).map(c => [c.id as string, c]));
  const byRef = new Map((clients ?? []).filter(c => c.client_ref).map(c => [(c.client_ref as string).toLowerCase(), c]));

  let updated = 0;
  const skipped: { ref: string; reason: string }[] = [];

  for (const row of body.rows) {
    const label = row.clientId ?? row.clientRef ?? '(unknown)';
    const client = row.clientId ? byId.get(row.clientId)
      : row.clientRef ? byRef.get(row.clientRef.toLowerCase()) : undefined;
    if (!client) { skipped.push({ ref: label, reason: 'No matching client in this firm.' }); continue; }

    const patch: { national_insurance_number?: string | null; utr_number?: string | null } = {};
    if (row.nino !== undefined && row.nino.trim() !== '') {
      const n = normaliseNino(row.nino);
      if (!n) { skipped.push({ ref: label, reason: `Invalid NINO "${row.nino}".` }); continue; }
      patch.national_insurance_number = n;
    }
    if (row.utr !== undefined && row.utr.trim() !== '') {
      const u = row.utr.replace(/\s/g, '');
      if (!UTR.test(u)) { skipped.push({ ref: label, reason: `Invalid UTR "${row.utr}".` }); continue; }
      patch.utr_number = u;
    }
    if (Object.keys(patch).length === 0) { skipped.push({ ref: label, reason: 'Nothing to update.' }); continue; }

    const { error } = await service.from('clients').update(patch).eq('id', client.id).eq('firm_id', ctx.firmId);
    if (error) { skipped.push({ ref: label, reason: error.message }); continue; }
    updated++;
  }

  return NextResponse.json({ updated, skipped });
}
