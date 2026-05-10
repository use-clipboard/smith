import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const ApplyBody = z.object({
  user_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const ItemBody = z.object({
  user_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  display_order: z.number().int().optional(),
});

// GET ?userId=… — items assigned to a user
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_onboarding_items')
    .select('*, completer:users!done_by ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId)
    .order('display_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

// POST — two modes:
//   { user_id, start_date }       — apply firm template to this new joiner
//   { user_id, title, ... }       — add a single ad-hoc item
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Apply-template mode
  const applyParse = ApplyBody.safeParse(raw);
  if (applyParse.success && !(raw as Record<string, unknown>).title) {
    const body = applyParse.data;
    const supabase = createClient();
    const { data: template } = await supabase
      .from('hr_onboarding_template')
      .select('*')
      .eq('firm_id', ctx.firmId)
      .order('display_order', { ascending: true });
    if (!template?.length) return NextResponse.json({ error: 'No onboarding template defined yet — set one up in Settings → HR.' }, { status: 400 });

    const startMs = body.start_date ? new Date(body.start_date + 'T12:00:00Z').getTime() : Date.now();
    const rows = template.map(t => ({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      title: t.title,
      description: t.description,
      display_order: t.display_order,
      due_date: t.due_days_after_start
        ? new Date(startMs + t.due_days_after_start * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null,
      status: 'pending',
    }));
    const { error } = await supabase.from('hr_onboarding_items').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, applied: rows.length });
  }

  // Single-item mode
  const itemParse = ItemBody.safeParse(raw);
  if (!itemParse.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const body = itemParse.data;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_onboarding_items')
    .insert({
      firm_id: ctx.firmId,
      user_id: body.user_id,
      title: body.title,
      description: body.description ?? null,
      due_date: body.due_date ?? null,
      display_order: body.display_order ?? 999,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
