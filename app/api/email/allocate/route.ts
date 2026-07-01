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
  // Stable, cross-mailbox identifiers for the allocated message. Gmail's
  // thread_id/message_id are per-mailbox, so we also record the RFC 2822
  // Message-ID + reply chain — these are identical in every recipient's
  // mailbox, letting the allocation show for other users on the same chain.
  let rfcMessageId = '';
  let rfcReferences: string[] = [];
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
      // The RFC ids describe the specific message being allocated. When the
      // caller named a Gmail message id, use that message's headers; otherwise
      // fall back to the last message in the thread (matches the body we store).
      const targetMsg = messageId ? (messages.find(m => m.id === messageId) ?? lastMsg) : lastMsg;
      if (targetMsg) {
        rfcMessageId = targetMsg.messageId;
        rfcReferences = targetMsg.references;
      }
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

    const noteDate = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // Failsafe: never duplicate the same email on the same timeline. The
    // allocation-row dedupe above can miss when two users allocate via
    // different scopes (thread-level vs per-message) or race each other — so
    // also check the timeline itself for an email note with the same thread,
    // subject and timestamp before inserting.
    const { data: dupCandidates } = await supabase
      .from('client_timeline_notes')
      .select('id, content')
      .eq('firm_id', ctx.firmId)
      .eq('client_id', clientId)
      .eq('note_type', 'email')
      .eq('note_date', noteDate)
      .eq('title', subject || '(no subject)');
    const duplicate = (dupCandidates ?? []).find(c => {
      try {
        const j = JSON.parse(c.content as string) as { __smith_email__?: boolean; threadId?: string; date?: string };
        return j.__smith_email__ === true && j.threadId === threadId && (j.date ?? '') === (date ?? '');
      } catch { return false; }
    });
    if (duplicate) {
      // Record the allocation against the EXISTING note so unallocate still
      // cleans it up; ignore a unique-violation if a rival request won.
      await supabase.from('email_allocations').insert({
        firm_id: ctx.firmId,
        user_id: ctx.userId,
        thread_id: threadId,
        message_id: messageId ?? null,
        client_id: clientId,
        timeline_entry_id: duplicate.id,
        subject,
        rfc_message_id: rfcMessageId || null,
        rfc_references: rfcReferences.length ? rfcReferences : null,
      });
      results.push({ clientId, timelineEntryId: duplicate.id as string });
      continue;
    }

    // Create timeline entry
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
      rfc_message_id: rfcMessageId || null,
      rfc_references: rfcReferences.length ? rfcReferences : null,
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

  const { threadId, clientId } = parsed.data;
  const supabase = createClient();

  // Gmail thread ids are per-mailbox, so an allocation made by another user on
  // this conversation is stored under *their* thread_id. Collect the stable RFC
  // Message-IDs of this conversation from the caller's own mailbox so we can
  // also find (and, for admins, remove) those cross-mailbox allocations.
  const convRfcIds = new Set<string>();
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
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'References', 'In-Reply-To'],
      });
      for (const m of threadRes.data.messages ?? []) {
        const pm = parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0]);
        if (pm.messageId) convRfcIds.add(pm.messageId);
        for (const r of pm.references) convRfcIds.add(r);
      }
    }
  } catch (err) {
    console.error('unallocate: failed to fetch conversation RFC ids:', err);
    // Non-fatal — fall back to thread_id-only matching (own allocations still work).
  }

  // Candidate allocation rows for this client in this conversation: this
  // mailbox's thread_id, plus any row keyed to one of the conversation's RFC
  // ids (allocations another user made). Two queries + merge avoids fragile
  // .or() string quoting of Message-IDs (which contain <, >, @, dots).
  const ALLOC_SELECT = 'id, user_id, timeline_entry_id';
  const [byThread, byRfc] = await Promise.all([
    supabase
      .from('email_allocations')
      .select(ALLOC_SELECT)
      .eq('firm_id', ctx.firmId)
      .eq('client_id', clientId)
      .eq('thread_id', threadId),
    convRfcIds.size > 0
      ? supabase
          .from('email_allocations')
          .select(ALLOC_SELECT)
          .eq('firm_id', ctx.firmId)
          .eq('client_id', clientId)
          .in('rfc_message_id', Array.from(convRfcIds))
      : Promise.resolve({ data: null }),
  ]);

  const byId = new Map<string, { id: string; user_id: string; timeline_entry_id: string | null }>();
  for (const r of [...(byThread.data ?? []), ...(byRfc.data ?? [])]) {
    byId.set(r.id as string, r as { id: string; user_id: string; timeline_entry_id: string | null });
  }
  const rows = Array.from(byId.values());

  const ownRows = rows.filter(r => r.user_id === ctx.userId);
  const otherRows = rows.filter(r => r.user_id !== ctx.userId);
  const isAdmin = ctx.userRole === 'admin';

  // Non-admins may only remove their OWN allocations. If the allocation is
  // entirely someone else's, block with a clear, user-facing reason.
  if (!isAdmin && ownRows.length === 0 && otherRows.length > 0) {
    return NextResponse.json(
      {
        error: 'admin_required',
        message: 'This email was allocated by a colleague. Only an admin can change another user’s client assignment.',
      },
      { status: 403 },
    );
  }

  // Admins remove everything for the conversation; non-admins remove only their
  // own rows (leaving colleagues' allocations intact).
  const toDelete = isAdmin ? rows : ownRows;
  const timelineIds = toDelete
    .map(r => r.timeline_entry_id)
    .filter((id): id is string => !!id);
  if (timelineIds.length > 0) {
    await supabase.from('client_timeline_notes').delete().in('id', timelineIds);
  }
  const deleteIds = toDelete.map(r => r.id);
  if (deleteIds.length > 0) {
    await supabase.from('email_allocations').delete().in('id', deleteIds);
  }

  // Non-admin left a colleague's allocation in place — tell them so the badge
  // staying put doesn't look like a bug.
  if (!isAdmin && otherRows.length > 0) {
    return NextResponse.json({
      success: true,
      partial: true,
      message: 'Removed your allocation. This email is still allocated by a colleague — only an admin can remove that.',
    });
  }

  return NextResponse.json({ success: true });
}
