import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

async function getPrimaryConnection() {
  const ctx = await getUserContext();
  if (!ctx) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();
  return data ?? null;
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const connection = await getPrimaryConnection();
  if (!connection?.refresh_token) return NextResponse.json({ signature: null });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const res = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const sendAs = res.data.sendAs ?? [];
    const primary =
      sendAs.find(s => s.isDefault) ??
      sendAs.find(s => s.sendAsEmail === connection.google_email) ??
      sendAs[0];

    return NextResponse.json({
      signature: primary?.signature ?? null,
      sendAsEmail: primary?.sendAsEmail ?? connection.google_email,
      displayName: primary?.displayName ?? null,
    });
  } catch (err) {
    console.error('Gmail signature fetch error:', err);
    return NextResponse.json({ signature: null });
  }
}

export async function PUT(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const connection = await getPrimaryConnection();
  if (!connection?.refresh_token) return NextResponse.json({ error: 'Not connected' }, { status: 400 });

  const { signature } = await req.json() as { signature: string };

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);

    // Find the primary send-as address to update
    const listRes = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const sendAs = listRes.data.sendAs ?? [];
    const primary =
      sendAs.find(s => s.isDefault) ??
      sendAs.find(s => s.sendAsEmail === connection.google_email) ??
      sendAs[0];

    if (!primary?.sendAsEmail) {
      return NextResponse.json({ error: 'No send-as address found' }, { status: 400 });
    }

    await gmail.users.settings.sendAs.update({
      userId: 'me',
      sendAsEmail: primary.sendAsEmail,
      requestBody: { signature: signature ?? '' },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Gmail signature update error:', err);
    return NextResponse.json({ error: 'Failed to update signature' }, { status: 500 });
  }
}
