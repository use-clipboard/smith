import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('firm_id')
    .eq('id', user.id)
    .single();

  if (!profile?.firm_id) {
    return NextResponse.json({ connected: false });
  }

  const { data: settings } = await supabase
    .from('firm_settings')
    .select('google_drive_enabled, google_drive_folder_id, google_drive_folder_name')
    .eq('firm_id', profile.firm_id)
    .single();

  return NextResponse.json({
    connected: settings?.google_drive_enabled ?? false,
    folderId: settings?.google_drive_folder_id ?? null,
    folderName: settings?.google_drive_folder_name ?? null,
  });
}
