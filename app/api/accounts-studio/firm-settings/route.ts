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
  governingBody: z.string().max(20000).default(''),
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
  const { error } = await supabase
    .from('accounts_studio_firm_settings')
    .upsert({
      firm_id: ctx.firmId,
      accountants_report: body.accountantsReport,
      accountant_details: body.accountantDetails,
      governing_body: body.governingBody,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'firm_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
