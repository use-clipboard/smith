import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Body = z.object({
  prospect_id: z.string().uuid(),
  title: z.string().min(1).optional(),
  intro: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  notes_internal: z.string().nullable().optional(),
  vat_mode: z.enum(['inclusive','exclusive']).optional(),
  vat_rate: z.number().optional(),
  expires_at: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const supabase = createClient();
  let q = supabase
    .from('proposals')
    .select('*, prospect:proposal_prospects(id, contact_name, company_name, email, client_type, status)')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ proposals: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  // Pull firm defaults for VAT etc.
  const { data: settings } = await supabase
    .from('firm_proposal_settings')
    .select('default_vat_mode, default_vat_rate, intro_template, terms_template, default_expiry_days, default_post_acceptance_action')
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  const vatMode = body.vat_mode ?? (settings?.default_vat_mode as 'inclusive' | 'exclusive' | undefined) ?? 'exclusive';
  const vatRate = body.vat_rate ?? settings?.default_vat_rate ?? 20;
  const intro = body.intro ?? settings?.intro_template ?? null;
  const terms = body.terms ?? settings?.terms_template ?? null;
  const expiresAt = body.expires_at ?? (settings?.default_expiry_days
    ? new Date(Date.now() + settings.default_expiry_days * 86_400_000).toISOString()
    : null);
  const postAcceptanceAction = (settings?.default_post_acceptance_action as
    | 'none' | 'send_onboarding' | 'auto_create_client' | undefined) ?? 'send_onboarding';

  const { data, error } = await supabase
    .from('proposals')
    .insert({
      firm_id: ctx.firmId,
      prospect_id: body.prospect_id,
      title: body.title ?? 'Proposal',
      intro,
      terms,
      notes_internal: body.notes_internal ?? null,
      vat_mode: vatMode,
      vat_rate: vatRate,
      expires_at: expiresAt,
      post_acceptance_action: postAcceptanceAction,
      created_by: ctx.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ proposal: data });
}
