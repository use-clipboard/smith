import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ count: 0 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ count: 0 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) return NextResponse.json({ count: 0 });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const label = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    return NextResponse.json({ count: label.data.threadsUnread ?? 0 });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
