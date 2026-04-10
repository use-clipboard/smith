import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST() {
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

  await supabase
    .from('firm_settings')
    .update({
      google_drive_enabled: false,
      google_access_token: null,
      google_refresh_token: null,
      google_token_expiry: null,
      google_drive_folder_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('firm_id', profile.firm_id);

  return NextResponse.json({ success: true });
}
