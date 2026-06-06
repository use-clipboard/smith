import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── POST /api/mtd-it/clients/[clientId]/businesses/link ───────────────────────
// Persist (or clear) the HMRC businessId on a trade or property income source.
const BUSINESS_ID = /^X[A-Z0-9]IS[0-9]{11}$/;

const Body = z.object({
  target: z.object({ kind: z.enum(['trade', 'property']), id: z.string().uuid() }),
  businessId: z.string().regex(BUSINESS_ID).nullable(),  // null = unlink
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const service = createServiceClient();
  // Confirm the client belongs to the caller's firm.
  const { data: client } = await service
    .from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

  const table = body.target.kind === 'trade' ? 'mtd_it_trades' : 'mtd_it_properties';
  const { error } = await service
    .from(table).update({ hmrc_business_id: body.businessId })
    .eq('id', body.target.id).eq('client_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
