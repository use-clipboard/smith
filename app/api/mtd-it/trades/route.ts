import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Trades are a per-client list of sole-trader trades. A client can have
// multiple (e.g. a plumber who also runs a consultancy). The dashboard
// edit-pencil → properties / trades editor uses these.

async function clientBelongsToFirm(clientId: string, firmId: string): Promise<boolean> {
  const supabase = createClient();
  const { data } = await supabase.from('clients').select('firm_id').eq('id', clientId).maybeSingle();
  return (data as { firm_id?: string } | null)?.firm_id === firmId;
}

// GET /api/mtd-it/trades?client_id=...
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const clientId = new URL(req.url).searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  if (!(await clientBelongsToFirm(clientId, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_trades')
    .select('id, client_id, name, description, active, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });
  return NextResponse.json({ trades: data ?? [] });
}

// POST /api/mtd-it/trades  { client_id, name, description? }
const CreateSchema = z.object({
  client_id:   z.string().uuid(),
  name:        z.string().min(1),
  description: z.string().nullable().optional(),
});
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  if (!(await clientBelongsToFirm(parsed.data.client_id, ctx.firmId))) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('mtd_it_trades')
    .insert({ ...parsed.data, description: parsed.data.description ?? null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create trade' }, { status: 500 });
  return NextResponse.json({ trade: data }, { status: 201 });
}

// PATCH /api/mtd-it/trades?id=...  { name?, description?, active? }
const PatchSchema = z.object({
  name:        z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  active:      z.boolean().optional(),
}).strict();
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('mtd_it_trades')
    .select('id, client_id, clients!inner(firm_id)')
    .eq('id', id)
    .maybeSingle();
  const firm = (existing as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!existing || firm !== ctx.firmId) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const { error } = await supabase.from('mtd_it_trades').update(parsed.data).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/mtd-it/trades?id=...
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('mtd_it_trades')
    .select('id, clients!inner(firm_id)')
    .eq('id', id)
    .maybeSingle();
  const firm = (existing as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
  if (!existing || firm !== ctx.firmId) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

  const { error } = await supabase.from('mtd_it_trades').delete().eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
