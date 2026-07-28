import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { ensureMtdItFirmSettings } from '@/lib/mtdIt/firmSettings';

// GET  /api/mtd-it/firm-settings — any firm member can read.
// PUT  /api/mtd-it/firm-settings — admin only.

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  try {
    const settings = await ensureMtdItFirmSettings(ctx.firmId);
    return NextResponse.json({ settings });
  } catch (e) {
    console.error('GET /api/mtd-it/firm-settings', e);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

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
  // Branding
  brand_primary_color:       z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  // PDF content toggles
  pdf_include_kpi_cards:            z.boolean().optional(),
  pdf_include_chart:                z.boolean().optional(),
  pdf_include_category_tables:      z.boolean().optional(),
  pdf_include_breakdown:            z.boolean().optional(),
  pdf_include_transaction_detail:   z.boolean().optional(),
  pdf_include_quarterly_comparison: z.boolean().optional(),
  // Source-document lifecycle
  auto_delete_source_on_complete: z.boolean().optional(),
  // Additional team members to notify on a client response
  notify_user_ids: z.array(z.string().uuid()).max(50).optional(),
}).strict();

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can change MTD IT settings' }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  // Ensure the row exists, then PATCH
  await ensureMtdItFirmSettings(ctx.firmId);
  const supabase = createClient();
  const payload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  let { error } = await supabase
    .from('mtd_it_firm_settings')
    .update(payload)
    .eq('firm_id', ctx.firmId);
  // Retry without the later-migration column if it isn't applied yet.
  if (error?.code === '42703') {
    delete payload.notify_user_ids;
    ({ error } = await supabase.from('mtd_it_firm_settings').update(payload).eq('firm_id', ctx.firmId));
  }
  if (error) {
    console.error('PUT /api/mtd-it/firm-settings', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
