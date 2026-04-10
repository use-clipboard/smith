import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const UpdatePolicySchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: z.string().optional(),
  category: z.string().min(1).max(100).optional(),
  is_published: z.boolean().optional(),
});

// GET /api/policies/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: policy, error } = await supabase
    .from('policies')
    .select('*, users!policies_updated_by_fkey(full_name)')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();

  if (error || !policy) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });

  return NextResponse.json({ policy });
}

// PATCH /api/policies/[id] — admin only
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: profile } = await supabase.from('users').select('role').eq('id', ctx.userId).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { data: existing } = await supabase.from('policies').select('id, version').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!existing) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdatePolicySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const d = parsed.data;
  const updates: Record<string, unknown> = {
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
    version: (existing.version ?? 1) + 1,
  };
  if (d.title !== undefined) updates.title = d.title;
  if (d.content !== undefined) updates.content = d.content;
  if (d.category !== undefined) updates.category = d.category;
  if (d.is_published !== undefined) updates.is_published = d.is_published;

  const { data: policy, error } = await supabase
    .from('policies')
    .update(updates)
    .eq('id', params.id)
    .select('*, users!policies_updated_by_fkey(full_name)')
    .single();

  if (error) {
    console.error('PATCH /api/policies/[id]', error);
    return NextResponse.json({ error: 'Failed to update policy' }, { status: 500 });
  }

  return NextResponse.json({ policy });
}

// DELETE /api/policies/[id] — admin only
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: profile } = await supabase.from('users').select('role').eq('id', ctx.userId).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const { data: existing } = await supabase.from('policies').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!existing) return NextResponse.json({ error: 'Policy not found' }, { status: 404 });

  const { error } = await supabase.from('policies').delete().eq('id', params.id);
  if (error) {
    console.error('DELETE /api/policies/[id]', error);
    return NextResponse.json({ error: 'Failed to delete policy' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
