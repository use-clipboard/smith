import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage } from '@/lib/gmail';

const AllocateSchema = z.object({
  threadId: z.string().min(1),
  /** Gmail message id of the specific message being allocated. When set, the
   *  allocation is recorded per-message so follow-up messages on an already-
   *  allocated thread each get their own timeline entry. When absent, we
   *  fall back to thread-level dedupe for backwards compatibility. */
  messageId: z.string().optional(),
  subject: z.string(),
  snippet: z.string().optional().default(''),
  date: z.string().optional().default(''),
  fromName: z.string().optional().default(''),
  fromEmail: z.string().optional().default(''),
  clientIds: z.array(z.string().uuid()).min(1),
});

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Block-level tags become newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace while preserving line breaks
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AllocateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { threadId, messageId, subject, snippet, date, fromName, fromEmail, clientIds } = parsed.data;
  const supabase = createClient();

  // Fetch full thread from Gmail to get body, attachments, and addressing
  let bodyText = '';
  let attachments: { filename: string; mimeType: string; size: number }[] = [];
  let toAddresses = '';
  let ccAddresses = '';
  let bccAddresses = '';
  let sentAt = '';
  try {
    const { data: connection } = await supabase
      .from('email_connections')
      .select('refresh_token')
      .eq('user_id', ctx.userId)
      .single();

    if (connection?.refresh_token) {
      const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'full',
      });
      const rawMessages = threadRes.data.messages ?? [];
      const messages = rawMessages.map(m =>
        parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
      );
      const lastMsg = messages[messages.length - 1];
      const rawLastMsg = rawMessages[rawMessages.length - 1];
      if (lastMsg) {
        bodyText = stripHtml(lastMsg.body).slice(0, 3000);
        attachments = lastMsg.attachments
          .filter(a => a.attachmentId)
          .map(a => ({ filename: a.filename, mimeType: a.mimeType, size: a.size }));
        toAddresses = lastMsg.to.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ');
        ccAddresses = lastMsg.cc.length
          ? lastMsg.cc.map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(', ')
          : '';
        bccAddresses = rawLastMsg?.payload?.headers
          ?.find((h: { name?: string | null }) => h.name?.toLowerCase() === 'bcc')?.value ?? '';
        sentAt = lastMsg.date;
      }
    }
  } catch (err) {
    console.error('Failed to fetch thread body for timeline:', err);
    // Non-fatal — store without body
  }

  const results: { clientId: string; timelineEntryId: string }[] = [];

  for (const clientId of clientIds) {
    // Dedupe scope: when a specific message_id is provided we only skip if
    // *that exact message* has already been allocated to this client. That
    // way a follow-up message on an already-allocated thread still creates
    // its own timeline entry. When the caller didn't supply a message_id
    // we keep the legacy thread-level behaviour to avoid creating an
    // unbounded number of duplicates on re-allocate clicks.
    let existingQuery = supabase
      .from('email_allocations')
      .select('id, timeline_entry_id')
      .eq('thread_id', threadId)
      .eq('client_id', clientId)
      .eq('firm_id', ctx.firmId);
    existingQuery = messageId
      ? existingQuery.eq('message_id', messageId)
      : existingQuery.is('message_id', null);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      results.push({ clientId, timelineEntryId: existing.timeline_entry_id });
      continue;
    }

    // Create timeline entry
    const noteDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    const contentObj = {
      __smith_email__: true,
      threadId,
      subject,
      snippet,
      fromName,
      fromEmail,
      date,
      to: toAddresses || undefined,
      cc: ccAddresses || undefined,
      bcc: bccAddresses || undefined,
      sentAt: sentAt || undefined,
      bodyText: bodyText || undefined,
      attachments: attachments.length ? attachments : undefined,
    };

    const { data: note, error: noteError } = await supabase
      .from('client_timeline_notes')
      .insert({
        firm_id: ctx.firmId,
        client_id: clientId,
        user_id: ctx.userId,
        title: subject || '(no subject)',
        content: JSON.stringify(contentObj),
        note_type: 'email',
        note_date: noteDate,
        is_pinned: false,
      })
      .select('id')
      .single();

    if (noteError || !note) {
      console.error('Failed to create timeline entry:', noteError);
      continue;
    }

    // Store allocation record (per-message when caller supplied a messageId,
    // otherwise a legacy thread-level row with message_id=NULL).
    await supabase.from('email_allocations').insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      thread_id: threadId,
      message_id: messageId ?? null,
      client_id: clientId,
      timeline_entry_id: note.id,
      subject,
    });

    results.push({ clientId, timelineEntryId: note.id });
  }

  return NextResponse.json({ success: true, results });
}

// DELETE — remove a single allocation
const DeleteSchema = z.object({
  threadId: z.string(),
  clientId: z.string().uuid(),
});

export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const supabase = createClient();

  // Unallocate the whole thread+client pair: per-message rows mean there
  // can be multiple timeline notes attached, so we have to clean up all of
  // them rather than the single row the legacy code assumed.
  const { data: allocs } = await supabase
    .from('email_allocations')
    .select('timeline_entry_id')
    .eq('thread_id', parsed.data.threadId)
    .eq('client_id', parsed.data.clientId)
    .eq('firm_id', ctx.firmId);

  const timelineIds = (allocs ?? [])
    .map(a => a.timeline_entry_id)
    .filter((id): id is string => !!id);
  if (timelineIds.length > 0) {
    await supabase
      .from('client_timeline_notes')
      .delete()
      .in('id', timelineIds);
  }

  await supabase
    .from('email_allocations')
    .delete()
    .eq('thread_id', parsed.data.threadId)
    .eq('client_id', parsed.data.clientId)
    .eq('firm_id', ctx.firmId);

  return NextResponse.json({ success: true });
}
