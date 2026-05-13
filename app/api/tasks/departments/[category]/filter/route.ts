import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const VALID_CATEGORIES = new Set([
  'vat', 'year_end', 'self_assessment', 'payroll', 'companies_house',
  'bookkeeping', 'cis', 'internal', 'onboarding', 'performance',
  'management', 'audit', 'general', 'other',
]);

interface FilterRow {
  date_from: string | null;
  date_to:   string | null;
  locked:    boolean;
  locked_by: string | null;
  locked_at: string | null;
  locked_by_user?: { id: string; full_name: string | null; email: string } | null;
}

// GET /api/tasks/departments/[category]/filter
// Returns the firm-wide saved filter for this department, including lock state.
export async function GET(_req: NextRequest, { params }: { params: { category: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!VALID_CATEGORIES.has(params.category)) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('task_department_filters')
    .select('date_from, date_to, locked, locked_by, locked_at, locked_by_user:users(id, full_name, email)')
    .eq('firm_id', ctx.firmId)
    .eq('category', params.category)
    .maybeSingle();

  if (error) {
    console.error('GET department filter', error);
    return NextResponse.json({ error: 'Failed to load filter' }, { status: 500 });
  }

  const row = (data as FilterRow | null) ?? {
    date_from: null, date_to: null, locked: false, locked_by: null, locked_at: null,
  };
  return NextResponse.json({ filter: row });
}

const PatchSchema = z.object({
  date_from: z.string().nullable().optional(), // ISO date or null
  date_to:   z.string().nullable().optional(),
  locked:    z.boolean().optional(),
});

// PATCH /api/tasks/departments/[category]/filter
// Upserts the saved filter. When locked, only an admin may change date_from /
// date_to or unlock. Any user can read.
export async function PATCH(req: NextRequest, { params }: { params: { category: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!VALID_CATEGORIES.has(params.category)) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const supabase = createClient();

  // Read existing row to enforce the lock
  const { data: existing } = await supabase
    .from('task_department_filters')
    .select('locked, locked_by')
    .eq('firm_id', ctx.firmId)
    .eq('category', params.category)
    .maybeSingle();

  const isAdmin = ctx.userRole === 'admin';
  const wasLocked = !!existing?.locked;

  // If the filter is currently locked, only admins may change date range or unlock.
  // The only operation a non-admin may perform on a locked filter is… nothing.
  if (wasLocked && !isAdmin) {
    return NextResponse.json({ error: 'This department filter is locked. Ask an admin to unlock it.' }, { status: 403 });
  }
  // Only admins may flip the locked state in either direction.
  if (parsed.data.locked !== undefined && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can lock or unlock this filter.' }, { status: 403 });
  }

  const update: Record<string, unknown> = {
    firm_id: ctx.firmId,
    category: params.category,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.date_from !== undefined) update.date_from = parsed.data.date_from || null;
  if (parsed.data.date_to   !== undefined) update.date_to   = parsed.data.date_to   || null;
  if (parsed.data.locked    !== undefined) {
    update.locked = parsed.data.locked;
    update.locked_by = parsed.data.locked ? ctx.userId : null;
    update.locked_at = parsed.data.locked ? new Date().toISOString() : null;
  }

  const { error } = await supabase
    .from('task_department_filters')
    .upsert(update, { onConflict: 'firm_id,category' });

  if (error) {
    console.error('PATCH department filter', error);
    return NextResponse.json({ error: 'Failed to save filter' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
