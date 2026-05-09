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

    // Threading is fragile — Outlook/Gmail can break a thread when the user
    // forwards (different recipient, modified subject). The SENT forward then
    // lives in a separate thread, leaving this thread with no Fwd:/FW: SENT
    // message — so we can't show a "Forwarded · <date>" timestamp in the UI.
    //
    // As a fallback, do a cheap Sent-folder search for the same subject with
    // a forward prefix. We only return the latest match's date; the client
    // persists it to localStorage so the search runs once per thread.
    let externalForwardedAt: string | null = null;
    const FORWARD_PREFIX = /^(fwd|fw):/i;
    const hasInThreadForward = messages.some(m =>
      m.labelIds?.includes('SENT') && FORWARD_PREFIX.test(m.subject ?? ''),
    );
    if (!hasInThreadForward) {
      // Strip Re:/Fwd:/FW: prefixes from the original inbound subject so we
      // search for the bare topic + forward prefix.
      const original = messages.find(m => !m.labelIds?.includes('SENT'))?.subject
        ?? messages[0]?.subject
        ?? '';
      const baseSubject = original
        .replace(/^(re|fwd|fw):\s*/i, '')
        .replace(/^(re|fwd|fw):\s*/i, '') // strip a second prefix if present
        .trim();
      if (baseSubject.length > 1) {
        // Escape inner quotes so Gmail parses the search correctly.
        const safe = baseSubject.replace(/"/g, '\\"');
        const query = `in:sent (subject:"Fwd: ${safe}" OR subject:"FW: ${safe}")`;
        try {
          const searchRes = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 5,
          });
          const ids = (searchRes.data.messages ?? []).map(m => m.id).filter((id): id is string => !!id);
          if (ids.length > 0) {
            // Fetch the matched messages' headers so we can pick the latest by date.
            const headRes = await Promise.all(
              ids.map(id =>
                gmail.users.messages.get({
                  userId: 'me',
                  id,
                  format: 'metadata',
                  metadataHeaders: ['Date', 'Subject'],
                }).catch(() => null),
              ),
            );
            const dated = headRes
              .map(r => r ? parseGmailMessage(r.data as Parameters<typeof parseGmailMessage>[0]) : null)
              .filter((m): m is NonNullable<typeof m> => !!m && !!m.date);
            if (dated.length > 0) {
              const latest = dated.reduce((acc, m) =>
                (new Date(m.date).getTime() || 0) > (new Date(acc.date).getTime() || 0) ? m : acc
              );
              externalForwardedAt = latest.date;
            }
          }
        } catch {
          // Non-fatal — just leave externalForwardedAt as null.
        }
      }
    }

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
      externalForwardedAt,
    });
  } catch (err) {
    console.error('Email thread fetch error:', err);
    return NextResponse.json({ error: 'Failed to fetch thread' }, { status: 500 });
  }
}
