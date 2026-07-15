import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// PATCH /api/mtd-it/approvals/[id]/reminders  { paused: boolean }
//
// Turns auto-chasing off (or back on) for ONE quarter's approval, without
// touching the firm-wide reminder setting. The case this exists for: the client
// is signing a paper copy, so an automated "you haven't responded" email would
// be wrong and look careless.
//
// Twin of /api/landlord/approvals/[id]/reminders.

const BodySchema = z.object({ paused: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const service = createServiceClient();

  const { data: row } = await supabase
    .from('mtd_it_quarter_approvals')
    .select('id, mtd_it_quarters!inner(clients!inner(firm_id))')
    .eq('id', params.id)
    .maybeSingle();
  const firmId = (row as unknown as { mtd_it_quarters?: { clients?: { firm_id?: string } } } | null)
    ?.mtd_it_quarters?.clients?.firm_id;
  if (!row || firmId !== ctx.firmId) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });

  const { error } = await service
    .from('mtd_it_quarter_approvals')
    .update({ reminders_paused: parsed.data.paused })
    .eq('id', params.id);
  if (error) {
    console.error('PATCH /api/mtd-it/approvals/[id]/reminders', error);
    return NextResponse.json({ error: 'Failed to update reminders' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, paused: parsed.data.paused });
}
