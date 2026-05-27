import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage, type EmailMessage } from '@/lib/gmail';
import type { SupabaseClient } from '@supabase/supabase-js';

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Backfill timeline entries for messages in an already-allocated thread.
 *
 * When the user allocates a thread, we record an `email_allocations` row +
 * `client_timeline_notes` entry for that one message. Inbound replies that
 * arrive later don't trigger any server-side hook, so they sit on the thread
 * with no allocation row and never land on the client timeline — even though
 * the triage UI shows the thread as allocated (the badge is per-thread).
 *
 * This runs whenever a thread is opened: for every client the thread is
 * already allocated to, any message lacking a per-message allocation row
 * gets one, plus a matching timeline note. Legacy rows with NULL message_id
 * are anchored to the oldest message in the thread so subsequent runs are
 * deterministic.
 */
async function reconcileThreadAllocations(
  supabase: SupabaseClient,
  firmId: string,
  userId: string,
  threadId: string,
  messages: EmailMessage[],
): Promise<boolean> {
  if (messages.length === 0) return false;

  const { data: allocs } = await supabase
    .from('email_allocations')
    .select('id, client_id, message_id, timeline_entry_id')
    .eq('thread_id', threadId)
    .eq('firm_id', firmId);

  if (!allocs || allocs.length === 0) return false;

  const oldestMessageId = messages[0].id;
  const clientIds = Array.from(new Set(allocs.map(a => a.client_id as string)));
  let changed = false;

  for (const clientId of clientIds) {
    const clientAllocs = allocs.filter(a => a.client_id === clientId);

    // Anchor any legacy NULL rows to the oldest message so they stop matching
    // every new message as "the unallocated one".
    const nullRow = clientAllocs.find(a => a.message_id === null);
    if (nullRow) {
      const collides = clientAllocs.some(a => a.message_id === oldestMessageId);
      if (!collides) {
        await supabase
          .from('email_allocations')
          .update({ message_id: oldestMessageId })
          .eq('id', nullRow.id);
        nullRow.message_id = oldestMessageId;
      }
    }

    const allocatedMsgIds = new Set(
      clientAllocs.map(a => a.message_id).filter((id): id is string => !!id),
    );

    const missing = messages.filter(m => m.id && !allocatedMsgIds.has(m.id));
    if (missing.length === 0) continue;

    // Use the first message's subject as the canonical thread subject for
    // every new note — matches what the allocate route does.
    const subject = messages[0].subject || '(no subject)';

    for (const msg of missing) {
      const noteDate = msg.date
        ? new Date(msg.date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];

      const contentObj = {
        __smith_email__: true,
        threadId,
        subject,
        snippet: msg.snippet || '',
        fromName: msg.from?.name || '',
        fromEmail: msg.from?.email || '',
        date: msg.date,
        to: msg.to.length
          ? msg.to.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')
          : undefined,
        cc: msg.cc.length
          ? msg.cc.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')
          : undefined,
        sentAt: msg.date || undefined,
        bodyText: msg.body ? stripHtml(msg.body).slice(0, 3000) : undefined,
        attachments: msg.attachments.length
          ? msg.attachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, size: a.size }))
          : undefined,
      };

      const { data: note, error: noteError } = await supabase
        .from('client_timeline_notes')
        .insert({
          firm_id: firmId,
          client_id: clientId,
          user_id: userId,
          title: subject,
          content: JSON.stringify(contentObj),
          note_type: 'email',
          note_date: noteDate,
          is_pinned: false,
        })
        .select('id')
        .single();

      if (noteError || !note) {
        console.error('reconcileThreadAllocations: timeline insert failed', noteError);
        continue;
      }

      const { error: allocError } = await supabase.from('email_allocations').insert({
        firm_id: firmId,
        user_id: userId,
        thread_id: threadId,
        message_id: msg.id,
        client_id: clientId,
        timeline_entry_id: note.id,
        subject,
      });

      if (allocError) {
        // Race: another request inserted the same (thread, client, message). Roll back the orphan note.
        console.error('reconcileThreadAllocations: allocation insert failed', allocError);
        await supabase.from('client_timeline_notes').delete().eq('id', note.id);
        continue;
      }

      changed = true;
    }
  }

  return changed;
}

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

    // Backfill timeline entries for any inbound replies that arrived after
    // the thread was first allocated. Cheap when there's nothing to do.
    await reconcileThreadAllocations(supabase, ctx.firmId, ctx.userId, params.id, messages);

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
