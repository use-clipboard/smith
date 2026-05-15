import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// PATCH /api/mtd-it/clients/[id]
//   Partial update for the MTD IT dashboard. Allowed fields are the subset of
//   the clients table that the dashboard edit modal / inline notes editor
//   surfaces: core identity fields, the MTD-IT-specific stream selection,
//   quarter type, and the shared notes pad.
//   Firm scoping is enforced by checking the client belongs to the caller's
//   firm before applying the update.

const StreamsSchema = z.object({
  sole:           z.boolean(),
  uk_rental:      z.boolean(),
  foreign_rental: z.boolean(),
});

const PatchSchema = z.object({
  name:                       z.string().min(1).optional(),
  client_ref:                 z.string().min(1).optional(),
  status:                     z.enum(['active', 'hold', 'inactive']).optional(),
  address:                    z.string().nullable().optional(),
  utr_number:                 z.string().nullable().optional(),
  national_insurance_number:  z.string().nullable().optional(),
  date_of_birth:              z.string().nullable().optional(),
  contact_email:              z.string().email().or(z.literal('')).nullable().optional(),
  mtd_it_quarter_type:        z.enum(['calendar', 'standard']).optional(),
  mtd_it_streams:             StreamsSchema.optional(),
  mtd_it_notes:               z.string().nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Confirm the client exists and belongs to this firm
  const { data: existing } = await supabase
    .from('clients')
    .select('id, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing || existing.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  // Normalise empty-string contact_email to null so the column constraint stays clean
  const updates: Record<string, unknown> = { ...parsed.data };
  if (updates.contact_email === '') updates.contact_email = null;

  // If client_ref is being changed, ensure no other client in the firm already has it
  if (typeof updates.client_ref === 'string') {
    const { data: clash } = await supabase
      .from('clients')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .eq('client_ref', updates.client_ref)
      .neq('id', params.id)
      .maybeSingle();
    if (clash) return NextResponse.json({ error: `Client reference "${updates.client_ref}" already exists` }, { status: 409 });
  }

  const { error } = await supabase.from('clients').update(updates).eq('id', params.id);
  if (error) {
    console.error('PATCH /api/mtd-it/clients/[id]', error);
    return NextResponse.json({ error: 'Failed to update client' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
