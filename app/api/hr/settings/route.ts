import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PatchSchema = z.object({
  holiday_reset_month: z.number().int().min(1).max(12).optional(),
  holiday_reset_day: z.number().int().min(1).max(31).optional(),
  default_annual_holiday_days: z.number().min(0).max(366).optional(),
  morning_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  morning_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  afternoon_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  afternoon_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  push_to_calendar_default: z.boolean().optional(),
});

const DEFAULTS = {
  holiday_reset_month: 1,
  holiday_reset_day: 1,
  default_annual_holiday_days: 28,
  morning_start: '09:00',
  morning_end: '13:00',
  afternoon_start: '13:00',
  afternoon_end: '17:30',
  push_to_calendar_default: true,
};

// GET /api/hr/settings — returns the firm's HR settings row, creating defaults if absent.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('firm_hr_settings')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/hr/settings]', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }

  if (!data) {
    // Lazy-create the defaults row so admins always have something to update.
    const { data: created, error: insertErr } = await supabase
      .from('firm_hr_settings')
      .insert({ firm_id: ctx.firmId, ...DEFAULTS })
      .select('*')
      .single();
    if (insertErr) {
      console.error('[GET /api/hr/settings] insert defaults', insertErr);
      return NextResponse.json({ settings: { firm_id: ctx.firmId, ...DEFAULTS } });
    }
    return NextResponse.json({ settings: created });
  }

  return NextResponse.json({ settings: data });
}

// PATCH /api/hr/settings — admin-only.
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let patch: z.infer<typeof PatchSchema>;
  try {
    patch = PatchSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 });
  }

  const supabase = createClient();

  // Ensure a row exists (may be the very first time settings are saved)
  await supabase
    .from('firm_hr_settings')
    .upsert({ firm_id: ctx.firmId, ...DEFAULTS, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'firm_id' });

  const { data, error } = await supabase
    .from('firm_hr_settings')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .single();

  if (error) {
    console.error('[PATCH /api/hr/settings]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ settings: data });
}
