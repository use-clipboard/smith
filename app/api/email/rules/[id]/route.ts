import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';

const UpdateRuleSchema = z.object({
  name:               z.string().max(120).optional(),
  is_active:          z.boolean().optional(),
  condition_field:    z.enum(['from', 'to', 'subject', 'has_words']).optional(),
  condition_operator: z.enum(['contains', 'equals', 'starts_with', 'ends_with']).optional(),
  condition_value:    z.string().min(1).optional(),
  action_type:        z.enum(['archive', 'label', 'mark_read', 'star', 'trash']).optional(),
  action_label_id:    z.string().nullable().optional(),
  action_label_name:  z.string().nullable().optional(),
});

// PUT /api/email/rules/[id]
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdateRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const { data: rule, error } = await supabase
    .from('email_rules')
    .update({ ...parsed.data })
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .select()
    .single();

  if (error) {
    console.error('PUT /api/email/rules/[id]', error);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }

  return NextResponse.json({ rule });
}

// DELETE /api/email/rules/[id]
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { error } = await supabase
    .from('email_rules')
    .delete()
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId);

  if (error) return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  return NextResponse.json({ success: true });
}
