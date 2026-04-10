import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Fetch the target user's email
  const { data: target } = await supabase
    .from('users')
    .select('email')
    .eq('id', params.id)
    .eq('firm_id', profile.firm_id)
    .single();

  if (!target?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const service = createServiceClient();
  const { error } = await service.auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
  });

  if (error) {
    console.error('reset-password', error);
    return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
