import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { calcTotalDays } from '@/lib/hrHolidays';

const HalfMarker = z.enum(['full', 'morning', 'afternoon']);
const Category = z.enum([
  'sickness', 'unpaid_leave', 'compassionate', 'jury_duty', 'medical_appointment', 'other',
]);

const PatchSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_half: HalfMarker.optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_half: HalfMarker.optional(),
  category: Category.optional(),
  reason: z.string().nullable().optional(),
  evidence_url: z.string().url().nullable().optional(),
  return_to_work_done: z.boolean().optional(),
  return_to_work_notes: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let patch: z.infer<typeof PatchSchema>;
  try { patch = PatchSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: row } = await supabase
    .from('hr_absence_records')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!row || row.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const isManager = row.manager_id === ctx.userId;
  const isAdmin = ctx.userRole === 'admin';
  if (!isManager && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Recompute total_days if any date/half changed
  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  const next = {
    start_date: patch.start_date ?? row.start_date,
    start_half: patch.start_half ?? row.start_half,
    end_date: patch.end_date ?? row.end_date,
    end_half: patch.end_half ?? row.end_half,
  };
  if (next.end_date < next.start_date) {
    return NextResponse.json({ error: 'End date cannot be before start date.' }, { status: 400 });
  }
  if ('start_date' in patch || 'start_half' in patch || 'end_date' in patch || 'end_half' in patch) {
    update.total_days = calcTotalDays(next.start_date, next.start_half, next.end_date, next.end_half);
  }

  const { error } = await supabase.from('hr_absence_records').update(update).eq('id', row.id);
  if (error) {
    console.error('[PATCH /api/hr/absence/:id]', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const supabase = createClient();
  const { error } = await supabase.from('hr_absence_records').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) {
    console.error('[DELETE /api/hr/absence/:id]', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
