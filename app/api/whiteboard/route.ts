import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PostSchema = z.object({
  content: z.string().min(1).max(200),
  color: z.enum(['yellow', 'pink', 'blue']),
  author_name: z.string().min(1).max(80),
});

// GET /api/whiteboard — list all messages for the current firm
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('whiteboard_messages')
    .select('id, content, color, author_name, created_at, user_id')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error) {
    console.error('GET /api/whiteboard', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }

  return NextResponse.json({ messages: data });
}

// POST /api/whiteboard — create a new sticky note
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('whiteboard_messages')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      content: parsed.data.content,
      color: parsed.data.color,
      author_name: parsed.data.author_name,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/whiteboard', error);
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }

  return NextResponse.json({ message: data }, { status: 201 });
}
