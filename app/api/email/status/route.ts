import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data } = await supabase
    .from('email_connections')
    .select('google_email, inbox_label, show_as_threads, connected_at')
    .eq('user_id', ctx.userId)
    .single();

  return NextResponse.json({
    connected: !!data,
    googleEmail: data?.google_email ?? null,
    inboxLabel: data?.inbox_label ?? 'INBOX',
    showAsThreads: data?.show_as_threads ?? false,
    connectedAt: data?.connected_at ?? null,
  });
}
