import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

const ModifySchema = z.object({
  // Pass threadId to label the whole conversation, or messageId to label just
  // one message. messageId is required for stars in the flat (ungrouped) inbox:
  // Gmail merges same-subject senders (e.g. GoCardless) into one thread, so a
  // later message's id is NOT a valid thread id — threads.modify would 404 and
  // the star wouldn't stick. At least one of the two must be present.
  threadId: z.string().optional(),
  messageId: z.string().optional(),
  addLabelIds: z.array(z.string()).default([]),
  removeLabelIds: z.array(z.string()).default([]),
}).refine(d => !!d.threadId || !!d.messageId, {
  message: 'threadId or messageId is required',
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const parsed = ModifySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const requestBody = {
      addLabelIds: parsed.data.addLabelIds,
      removeLabelIds: parsed.data.removeLabelIds,
    };
    // messageId → label just that message; otherwise label the whole thread.
    if (parsed.data.messageId) {
      await gmail.users.messages.modify({ userId: 'me', id: parsed.data.messageId, requestBody });
    } else {
      await gmail.users.threads.modify({ userId: 'me', id: parsed.data.threadId!, requestBody });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Email modify error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
