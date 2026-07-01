import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage } from '@/lib/gmail';

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

  // Capture the conversation's stable RFC Message-ID + reply chain so the task
  // marker shows for other users on the same chain (their mailbox's thread_id
  // differs). Use the last message — its References cover the whole chain.
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
        id: parsed.data.threadId,
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'References', 'In-Reply-To'],
      });
      const msgs = (threadRes.data.messages ?? []).map(m =>
        parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
      );
      const last = msgs[msgs.length - 1];
      if (last) {
        rfcMessageId = last.messageId;
        rfcReferences = last.references;
      }
    }
  } catch (err) {
    console.error('task-link: failed to fetch conversation RFC ids:', err);
    // Non-fatal — link still works, just stays mailbox-local.
  }

  const { error } = await supabase
    .from('email_task_links')
    .upsert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      thread_id: parsed.data.threadId,
      task_id: parsed.data.taskId,
      subject: parsed.data.subject,
      rfc_message_id: rfcMessageId || null,
      rfc_references: rfcReferences.length ? rfcReferences : null,
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
