import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';

export interface EmailRule {
  id: string;
  name: string;
  is_active: boolean;
  condition_field: 'from' | 'to' | 'subject' | 'has_words';
  condition_operator: 'contains' | 'equals' | 'starts_with' | 'ends_with';
  condition_value: string;
  action_type: 'archive' | 'label' | 'mark_read' | 'star' | 'trash';
  action_label_id: string | null;
  action_label_name: string | null;
  created_at: string;
}

// GET /api/email/rules
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('email_rules')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('GET /api/email/rules', error);
    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 });
  }

  return NextResponse.json({ rules: (data ?? []) as EmailRule[] });
}

const CreateRuleSchema = z.object({
  name:               z.string().max(120).default(''),
  condition_field:    z.enum(['from', 'to', 'subject', 'has_words']),
  condition_operator: z.enum(['contains', 'equals', 'starts_with', 'ends_with']),
  condition_value:    z.string().min(1),
  action_type:        z.enum(['archive', 'label', 'mark_read', 'star', 'trash']),
  action_label_id:    z.string().nullable().optional(),
  action_label_name:  z.string().nullable().optional(),
});

// POST /api/email/rules
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreateRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const supabase = createClient();
  const { data: rule, error } = await supabase
    .from('email_rules')
    .insert({
      firm_id:            ctx.firmId,
      created_by:         ctx.userId,
      name:               parsed.data.name,
      condition_field:    parsed.data.condition_field,
      condition_operator: parsed.data.condition_operator,
      condition_value:    parsed.data.condition_value,
      action_type:        parsed.data.action_type,
      action_label_id:    parsed.data.action_label_id ?? null,
      action_label_name:  parsed.data.action_label_name ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/email/rules', error);
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }

  return NextResponse.json({ rule }, { status: 201 });
}
