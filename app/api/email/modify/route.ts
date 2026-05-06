import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient } from '@/lib/gmail';

const ModifySchema = z.object({
  threadId: z.string().min(1),
  addLabelIds: z.array(z.string()).default([]),
  removeLabelIds: z.array(z.string()).default([]),
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
    await gmail.users.threads.modify({
      userId: 'me',
      id: parsed.data.threadId,
      requestBody: {
        addLabelIds: parsed.data.addLabelIds,
        removeLabelIds: parsed.data.removeLabelIds,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Email modify error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
