import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getUserCategoryKeys } from '@/lib/emailTriageCategories';

// Triage category persistence — PER USER, PER EMAIL (gmail message).
// Each user triages every individual email independently: no row = untriaged
// for that user. Categories are personal, never shared across the firm, and
// emails in the same conversation can sit in different categories.
//   GET  → { categories: { [messageId]: { category, setBy, updatedAt } } } for the caller
//   POST → upsert one email's category for the caller. `setBy: 'user'` always
//          wins; `'ai'` will NOT overwrite an existing manual ('user') choice.

// Categories are now per-user customisable, so the value is validated at
// runtime against the caller's own category keys (below) rather than a fixed enum.
const UpsertSchema = z.object({
  messageId: z.string().min(1),
  threadId: z.string().optional(),
  category: z.string().min(1),
  setBy: z.enum(['ai', 'user']).default('user'),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) return NextResponse.json({ categories: {} });

  const supabase = createServiceClient();
  const PAGE = 1000;

  // Inbox-scope the categories: a triage row whose email has LEFT the inbox
  // (trashed / archived / spam) must stop counting toward the cards — mirrors
  // how the untriaged count is inbox-scoped. We read the user's live inbox set
  // from email_inbox_cache. Fallback: if the cache is empty (pre-migration or
  // not yet synced) we don't scope, so the cards never wrongly drop to zero.
  const inboxIds = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('email_inbox_cache')
      .select('message_id')
      .eq('user_id', ctx.userId)
      .range(from, from + PAGE - 1);
    for (const r of data ?? []) inboxIds.add(r.message_id as string);
    if (!data || data.length < PAGE) break;
  }
  const scopeToInbox = inboxIds.size > 0;

  // Supabase caps each query at 1,000 rows — page through the full set or the
  // card counts silently undercount after a big auto-file run.
  const categories: Record<string, { category: string; setBy: string; updatedAt: string }> = {};
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from('email_message_triage')
      .select('message_id, category, set_by, updated_at')
      .eq('user_id', ctx.userId)
      .range(from, from + PAGE - 1);
    for (const r of data ?? []) {
      const messageId = r.message_id as string;
      if (scopeToInbox && !inboxIds.has(messageId)) continue; // email no longer in the inbox
      categories[messageId] = { category: r.category as string, setBy: r.set_by as string, updatedAt: r.updated_at as string };
    }
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) return NextResponse.json({ error: 'Module not active' }, { status: 403 });

  const parsed = UpsertSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { messageId, threadId, category, setBy } = parsed.data;

  const supabase = createServiceClient();

  // Validate the category against the caller's own (customisable) set.
  const validKeys = await getUserCategoryKeys(supabase, ctx.userId);
  if (!validKeys.includes(category)) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }

  // AI must not clobber a manual choice — skip if a 'user' row already exists.
  if (setBy === 'ai') {
    const { data: existing } = await supabase
      .from('email_message_triage')
      .select('set_by')
      .eq('user_id', ctx.userId).eq('message_id', messageId)
      .maybeSingle();
    if (existing?.set_by === 'user') return NextResponse.json({ ok: true, skipped: true });
  }

  const { error } = await supabase
    .from('email_message_triage')
    .upsert(
      { firm_id: ctx.firmId, user_id: ctx.userId, message_id: messageId, thread_id: threadId ?? null, category, set_by: setBy, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,message_id' },
    );
  if (error) {
    console.error('email_message_triage upsert', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
