import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage } from '@/lib/gmail';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

    const threadRes = await gmail.users.threads.get({
      userId: 'me',
      id: params.id,
      format: 'full',
    });

    const messages = (threadRes.data.messages ?? []).map(m =>
      parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
    );

    // Mark thread as read — requires gmail.modify scope; silently skip if not granted
    try {
      await gmail.users.threads.modify({
        userId: 'me',
        id: params.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch {
      // scope not granted yet — user needs to reconnect after scope update
    }

    // Fetch existing allocations for this thread
    const { data: allocations } = await supabase
      .from('email_allocations')
      .select('client_id, clients(id, name, client_ref, risk_rating), user_id, users(full_name)')
      .eq('thread_id', params.id)
      .eq('firm_id', ctx.firmId);

    // Fetch task links for this thread
    const { data: taskLinks } = await supabase
      .from('email_task_links')
      .select('task_id, tasks(id, title, status)')
      .eq('thread_id', params.id)
      .eq('firm_id', ctx.firmId);

    await supabase
      .from('email_connections')
      .update({ access_token: accessToken, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId);

    return NextResponse.json({
      threadId: params.id,
      messages,
      allocations: allocations ?? [],
      taskLinks: taskLinks ?? [],
      googleEmail: connection.google_email,
    });
  } catch (err) {
    console.error('Email thread fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 });
  }
}
