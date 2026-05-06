/**
 * Supabase migration required:
 *
 * create table if not exists pinned_email_threads (
 *   id uuid default gen_random_uuid() primary key,
 *   user_id uuid references auth.users(id) on delete cascade not null,
 *   thread_id text not null,
 *   pinned_at timestamptz default now() not null,
 *   unique(user_id, thread_id)
 * );
 * alter table pinned_email_threads enable row level security;
 * create policy "Users manage own pins" on pinned_email_threads
 *   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data } = await supabase
    .from('pinned_email_threads')
    .select('thread_id')
    .eq('user_id', ctx.userId);

  return NextResponse.json({ pinnedIds: (data ?? []).map(r => r.thread_id) });
}

export async function POST(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { threadId } = await req.json() as { threadId: string };
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  const supabase = createClient();
  await supabase
    .from('pinned_email_threads')
    .upsert({ user_id: ctx.userId, thread_id: threadId }, { onConflict: 'user_id,thread_id' });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { threadId } = await req.json() as { threadId: string };
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

  const supabase = createClient();
  await supabase
    .from('pinned_email_threads')
    .delete()
    .eq('user_id', ctx.userId)
    .eq('thread_id', threadId);

  return NextResponse.json({ success: true });
}
