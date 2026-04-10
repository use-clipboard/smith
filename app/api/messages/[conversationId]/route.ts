import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { z } from 'zod';

// GET /api/messages/[conversationId] — fetch messages
export async function GET(
  _request: Request,
  { params }: { params: { conversationId: string } }
) {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify membership
  const { data: membership } = await service
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', params.conversationId)
    .eq('user_id', user.id)
    .single();
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { data: msgs, error } = await service
    .from('instant_messages')
    .select(`
      id, conversation_id, sender_id, content, type, edited_at, created_at,
      sender:users!sender_id(id, full_name, email, role),
      reactions:message_reactions(id, message_id, user_id, emoji, created_at)
    `)
    .eq('conversation_id', params.conversationId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ messages: msgs });
}

// POST /api/messages/[conversationId] — send a message
const SendSchema = z.object({
  content: z.string().min(1).max(2000),
  type: z.enum(['text', 'nudge']).default('text'),
});

export async function POST(
  request: Request,
  { params }: { params: { conversationId: string } }
) {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await service
    .from('conversation_members')
    .select('conversation_id')
    .eq('conversation_id', params.conversationId)
    .eq('user_id', user.id)
    .single();
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await request.json();
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const { data: message, error } = await service
    .from('instant_messages')
    .insert({
      conversation_id: params.conversationId,
      sender_id: user.id,
      content: parsed.data.content,
      type: parsed.data.type,
    })
    .select(`
      id, conversation_id, sender_id, content, type, edited_at, created_at,
      sender:users!sender_id(id, full_name, email, role)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ message });
}
