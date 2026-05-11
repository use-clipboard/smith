import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Signer = z.object({
  signer_name: z.string().min(1),
  signer_email: z.string().email(),
  signer_role: z.string().nullable().optional(),
});
const Body = z.object({ signers: z.array(Signer) });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data } = await supabase
    .from('proposal_required_signers')
    .select('*')
    .eq('proposal_id', params.id)
    .order('display_order');
  return NextResponse.json({ signers: data ?? [] });
}

// PUT replaces the full list — simplest semantics.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data: prop } = await supabase.from('proposals').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!prop) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await supabase.from('proposal_required_signers').delete().eq('proposal_id', params.id);
  if (body.signers.length > 0) {
    const rows = body.signers.map((s, i) => ({
      proposal_id: params.id,
      signer_name: s.signer_name,
      signer_email: s.signer_email,
      signer_role: s.signer_role ?? null,
      display_order: i,
    }));
    await supabase.from('proposal_required_signers').insert(rows);
  }
  return NextResponse.json({ ok: true });
}
