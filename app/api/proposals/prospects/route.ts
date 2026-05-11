import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const ClientType = z.enum(['sole_trader','limited_company','llp','partnership','charity','trust','individual','other']);
const Body = z.object({
  contact_name: z.string().min(1),
  company_name: z.string().nullable().optional(),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  client_type: ClientType.nullable().optional(),
  source: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const status = new URL(req.url).searchParams.get('status');
  const supabase = createClient();
  let q = supabase.from('proposal_prospects').select('*').eq('firm_id', ctx.firmId).order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prospects: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data, error } = await supabase
    .from('proposal_prospects')
    .insert({
      firm_id: ctx.firmId,
      contact_name: body.contact_name,
      company_name: body.company_name ?? null,
      email: body.email,
      phone: body.phone ?? null,
      client_type: body.client_type ?? null,
      source: body.source ?? null,
      notes: body.notes ?? null,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prospect: data });
}
