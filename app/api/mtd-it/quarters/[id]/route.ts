import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const StreamsSchema = z.object({
  sole:           z.boolean(),
  uk_rental:      z.boolean(),
  foreign_rental: z.boolean(),
});

const PatchSchema = z.object({
  streams_snapshot:     StreamsSchema.optional(),
  consolidated:         z.boolean().optional(),
  fx_rates:             z.record(z.string(), z.number().positive()).optional(),
  status:               z.enum(['draft', 'complete', 'sent', 'approved', 'submitted']).optional(),
  notes:                z.string().nullable().optional(),
}).strict();

async function checkQuarterFirmAccess(quarterId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('client_id, clients!inner(firm_id)')
    .eq('id', quarterId)
    .maybeSingle();
  if (!data) return false;
  // Supabase typings make this loose — coerce defensively
  const c = (data as unknown as { clients?: { firm_id?: string } }).clients;
  return c?.firm_id === firmId;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const ok = await checkQuarterFirmAccess(params.id, ctx.firmId);
  if (!ok) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const supabase = createClient();
  const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

  const { error } = await supabase.from('mtd_it_quarters').update(updates).eq('id', params.id);
  if (error) {
    console.error('PATCH /api/mtd-it/quarters/[id]', error);
    return NextResponse.json({ error: 'Failed to update quarter' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
