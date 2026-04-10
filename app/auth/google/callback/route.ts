import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getOAuthClient, createFolder, getDriveClient } from '@/lib/googleDrive';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?error=Google+Drive+connection+was+cancelled`);
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: profile } = await supabase
    .from('users')
    .select('firm_id')
    .eq('id', user.id)
    .single();

  if (!profile?.firm_id) {
    return NextResponse.redirect(`${origin}/settings?error=Firm+not+found`);
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);

    // Reuse existing "Agent Smith Files" folder if it already exists in Drive
    const drive = await getDriveClient(tokens.access_token!, tokens.refresh_token!);
    const searchRes = await drive.files.list({
      q: `name = 'Agent Smith Files' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents`,
      fields: 'files(id)',
      pageSize: 1,
    });
    let folderId: string;
    if (searchRes.data.files?.length) {
      folderId = searchRes.data.files[0].id!;
    } else {
      const folder = await createFolder({
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token!,
        name: 'Agent Smith Files',
      });
      folderId = folder.id!;
    }

    // Check if firm_settings row exists
    const { data: existing } = await supabase
      .from('firm_settings')
      .select('id')
      .eq('firm_id', profile.firm_id)
      .single();

    const settingsData = {
      firm_id: profile.firm_id,
      google_drive_enabled: true,
      google_drive_folder_id: folderId,
      google_access_token: tokens.access_token,
      google_refresh_token: tokens.refresh_token,
      google_token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await supabase
        .from('firm_settings')
        .update(settingsData)
        .eq('firm_id', profile.firm_id);
    } else {
      await supabase.from('firm_settings').insert(settingsData);
    }

    return NextResponse.redirect(`${origin}/settings?drive=connected`);
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(`${origin}/settings?error=Failed+to+connect+Google+Drive`);
  }
}
