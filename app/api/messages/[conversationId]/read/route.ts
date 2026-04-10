import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';

// POST — mark a conversation as read (update last_read_at)
export async function POST(
  _request: Request,
  { params }: { params: { conversationId: string } }
) {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await service
    .from('conversation_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', params.conversationId)
    .eq('user_id', user.id);

  return NextResponse.json({ success: true });
}
