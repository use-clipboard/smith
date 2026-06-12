import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

// POST /api/email/mark-all-read
//   { action: 'mark' } (default) → removes UNREAD from every unread inbox
//     message. Returns { marked, ids } — the exact set changed, for undo.
//   { action: 'undo', ids }      → re-adds UNREAD to exactly those messages.
// Triggered by right-clicking the Inbox tab. Uses Gmail batchModify (up to
// 1,000 ids per call) so even a large backlog is a handful of API calls.

const Schema = z.object({
  action: z.enum(['mark', 'undo']).default('mark'),
  ids: z.array(z.string().min(1)).max(20000).optional(),
});

const MAX_PAGES = 20; // 20 × 500 = up to 10,000 unread messages per run

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, ids: undoIds } = parsed.data;

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) return NextResponse.json({ error: 'Not connected' }, { status: 400 });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);

    if (action === 'undo') {
      if (!undoIds || undoIds.length === 0) return NextResponse.json({ ok: true });
      for (let i = 0; i < undoIds.length; i += 1000) {
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: { ids: undoIds.slice(i, i + 1000), addLabelIds: ['UNREAD'] },
        });
      }
      return NextResponse.json({ ok: true });
    }

    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:inbox is:unread',
        maxResults: 500,
        pageToken,
      });
      for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    if (ids.length === 0) return NextResponse.json({ marked: 0, ids: [] });

    for (let i = 0; i < ids.length; i += 1000) {
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: { ids: ids.slice(i, i + 1000), removeLabelIds: ['UNREAD'] },
      });
    }
    return NextResponse.json({ marked: ids.length, ids });
  } catch (err) {
    console.error('mark-all-read error:', err);
    return NextResponse.json({ error: 'Failed to mark all as read' }, { status: 500 });
  }
}
