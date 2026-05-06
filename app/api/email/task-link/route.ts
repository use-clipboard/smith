import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const LinkSchema = z.object({
  threadId: z.string().min(1),
  taskId: z.string().uuid(),
  subject: z.string().optional().default(''),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createClient();

  const { error } = await supabase
    .from('email_task_links')
    .upsert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      thread_id: parsed.data.threadId,
      task_id: parsed.data.taskId,
      subject: parsed.data.subject,
    }, { onConflict: 'thread_id,task_id' });

  if (error) {
    console.error('Task link error:', error);
    return NextResponse.json({ error: 'Failed to link task' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

const UnlinkSchema = z.object({
  threadId: z.string(),
  taskId: z.string().uuid(),
});

export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const parsed = UnlinkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const supabase = createClient();
  await supabase
    .from('email_task_links')
    .delete()
    .eq('thread_id', parsed.data.threadId)
    .eq('task_id', parsed.data.taskId)
    .eq('firm_id', ctx.firmId);

  return NextResponse.json({ success: true });
}
