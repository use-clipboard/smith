import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Per-user notification preferences. Currently just the task-change setting
// (users.notify_task_changes: 'all' | 'oneoff' | 'none'). Each user sets their
// own — never firm-wide.

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data } = await supabase.from('users').select('notify_task_changes').eq('id', ctx.userId).single();
  return NextResponse.json({ notify_task_changes: (data?.notify_task_changes as string) ?? 'all' });
}

const Patch = z.object({ notify_task_changes: z.enum(['all', 'oneoff', 'none']) });

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Patch>;
  try { body = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { error } = await supabase
    .from('users')
    .update({ notify_task_changes: body.notify_task_changes })
    .eq('id', ctx.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, notify_task_changes: body.notify_task_changes });
}
