import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getGmailOAuthClient } from '@/lib/gmail';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?tab=email-triage&email=cancelled`);
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
    return NextResponse.redirect(`${origin}/settings?tab=email-triage&email=error`);
  }

  try {
    const client = getGmailOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const googleEmail = userInfo.data.email ?? null;
    if (!googleEmail) throw new Error('Could not retrieve Google email');

    const tokenData = {
      user_id: user.id,
      firm_id: profile.firm_id,
      google_email: googleEmail,
      access_token: tokens.access_token ?? null,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('email_connections')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      await supabase.from('email_connections').update(tokenData).eq('user_id', user.id);
    } else {
      await supabase.from('email_connections').insert(tokenData);
    }

    return NextResponse.redirect(`${origin}/settings?tab=email-triage&email=connected`);
  } catch (err) {
    console.error('Gmail OAuth callback error:', err);
    return NextResponse.redirect(`${origin}/settings?tab=email-triage&email=error`);
  }
}
