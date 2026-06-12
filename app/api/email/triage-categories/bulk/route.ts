import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

// Bulk triage-category operations (right-click a category card) — PER USER,
// PER EMAIL: only ever touches the caller's own triage rows.
//   { action: 'move', from }              → every email the caller has in
//     `from` becomes 'completed' (No Action Needed). For from='untriaged' the
//     caller's inbox is enumerated from Gmail (untriaged emails have no row).
//     Returns { messageIds, restoreTo } — the exact set changed, for undo.
//   { action: 'restore', messageIds, restoreTo } → undo. restoreTo='none'
//     deletes the rows (back to untriaged); otherwise sets category back.

const CATEGORIES = ['untriaged', 'needs_reply', 'to_do', 'waiting_client', 'documents', 'internal', 'fyi', 'completed'] as const;

const Schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move'),
    from: z.enum(CATEGORIES).refine(c => c !== 'completed', 'Cannot move from completed'),
  }),
  z.object({
    action: z.literal('restore'),
    messageIds: z.array(z.string().min(1)).min(1).max(20000),
    restoreTo: z.union([z.enum(CATEGORIES), z.literal('none')]),
  }),
]);

const MAX_PAGES = 20; // 20 × 500 = up to 10,000 inbox emails per sweep

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
  const svc = createServiceClient();
  const now = new Date().toISOString();

  try {
    if (body.action === 'move') {
      if (body.from === 'untriaged') {
        // Untriaged emails have no rows — enumerate the caller's inbox from
        // Gmail and insert 'completed' rows for everything not yet categorised.
        const supabase = createClient();
        const { data: connection } = await supabase
          .from('email_connections')
          .select('refresh_token')
          .eq('user_id', ctx.userId)
          .single();
        if (!connection?.refresh_token) return NextResponse.json({ error: 'Not connected' }, { status: 400 });
        const { gmail } = await getRefreshedGmailClient(connection.refresh_token);

        const inboxMsgs: { id: string; threadId: string | null }[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await gmail.users.messages.list({ userId: 'me', q: 'in:inbox', maxResults: 500, pageToken });
          for (const m of res.data.messages ?? []) if (m.id) inboxMsgs.push({ id: m.id, threadId: m.threadId ?? null });
          pageToken = res.data.nextPageToken ?? undefined;
          if (!pageToken) break;
        }

        // Skip anything this user already categorised.
        const existing = new Set<string>();
        for (let i = 0; i < inboxMsgs.length; i += 500) {
          const chunk = inboxMsgs.slice(i, i + 500).map(m => m.id);
          const { data } = await svc
            .from('email_message_triage')
            .select('message_id')
            .eq('user_id', ctx.userId)
            .in('message_id', chunk);
          for (const r of data ?? []) existing.add(r.message_id as string);
        }
        const toFile = inboxMsgs.filter(m => !existing.has(m.id));

        for (let i = 0; i < toFile.length; i += 500) {
          const chunk = toFile.slice(i, i + 500);
          const { error } = await svc
            .from('email_message_triage')
            .upsert(
              chunk.map(m => ({ firm_id: ctx.firmId, user_id: ctx.userId, message_id: m.id, thread_id: m.threadId, category: 'completed', set_by: 'user', updated_at: now })),
              { onConflict: 'user_id,message_id' },
            );
          if (error) throw error;
        }
        // Undo deletes these rows — they had no category before.
        return NextResponse.json({ messageIds: toFile.map(m => m.id), restoreTo: 'none' });
      }

      // Actioned category: collect the caller's message ids in it (paged past
      // the 1,000-row cap), then flip them to 'completed' in chunks.
      const messageIds: string[] = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data } = await svc
          .from('email_message_triage')
          .select('message_id')
          .eq('user_id', ctx.userId)
          .eq('category', body.from)
          .range(from, from + PAGE - 1);
        for (const r of data ?? []) messageIds.push(r.message_id as string);
        if (!data || data.length < PAGE) break;
      }
      for (let i = 0; i < messageIds.length; i += 500) {
        const chunk = messageIds.slice(i, i + 500);
        const { error } = await svc
          .from('email_message_triage')
          .update({ category: 'completed', set_by: 'user', updated_at: now })
          .eq('user_id', ctx.userId)
          .in('message_id', chunk);
        if (error) throw error;
      }
      return NextResponse.json({ messageIds, restoreTo: body.from });
    }

    // restore (undo)
    for (let i = 0; i < body.messageIds.length; i += 500) {
      const chunk = body.messageIds.slice(i, i + 500);
      if (body.restoreTo === 'none') {
        const { error } = await svc
          .from('email_message_triage')
          .delete()
          .eq('user_id', ctx.userId)
          .in('message_id', chunk);
        if (error) throw error;
      } else {
        const { error } = await svc
          .from('email_message_triage')
          .update({ category: body.restoreTo, set_by: 'user', updated_at: now })
          .eq('user_id', ctx.userId)
          .in('message_id', chunk);
        if (error) throw error;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('triage bulk error:', err);
    return NextResponse.json({ error: 'Bulk operation failed' }, { status: 500 });
  }
}
