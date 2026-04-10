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

  return NextResponse.json({ conversations: results.filter(Boolean) });
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

  // Look for existing DM between these two users
  const { data: myMemberships } = await service
    .from('conversation_members')
    .select('conversation_id, conversations!inner(type)')
    .eq('user_id', user.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter('conversations.type', 'eq', 'direct') as any;

  if (myMemberships?.length) {
    const myIds: string[] = myMemberships.map((m: { conversation_id: string }) => m.conversation_id);
    const { data: existing } = await service
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', other_user_id)
      .in('conversation_id', myIds)
      .limit(1);

    if (existing?.length) {
      const cid = existing[0].conversation_id;
      const [convRes, otherRes] = await Promise.all([
        service.from('conversations').select('*').eq('id', cid).single(),
        service.from('users').select('id, full_name, email, role').eq('id', other_user_id).single(),
      ]);
      return NextResponse.json({ conversation: { ...convRes.data, otherMember: otherRes.data } });
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
