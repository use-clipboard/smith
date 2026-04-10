import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CreatePolicySchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().optional().default(''),
  category: z.string().min(1).max(100).optional().default('General'),
  is_published: z.boolean().optional().default(true),
});

// GET /api/policies — list all for the firm
export async function GET(_req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const { data: userProfile } = await supabase
    .from('users').select('role').eq('id', ctx.userId).single();

  const isAdmin = userProfile?.role === 'admin';

  let query = supabase
    .from('policies')
    .select('id, title, category, is_published, version, created_at, updated_at, created_by, updated_by, users!policies_updated_by_fkey(full_name)')
    .eq('firm_id', ctx.firmId)
    .order('category', { ascending: true })
    .order('title', { ascending: true });

  if (!isAdmin) query = query.eq('is_published', true);

  const { data: policies, error } = await query;

  if (error) {
    console.error('GET /api/policies', error);
    return NextResponse.json({ error: 'Failed to load policies' }, { status: 500 });
  }

  return NextResponse.json({ policies: policies ?? [], isAdmin });
}

// POST /api/policies — create (admin only)
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: profile } = await supabase.from('users').select('role').eq('id', ctx.userId).single();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreatePolicySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const { data: policy, error } = await supabase
    .from('policies')
    .insert({
      firm_id: ctx.firmId,
      title: parsed.data.title,
      content: parsed.data.content,
      category: parsed.data.category,
      is_published: parsed.data.is_published,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .select()
    .single();

  if (error) {
    console.error('POST /api/policies', error);
    return NextResponse.json({ error: 'Failed to create policy' }, { status: 500 });
  }

  return NextResponse.json({ policy }, { status: 201 });
}
