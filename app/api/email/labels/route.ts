import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, type GmailLabel } from '@/lib/gmail';

const SYSTEM_LABEL_ORDER: Record<string, number> = {
  INBOX: 1, SENT: 2, DRAFT: 3, IMPORTANT: 4, STARRED: 5,
  SPAM: 6, TRASH: 7, ALL_MAIL: 8,
};

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ labels: [] });
  }

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const res = await gmail.users.labels.list({ userId: 'me' });
    const raw = res.data.labels ?? [];

    // labels.list doesn't reliably return message counts — fetch them individually
    // for the labels we display counts on (INBOX unread, DRAFT total, STARRED total)
    const COUNT_LABELS = ['INBOX', 'DRAFT', 'STARRED', 'SENT', 'SPAM', 'TRASH'];
    const detailedCounts: Record<string, { messagesUnread: number; messagesTotal: number; threadsTotal: number }> = {};
    await Promise.allSettled(
      COUNT_LABELS.map(async id => {
        try {
          const detail = await gmail.users.labels.get({ userId: 'me', id });
          detailedCounts[id] = {
            messagesUnread: detail.data.messagesUnread ?? 0,
            messagesTotal:  detail.data.messagesTotal  ?? 0,
            threadsTotal:   detail.data.threadsTotal   ?? 0,
          };
        } catch { /* ignore missing labels */ }
      })
    );

    const labels: GmailLabel[] = raw
      .filter(l => l.id && l.name)
      .map(l => {
        const detailed = detailedCounts[l.id!];
        return {
          id: l.id!,
          name: l.name!,
          type: (l.type === 'user' ? 'user' : 'system') as 'system' | 'user',
          messagesUnread: detailed?.messagesUnread ?? l.messagesUnread ?? 0,
          messagesTotal:  detailed?.messagesTotal  ?? l.messagesTotal  ?? 0,
          threadsTotal:   detailed?.threadsTotal   ?? l.threadsTotal   ?? 0,
        };
      })
      .sort((a, b) => {
        const aOrder = SYSTEM_LABEL_ORDER[a.id] ?? 99;
        const bOrder = SYSTEM_LABEL_ORDER[b.id] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ labels });
  } catch (err) {
    console.error('Gmail labels fetch error:', err);
    return NextResponse.json({ labels: [] });
  }
}

// POST — create a new user label
export async function POST(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { name } = await req.json() as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) return NextResponse.json({ error: 'Not connected' }, { status: 400 });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: { name: name.trim(), labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    });
    return NextResponse.json({
      label: {
        id: res.data.id!,
        name: res.data.name!,
        type: 'user' as const,
        messagesUnread: 0,
        messagesTotal: 0,
      } satisfies GmailLabel,
    });
  } catch (err) {
    console.error('Create label error:', err);
    return NextResponse.json({ error: 'Failed to create label' }, { status: 500 });
  }
}

// PATCH — update user's preferred inbox label and thread display setting
import { z } from 'zod';
const PatchSchema = z.object({
  inboxLabel: z.string().optional(),
  showAsThreads: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  const supabase = createClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.inboxLabel !== undefined) update.inbox_label = parsed.data.inboxLabel;
  if (parsed.data.showAsThreads !== undefined) update.show_as_threads = parsed.data.showAsThreads;

  await supabase.from('email_connections').update(update).eq('user_id', ctx.userId);
  return NextResponse.json({ success: true });
}
