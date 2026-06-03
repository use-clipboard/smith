import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { z } from 'zod';

// GET /api/messages — list all conversations for the current user
export async function GET() {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('firm_id').eq('id', user.id).single();
  if (!profile?.firm_id) return NextResponse.json({ conversations: [] });

  // All conversation memberships for this user
  const { data: memberships, error } = await service
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!memberships?.length) return NextResponse.json({ conversations: [] });

  const results = await Promise.all(
    memberships.map(async (membership) => {
      const cid = membership.conversation_id;

      const [convRes, membersRes, lastMsgRes, unreadRes] = await Promise.all([
        service.from('conversations').select('*').eq('id', cid).single(),
        service
          .from('conversation_members')
          .select('user_id, users!inner(id, full_name, email, role)')
          .eq('conversation_id', cid)
          .neq('user_id', user.id),
        service
          .from('instant_messages')
          .select('id, content, type, created_at, sender_id')
          .eq('conversation_id', cid)
          .order('created_at', { ascending: false })
          .limit(1),
        service
          .from('instant_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', cid)
          .neq('sender_id', user.id)
          .gt('created_at', membership.last_read_at ?? '1970-01-01'),
      ]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const otherMember = (membersRes.data?.[0] as any)?.users ?? null;

      return {
        ...convRes.data,
        otherMember,
        lastMessage: lastMsgRes.data?.[0] ?? null,
        unreadCount: unreadRes.count ?? 0,
      };
    })
  );

  // Collapse duplicate direct conversations with the same person into one entry
  // so the panel shows a single window per colleague. We keep the conversation
  // with the most recent message (the canonical one the POST handler also
  // resolves to) and sum the unread counts across the duplicates.
  type ConvResult = {
    id: string; type?: string;
    otherMember: { id: string } | null;
    lastMessage: { created_at: string } | null;
    unreadCount: number;
  };
  const filtered = results.filter(Boolean) as ConvResult[];
  const byOther = new Map<string, ConvResult>();
  const deduped: ConvResult[] = [];
  for (const c of filtered) {
    if (c.type === 'direct' && c.otherMember?.id) {
      const existing = byOther.get(c.otherMember.id);
      if (!existing) {
        byOther.set(c.otherMember.id, c);
        deduped.push(c);
        continue;
      }
      existing.unreadCount += c.unreadCount;
      // Adopt the more recent conversation's id + last message as canonical.
      if ((c.lastMessage?.created_at ?? '') > (existing.lastMessage?.created_at ?? '')) {
        existing.id = c.id;
        existing.lastMessage = c.lastMessage;
      }
    } else {
      deduped.push(c);
    }
  }

  return NextResponse.json({ conversations: deduped });
}

// POST /api/messages — find or create a direct conversation
const CreateSchema = z.object({ other_user_id: z.string().uuid() });

export async function POST(request: Request) {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const { other_user_id } = parsed.data;

  const { data: profile } = await supabase
    .from('users').select('firm_id').eq('id', user.id).single();
  if (!profile?.firm_id) return NextResponse.json({ error: 'No firm' }, { status: 400 });

  // Look for an existing DM between these two users. We fetch ALL shared direct
  // conversations (historically, races / a fragile lookup let duplicates get
  // created) and deterministically pick the canonical one: the conversation
  // that holds the most recent message, falling back to the oldest. This means
  // "open chat with X" always reuses the conversation that actually has the
  // history, instead of landing on an empty duplicate.
  const { data: myMems } = await service
    .from('conversation_members')
    .select('conversation_id')
    .eq('user_id', user.id);
  const myIds: string[] = (myMems ?? []).map((m: { conversation_id: string }) => m.conversation_id);

  if (myIds.length) {
    const { data: shared } = await service
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', other_user_id)
      .in('conversation_id', myIds);
    const sharedIds = [...new Set((shared ?? []).map((s: { conversation_id: string }) => s.conversation_id))];

    if (sharedIds.length) {
      const { data: convs } = await service
        .from('conversations')
        .select('id, created_at, type')
        .in('id', sharedIds);
      const directConvs = ((convs ?? []) as { id: string; created_at: string; type: string }[])
        .filter(c => c.type === 'direct')
        .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '')); // oldest first

      if (directConvs.length) {
        const directIds = directConvs.map(c => c.id);
        let cid = directConvs[0].id; // default: oldest
        // Prefer whichever conversation has the most recent message.
        const { data: lastMsg } = await service
          .from('instant_messages')
          .select('conversation_id, created_at')
          .in('conversation_id', directIds)
          .order('created_at', { ascending: false })
          .limit(1);
        if (lastMsg?.length) cid = lastMsg[0].conversation_id;

        const [convRes, otherRes] = await Promise.all([
          service.from('conversations').select('*').eq('id', cid).single(),
          service.from('users').select('id, full_name, email, role').eq('id', other_user_id).single(),
        ]);
        return NextResponse.json({ conversation: { ...convRes.data, otherMember: otherRes.data } });
      }
    }
  }

  // Create new conversation
  const { data: conv, error: convErr } = await service
    .from('conversations')
    .insert({ firm_id: profile.firm_id, type: 'direct' })
    .select().single();

  if (convErr || !conv) {
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }

  await service.from('conversation_members').insert([
    { conversation_id: conv.id, user_id: user.id, last_read_at: new Date().toISOString() },
    { conversation_id: conv.id, user_id: other_user_id, last_read_at: new Date(0).toISOString() },
  ]);

  const { data: otherUser } = await service
    .from('users').select('id, full_name, email, role').eq('id', other_user_id).single();

  return NextResponse.json({ conversation: { ...conv, otherMember: otherUser } });
}
