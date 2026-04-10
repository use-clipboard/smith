import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';

// GET /api/users/team — all users in the same firm
export async function GET() {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('firm_id').eq('id', user.id).single();
  if (!profile?.firm_id) return NextResponse.json({ members: [] });

  const { data: members, error } = await service
    .from('users')
    .select('id, full_name, email, role')
    .eq('firm_id', profile.firm_id)
    .order('full_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ members });
}
