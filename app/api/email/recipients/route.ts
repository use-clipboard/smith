import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length < 1) return NextResponse.json({ results: [] });

  const supabase = createClient();

  // Search clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, client_ref, contact_email, risk_rating')
    .eq('firm_id', ctx.firmId)
    .or(`name.ilike.%${q}%,client_ref.ilike.%${q}%,contact_email.ilike.%${q}%`)
    .limit(10);

  // Search team members
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('firm_id', ctx.firmId)
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .limit(5);

  // Search the user's recent recipients (suppliers / one-off contacts they've
  // emailed before), ranked by how often + how recently.
  const { data: recents } = await supabase
    .from('email_recent_recipients')
    .select('email, name, send_count')
    .eq('user_id', ctx.userId)
    .or(`email.ilike.%${q}%,name.ilike.%${q}%`)
    .order('send_count', { ascending: false })
    .order('last_sent_at', { ascending: false })
    .limit(8);

  const clientResults = (clients ?? [])
    .filter(c => c.contact_email)
    .map(c => ({
      type: 'client' as const,
      id: c.id,
      name: c.name,
      email: c.contact_email!,
      clientRef: c.client_ref ?? '',
      status: (c.risk_rating ?? 'active') as string,
    }));

  const teamResults = (users ?? [])
    .filter(u => u.email)
    .map(u => ({
      type: 'team' as const,
      id: u.id,
      name: u.full_name ?? u.email,
      email: u.email,
      clientRef: null,
      status: null,
    }));

  // Don't show a recent recipient that's already surfaced as a client or team
  // member — they belong under their proper group (with the client ref etc.).
  const known = new Set([...clientResults, ...teamResults].map(r => r.email.toLowerCase()));
  const recentResults = (recents ?? [])
    .filter(r => r.email && !known.has(r.email.toLowerCase()))
    .map(r => ({
      type: 'recent' as const,
      id: `recent:${r.email}`,
      name: r.name ?? '',
      email: r.email,
      clientRef: null,
      status: null,
    }));

  return NextResponse.json({ results: [...clientResults, ...teamResults, ...recentResults] });
}
