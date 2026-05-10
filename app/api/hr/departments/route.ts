import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  parent_department_id: z.string().uuid().optional().nullable(),
  color: z.string().optional().nullable(),
  display_order: z.number().int().optional(),
});

// GET /api/hr/departments — list (visible to anyone in the firm).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_departments')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('[GET /api/hr/departments]', error);
    return NextResponse.json({ error: 'Failed to load departments' }, { status: 500 });
  }
  return NextResponse.json({ departments: data ?? [] });
}

// POST /api/hr/departments — admin-only.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_departments')
    .insert({
      firm_id: ctx.firmId,
      name: body.name,
      description: body.description ?? null,
      parent_department_id: body.parent_department_id ?? null,
      color: body.color ?? null,
      display_order: body.display_order ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[POST /api/hr/departments]', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A department with that name already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create department' }, { status: 500 });
  }
  return NextResponse.json({ department: data });
}
