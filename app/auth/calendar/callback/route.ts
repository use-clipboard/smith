import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCalendarOAuthClient } from '@/lib/googleCalendar';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?calendar=cancelled`);
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const client = getCalendarOAuthClient();
    const { tokens } = await client.getToken(code);

    // Get the Google account email for display purposes
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const googleEmail = userInfo.data.email ?? null;

    // Upsert tokens for this user
    const tokenData = {
      user_id: user.id,
      google_access_token: tokens.access_token ?? null,
      google_refresh_token: tokens.refresh_token ?? null,
      google_token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      google_email: googleEmail,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('calendar_tokens')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      await supabase
        .from('calendar_tokens')
        .update(tokenData)
        .eq('user_id', user.id);
    } else {
      await supabase.from('calendar_tokens').insert(tokenData);
    }

    return NextResponse.redirect(`${origin}/settings?tab=calendar&calendar=connected`);
  } catch (err) {
    console.error('Google Calendar OAuth callback error:', err);
    return NextResponse.redirect(`${origin}/settings?calendar=error`);
  }
}
