import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getGmailOAuthClient } from '@/lib/gmail';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  // `state` is set by the connect route and tells us which settings tab to land on
  const state = searchParams.get('state');
  const returnTab = state === 'proposals' ? 'proposals' : 'email-triage';

  if (error || !code) {
    return NextResponse.redirect(`${origin}/settings?tab=${returnTab}&email=cancelled`);
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
    return NextResponse.redirect(`${origin}/settings?tab=${returnTab}&email=error`);
  }

  try {
    const client = getGmailOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const googleEmail = userInfo.data.email ?? null;
    if (!googleEmail) throw new Error('Could not retrieve Google email');

    // Dedicated proposals connection — stored in its own table so a firm can
    // link a shared "hello@firm.co.uk" Gmail without conflicting with each
    // staff member's personal Triage Gmail.
    if (state === 'proposals') {
      if (!tokens.refresh_token) {
        // Google only returns a refresh token on first consent or with prompt=consent.
        // Surface clearly rather than silently store a broken connection.
        return NextResponse.redirect(`${origin}/settings?tab=proposals&email=error`);
      }
      const proposalTokenData = {
        firm_id: profile.firm_id,
        connected_by_user_id: user.id,
        google_email: googleEmail,
        access_token: tokens.access_token ?? null,
        refresh_token: tokens.refresh_token,
        token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await supabase
        .from('proposal_email_connections')
        .select('id')
        .eq('firm_id', profile.firm_id)
        .eq('google_email', googleEmail)
        .maybeSingle();
      if (existing) {
        await supabase.from('proposal_email_connections').update(proposalTokenData).eq('id', existing.id);
      } else {
        await supabase.from('proposal_email_connections').insert(proposalTokenData);
      }
      return NextResponse.redirect(`${origin}/settings?tab=proposals&email=connected`);
    }

    // Email Triage path — one connection per user
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

    return NextResponse.redirect(`${origin}/settings?tab=${returnTab}&email=connected`);
  } catch (err) {
    console.error('Gmail OAuth callback error:', err);
    return NextResponse.redirect(`${origin}/settings?tab=${returnTab}&email=error`);
  }
}
