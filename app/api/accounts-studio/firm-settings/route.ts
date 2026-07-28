import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { getAccountsStudioFirmSettings } from '@/lib/accounts-studio/firmSettings';

export const dynamic = 'force-dynamic';

const Body = z.object({
  accountantsReport: z.string().max(20000).default(''),
  accountantDetails: z.string().max(20000).default(''),
  accountantName: z.string().max(500).default(''),
  accountantAddress: z.string().max(2000).default(''),
  governingBody: z.string().max(20000).default(''),
  approvalEmailSubject: z.string().max(500).default(''),
  approvalEmailBody: z.string().max(20000).default(''),
  brandPrimaryColor: z.string().max(9).default('#4F46E5'),
  notifyUserIds: z.array(z.string().uuid()).max(50).default([]),
}).strict();

// ── GET /api/accounts-studio/firm-settings ───────────────────────────────────
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

  const supabase = createClient();
  const settings = await getAccountsStudioFirmSettings(supabase, ctx.firmId);
  return NextResponse.json({ settings });
}

// ── PUT /api/accounts-studio/firm-settings ───────────────────────────────────
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can change Accounts Studio defaults.' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const row: Record<string, unknown> = {
    firm_id: ctx.firmId,
    accountants_report: body.accountantsReport,
    accountant_details: body.accountantDetails,
    accountant_name: body.accountantName,
    accountant_address: body.accountantAddress,
    governing_body: body.governingBody,
    approval_email_subject: body.approvalEmailSubject,
    approval_email_body: body.approvalEmailBody,
    brand_primary_color: body.brandPrimaryColor,
    notify_user_ids: body.notifyUserIds,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase.from('accounts_studio_firm_settings').upsert(row, { onConflict: 'firm_id' });
  // Retry without the later-migration columns if they aren't applied yet.
  if (error?.code === '42703') {
    delete row.accountant_name;
    delete row.accountant_address;
    delete row.approval_email_subject;
    delete row.approval_email_body;
    delete row.brand_primary_color;
    delete row.notify_user_ids;
    ({ error } = await supabase.from('accounts_studio_firm_settings').upsert(row, { onConflict: 'firm_id' }));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
