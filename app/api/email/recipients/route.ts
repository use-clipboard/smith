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

  return NextResponse.json({ results: [...clientResults, ...teamResults] });
}
