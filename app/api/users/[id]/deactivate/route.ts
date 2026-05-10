import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';

// POST /api/users/[id]/deactivate
// Soft-disables login by banning the auth account for ~100 years.
// Preserves the public.users row and all HR data so attribution / audit history
// remains intact.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  if (params.id === user.id) return NextResponse.json({ error: 'You cannot deactivate yourself' }, { status: 400 });

  // Confirm target is in the same firm
  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id, role')
    .eq('id', params.id)
    .single();
  if (!target || target.firm_id !== profile.firm_id) {
    return NextResponse.json({ error: 'Not found in your firm' }, { status: 404 });
  }
  // Don't allow deactivating the last admin
  if (target.role === 'admin') {
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', profile.firm_id)
      .eq('role', 'admin')
      .neq('id', target.id);
    if ((count ?? 0) < 1) {
      return NextResponse.json({ error: 'Cannot deactivate the last admin in the firm.' }, { status: 400 });
    }
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(params.id, { ban_duration: '876000h' });
  if (error) {
    console.error('[POST /api/users/:id/deactivate]', error);
    return NextResponse.json({ error: 'Failed to deactivate login' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/users/[id]/deactivate — undo (re-enable login)
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const { data: target } = await supabase
    .from('users')
    .select('id, firm_id')
    .eq('id', params.id)
    .single();
  if (!target || target.firm_id !== profile.firm_id) {
    return NextResponse.json({ error: 'Not found in your firm' }, { status: 404 });
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(params.id, { ban_duration: 'none' });
  if (error) {
    console.error('[DELETE /api/users/:id/deactivate]', error);
    return NextResponse.json({ error: 'Failed to re-enable login' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
