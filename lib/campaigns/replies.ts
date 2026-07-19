// Campaign reply detection + Email Triage linking.
//
// When a recipient replies to a campaign, the reply lands in the sending
// mailbox's inbox in the SAME Gmail thread we sent on (we stored its thread_id
// per recipient). This scan finds those replies cheaply — one threads.list per
// sender, intersected with our known thread-ids, then a threads.get only on
// actual matches — and for each:
//   • records replied_at + a 'reply' event (→ Reports / Overview)
//   • allocates the thread to the client, exactly like a manual allocation
//     (a client_timeline_notes row + an email_allocations row with the stable
//     RFC Message-ID), so it shows on the client timeline and in Triage.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRefreshedGmailClient, parseGmailMessage, mapWithConcurrency } from '@/lib/gmail';

const WINDOW_DAYS = 14;
const MAX_THREAD_PAGES = 15;   // ~1500 recent inbox threads scanned per sender
const GET_CONCURRENCY = 4;

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

interface RecipientCtx {
  id: string; campaign_id: string; firm_id: string; client_id: string | null;
  email: string; name: string; thread_id: string;
}

export async function runCampaignReplyScan(service: SupabaseClient): Promise<{ authors: number; replies: number }> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: campaigns } = await service
    .from('campaigns')
    .select('id, firm_id, created_by, sent_at')
    .eq('status', 'sent')
    .gte('sent_at', since);
  if (!campaigns?.length) return { authors: 0, replies: 0 };

  // Group the campaigns by author — replies live in the author's mailbox.
  const byAuthor = new Map<string, { firmId: string; campaignIds: string[] }>();
  for (const c of campaigns) {
    if (!c.created_by) continue;
    const e = byAuthor.get(c.created_by as string) ?? { firmId: c.firm_id as string, campaignIds: [] };
    e.campaignIds.push(c.id as string);
    byAuthor.set(c.created_by as string, e);
  }

  let totalReplies = 0;
  for (const [authorId, info] of byAuthor) {
    try {
      totalReplies += await scanAuthor(service, authorId, info.firmId, info.campaignIds);
    } catch (err) {
      console.error('[campaigns-replies] author scan failed', authorId, err);
    }
  }
  return { authors: byAuthor.size, replies: totalReplies };
}

async function scanAuthor(service: SupabaseClient, authorId: string, firmId: string, campaignIds: string[]): Promise<number> {
  const { data: conn } = await service
    .from('email_connections').select('refresh_token, google_email').eq('user_id', authorId).maybeSingle();
  if (!conn?.refresh_token) return 0;

  // Unreplied recipients we still need to watch, keyed by their thread.
  const { data: recips } = await service
    .from('campaign_recipients')
    .select('id, campaign_id, firm_id, client_id, email, name, thread_id')
    .in('campaign_id', campaignIds)
    .is('replied_at', null)
    .not('thread_id', 'is', null);
  if (!recips?.length) return 0;

  const byThread = new Map<string, RecipientCtx>();
  for (const r of recips) if (r.thread_id) byThread.set(r.thread_id as string, r as RecipientCtx);

  const authorEmail = ((conn.google_email as string) ?? '').toLowerCase();
  const { gmail } = await getRefreshedGmailClient(conn.refresh_token as string);

  // Recent inbox threads (replies land in the inbox). One cheap list, paginated.
  const recent = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_THREAD_PAGES; page++) {
    const res = await gmail.users.threads.list({ userId: 'me', q: 'in:inbox newer_than:14d', maxResults: 100, pageToken });
    for (const t of res.data.threads ?? []) if (t.id) recent.add(t.id);
    pageToken = res.data.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  const candidates = Array.from(byThread.keys()).filter(id => recent.has(id));
  if (candidates.length === 0) return 0;

  let replies = 0;
  await mapWithConcurrency(candidates, GET_CONCURRENCY, async (threadId) => {
    const rcpt = byThread.get(threadId);
    if (!rcpt) return;
    try {
      const res = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      const messages = (res.data.messages ?? []).map(m => parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0]));
      // A reply is any message in our thread not sent by us.
      const inbound = messages.filter(m => (m.from?.email ?? '').toLowerCase() !== authorEmail);
      const reply = inbound[inbound.length - 1];
      if (!reply) return;
      await recordReply(service, rcpt, reply, authorId);
      replies++;
    } catch (err) {
      console.error('[campaigns-replies] thread get failed', threadId, err);
    }
  });

  return replies;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordReply(service: SupabaseClient, rcpt: RecipientCtx, reply: any, authorId: string) {
  // Mark the recipient (guarded so a double-run doesn't double-count).
  const { data: updated } = await service
    .from('campaign_recipients')
    .update({ replied_at: reply.date ? new Date(reply.date).toISOString() : new Date().toISOString() })
    .eq('id', rcpt.id).is('replied_at', null).select('id');
  if (!updated?.length) return; // already recorded by a concurrent run

  await service.from('campaign_events').insert({
    firm_id: rcpt.firm_id, campaign_id: rcpt.campaign_id, recipient_id: rcpt.id, type: 'reply',
  });

  if (!rcpt.client_id) return; // nothing to allocate to
  await allocateToClient(service, rcpt, reply, authorId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function allocateToClient(service: SupabaseClient, rcpt: RecipientCtx, reply: any, authorId: string) {
  try {
    // Don't duplicate an allocation someone already made for this thread+client.
    const { data: existing } = await service
      .from('email_allocations')
      .select('id')
      .eq('firm_id', rcpt.firm_id).eq('thread_id', rcpt.thread_id).eq('client_id', rcpt.client_id)
      .limit(1).maybeSingle();
    if (existing) return;

    const subject = reply.subject || '(no subject)';
    const noteDate = (reply.date ? new Date(reply.date) : new Date()).toISOString().split('T')[0];
    const content = {
      __smith_email__: true,
      threadId: rcpt.thread_id,
      subject,
      snippet: reply.snippet ?? '',
      fromName: reply.from?.name ?? '',
      fromEmail: reply.from?.email ?? '',
      date: reply.date ?? '',
      to: (reply.to ?? []).map((a: { name?: string; email: string }) => a.name ? `${a.name} <${a.email}>` : a.email).join(', ') || undefined,
      sentAt: reply.date || undefined,
      bodyText: reply.body ? stripHtml(reply.body).slice(0, 3000) : undefined,
      // Flag so the timeline / campaign report can tell these apart.
      __campaign_reply__: true,
    };

    const { data: note } = await service
      .from('client_timeline_notes')
      .insert({
        firm_id: rcpt.firm_id, client_id: rcpt.client_id, user_id: authorId,
        title: subject, content: JSON.stringify(content), note_type: 'email', note_date: noteDate, is_pinned: false,
      })
      .select('id').single();
    if (!note) return;

    await service.from('email_allocations').insert({
      firm_id: rcpt.firm_id, user_id: authorId, thread_id: rcpt.thread_id, message_id: reply.id ?? null,
      client_id: rcpt.client_id, timeline_entry_id: note.id, subject,
      rfc_message_id: reply.messageId || null,
      rfc_references: (reply.references && reply.references.length) ? reply.references : null,
    });
  } catch (err) {
    console.error('[campaigns-replies] allocate failed', rcpt.id, err);
  }
}
