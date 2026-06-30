import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .eq('firm_id', profile.firm_id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('GET /api/users', error);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }

  // Derive a "pending" flag (invited but never signed in) from auth state, so
  // the team list can show a Pending badge + Resend without a separate
  // invitations table. One admin listUsers call, mapped by id.
  const pendingById = new Map<string, boolean>();
  try {
    const service = createServiceClient();
    const { data: authList } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const au of authList?.users ?? []) {
      pendingById.set(au.id, !au.last_sign_in_at);
    }
  } catch (e) {
    console.error('GET /api/users pending-state', e);
  }

  const withPending = (users ?? []).map(u => ({ ...u, pending: pendingById.get(u.id) ?? false }));

  return NextResponse.json({ users: withPending });
}
