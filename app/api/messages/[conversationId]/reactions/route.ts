import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { z } from 'zod';

// POST — add a reaction (upsert)
const AddSchema = z.object({
  message_id: z.string().uuid(),
  emoji: z.string().min(1).max(10),
});

export async function POST(request: Request) {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const { data: reaction, error } = await service
    .from('message_reactions')
    .upsert(
      { message_id: parsed.data.message_id, user_id: user.id, emoji: parsed.data.emoji },
      { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reaction });
}

// DELETE — remove a reaction
const DeleteSchema = z.object({ reaction_id: z.string().uuid() });

export async function DELETE(request: Request) {
  const supabase = createClient();
  const service = createServiceClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  await service
    .from('message_reactions')
    .delete()
    .eq('id', parsed.data.reaction_id)
    .eq('user_id', user.id);

  return NextResponse.json({ success: true });
}
