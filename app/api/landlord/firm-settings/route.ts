import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { ensureLandlordFirmSettings } from '@/lib/landlord/firmSettings';

// GET /api/landlord/firm-settings — any firm member can read.
// PUT /api/landlord/firm-settings — admin only.

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const settings = await ensureLandlordFirmSettings(ctx.firmId);
    return NextResponse.json({ settings });
  } catch (e) {
    console.error('GET /api/landlord/firm-settings', e);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

// .strict() — brand_logo_path is deliberately absent: it's owned by the
// /logo endpoint, so a stray key from the client is a 400 rather than a
// silent overwrite of the uploaded logo.
const PatchSchema = z.object({
  approval_email_subject:    z.string().min(1).optional(),
  approval_email_body:       z.string().min(1).optional(),
  preparer_approved_subject: z.string().min(1).optional(),
  preparer_approved_body:    z.string().min(1).optional(),
  preparer_changes_subject:  z.string().min(1).optional(),
  preparer_changes_body:     z.string().min(1).optional(),
  reminder_enabled:          z.boolean().optional(),
  reminder_days:             z.number().int().min(1).max(60).optional(),
  reminder_max:              z.number().int().min(1).max(5).optional(),
  reminder_subject:          z.string().min(1).optional(),
  reminder_body:             z.string().min(1).optional(),
  brand_primary_color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).strict();

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can change Landlord settings' }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  await ensureLandlordFirmSettings(ctx.firmId);
  const supabase = createClient();
  const { error } = await supabase
    .from('landlord_firm_settings')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('firm_id', ctx.firmId);
  if (error) {
    console.error('PUT /api/landlord/firm-settings', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
