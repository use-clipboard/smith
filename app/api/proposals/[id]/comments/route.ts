import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({ body: z.string().min(1) });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data } = await supabase
    .from('proposal_comments')
    .select('id, user_id, author_name, body, created_at, user:users!user_id(full_name, email, avatar_url)')
    .eq('proposal_id', params.id)
    .order('created_at', { ascending: true });
  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  // Make sure the proposal is in our firm
  const { data: prop } = await supabase.from('proposals').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).maybeSingle();
  if (!prop) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: me } = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const { data: created, error } = await supabase
    .from('proposal_comments')
    .insert({
      proposal_id: params.id,
      user_id: ctx.userId,
      author_name: me?.full_name ?? me?.email ?? null,
      body: body.body,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comment: created });
}
