import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

// POST /api/email/triage-autofile
// Bulk-files the CALLER's old untriaged inbox emails as "No Action Needed"
// (category value 'completed'). Per user, per email: triage is personal, and
// every individual message older than the cutoff with no category row for
// this user gets one. No AI involved — used by the triage-settings age limit
// so a historic backlog clears instantly when someone starts using triage.

const Schema = z.object({
  olderThanDays: z.number().int().min(1).max(3650),
});

// Safety caps: at 500 message ids per Gmail page this allows up to 10,000
// emails per run. Re-runs (the sweep fires on every page load) pick up where
// a capped run left off, since already-filed messages are skipped.
const MAX_PAGES = 20;

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { olderThanDays } = parsed.data;

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) return NextResponse.json({ error: 'Not connected' }, { status: 400 });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);

    // Collect inbox message ids (with their thread ids) older than the cutoff.
    const msgs: { id: string; threadId: string | null }[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: `in:inbox older_than:${olderThanDays}d`,
        maxResults: 500,
        pageToken,
      });
      for (const m of res.data.messages ?? []) if (m.id) msgs.push({ id: m.id, threadId: m.threadId ?? null });
      pageToken = res.data.nextPageToken ?? undefined;
      if (!pageToken) break;
    }
    if (msgs.length === 0) return NextResponse.json({ filed: 0 });

    // Skip emails this user has already categorised (any category, any setter)
    // — auto-file must never clobber an existing triage decision.
    const svc = createServiceClient();
    const existing = new Set<string>();
    for (let i = 0; i < msgs.length; i += 500) {
      const chunk = msgs.slice(i, i + 500).map(m => m.id);
      const { data } = await svc
        .from('email_message_triage')
        .select('message_id')
        .eq('user_id', ctx.userId)
        .in('message_id', chunk);
      for (const r of data ?? []) existing.add(r.message_id as string);
    }
    const toFile = msgs.filter(m => !existing.has(m.id));
    if (toFile.length === 0) return NextResponse.json({ filed: 0 });

    const now = new Date().toISOString();
    for (let i = 0; i < toFile.length; i += 500) {
      const chunk = toFile.slice(i, i + 500);
      const { error } = await svc
        .from('email_message_triage')
        .upsert(
          chunk.map(m => ({
            firm_id: ctx.firmId,
            user_id: ctx.userId,
            message_id: m.id,
            thread_id: m.threadId,
            category: 'completed',
            set_by: 'ai',
            updated_at: now,
          })),
          { onConflict: 'user_id,message_id' },
        );
      if (error) {
        console.error('triage-autofile upsert', error);
        return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
      }
    }
    return NextResponse.json({ filed: toFile.length });
  } catch (err) {
    console.error('triage-autofile error:', err);
    return NextResponse.json({ error: 'Auto-file failed' }, { status: 500 });
  }
}
