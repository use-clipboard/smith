import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * Personal calendar reminders — private to the creating user.
 *
 * GET    /api/calendar/personal-reminders?start=ISO&end=ISO  → list in range
 * GET    /api/calendar/personal-reminders?upcomingHours=24    → list upcoming
 * POST   /api/calendar/personal-reminders                     → create
 * PATCH  /api/calendar/personal-reminders                     → update
 * DELETE /api/calendar/personal-reminders?id=…                → delete
 */

const CreateSchema = z.object({
  title:        z.string().min(1).max(200),
  remindAt:     z.string().min(1),                         // ISO string
  leadMinutes:  z.number().int().min(0).max(10_080).nullable().optional(),
  notes:        z.string().max(2000).nullable().optional(),
  isAllDay:     z.boolean().optional(),
});

const UpdateSchema = CreateSchema.partial().extend({
  id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ reminders: [] }, { status: 401 });

  const url = req.nextUrl;
  const start = url.searchParams.get('start');
  const end   = url.searchParams.get('end');
  const upcomingHours = url.searchParams.get('upcomingHours');

  const supabase = createClient();
  let query = supabase
    .from('calendar_personal_reminders')
    .select('id, title, notes, remind_at, lead_minutes, is_all_day, dismissed_at, created_at')
    .eq('user_id', ctx.userId)
    .order('remind_at', { ascending: true });

  if (upcomingHours) {
    const hrs = Math.min(168, Math.max(1, parseInt(upcomingHours, 10) || 24));
    const now = new Date();
    const horizon = new Date(now.getTime() + hrs * 60 * 60 * 1000);
    query = query.gte('remind_at', now.toISOString()).lte('remind_at', horizon.toISOString());
  } else if (start && end) {
    query = query.gte('remind_at', start).lte('remind_at', end);
  }

  const { data, error } = await query;
  if (error) {
    console.error('personal-reminders GET error', error);
    return NextResponse.json({ reminders: [], error: 'fetch_failed' }, { status: 500 });
  }

  const reminders = (data ?? []).map(r => ({
    id:           r.id,
    title:        r.title,
    notes:        r.notes,
    remindAt:     r.remind_at,
    leadMinutes:  r.lead_minutes,
    isAllDay:     r.is_all_day ?? false,
    dismissedAt:  r.dismissed_at,
    createdAt:    r.created_at,
  }));

  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('calendar_personal_reminders')
    .insert({
      user_id:      ctx.userId,
      firm_id:      ctx.firmId,
      title:        parsed.data.title,
      notes:        parsed.data.notes ?? null,
      remind_at:    parsed.data.remindAt,
      lead_minutes: parsed.data.leadMinutes ?? null,
      is_all_day:   parsed.data.isAllDay ?? false,
    })
    .select('id, title, notes, remind_at, lead_minutes, is_all_day, dismissed_at, created_at')
    .single();

  if (error || !data) {
    console.error('personal-reminders POST error', error);
    return NextResponse.json({ error: 'Could not create reminder' }, { status: 500 });
  }

  return NextResponse.json({
    reminder: {
      id:          data.id,
      title:       data.title,
      notes:       data.notes,
      remindAt:    data.remind_at,
      leadMinutes: data.lead_minutes,
      isAllDay:    data.is_all_day ?? false,
      dismissedAt: data.dismissed_at,
      createdAt:   data.created_at,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', issues: parsed.error.flatten() }, { status: 400 });
  }

  const { id, ...rest } = parsed.data;
  const update: Record<string, unknown> = {};
  if (rest.title       !== undefined) update.title        = rest.title;
  if (rest.notes       !== undefined) update.notes        = rest.notes;
  if (rest.remindAt    !== undefined) update.remind_at    = rest.remindAt;
  if (rest.leadMinutes !== undefined) update.lead_minutes = rest.leadMinutes;
  if (rest.isAllDay    !== undefined) update.is_all_day   = rest.isAllDay;

  const supabase = createClient();
  const { error } = await supabase
    .from('calendar_personal_reminders')
    .update(update)
    .eq('id', id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('personal-reminders PATCH error', error);
    return NextResponse.json({ error: 'Could not update reminder' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase
    .from('calendar_personal_reminders')
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.userId);

  if (error) {
    console.error('personal-reminders DELETE error', error);
    return NextResponse.json({ error: 'Could not delete reminder' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
