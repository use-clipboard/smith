import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Patch = z.object({
  default_vat_mode: z.enum(['inclusive','exclusive']).optional(),
  default_vat_rate: z.number().optional(),
  intro_template: z.string().nullable().optional(),
  terms_template: z.string().nullable().optional(),
  default_expiry_days: z.number().int().nullable().optional(),
  auto_graduate_client: z.boolean().optional(),
  auto_save_form_answers: z.boolean().optional(),
  auto_create_aml: z.boolean().optional(),
  auto_create_tasks: z.boolean().optional(),
  auto_tasks_template_id: z.string().uuid().nullable().optional(),
  auto_generate_loe: z.boolean().optional(),
  collect_payment_on_accept: z.boolean().optional(),
  stripe_account_id: z.string().nullable().optional(),
  email_from_address: z.string().nullable().optional(),
  email_signature: z.string().nullable().optional(),
  proposal_email_sender_user_id: z.string().uuid().nullable().optional(),
  // Branding
  brand_use_firm_logo: z.boolean().optional(),
  brand_logo_url: z.string().nullable().optional(),
  brand_header_image_url: z.string().nullable().optional(),
  brand_primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brand_accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  brand_font_family: z.string().optional(),
  brand_footer_text: z.string().nullable().optional(),
  brand_show_firm_name: z.boolean().optional(),
  proposal_email_sender_connection_id: z.string().uuid().nullable().optional(),
  subject_proposal: z.string().nullable().optional(),
  subject_reminder: z.string().nullable().optional(),
  subject_onboarding: z.string().nullable().optional(),
  body_reminder: z.string().nullable().optional(),
  body_onboarding: z.string().nullable().optional(),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data } = await supabase
    .from('firm_proposal_settings')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  // Lazy default row
  if (!data) {
    const { data: created } = await supabase
      .from('firm_proposal_settings')
      .insert({ firm_id: ctx.firmId })
      .select('*')
      .single();
    return NextResponse.json({ settings: created });
  }
  return NextResponse.json({ settings: data });
}

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let patch: z.infer<typeof Patch>;
  try { patch = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  await supabase
    .from('firm_proposal_settings')
    .upsert({ firm_id: ctx.firmId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'firm_id' });
  const { data } = await supabase.from('firm_proposal_settings').select('*').eq('firm_id', ctx.firmId).maybeSingle();
  return NextResponse.json({ settings: data });
}
