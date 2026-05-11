import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Field = z.object({
  field_key: z.string().min(1).regex(/^[a-z0-9_]+$/, 'lowercase letters/numbers/underscores only'),
  label: z.string().min(1),
  field_type: z.enum(['text','textarea','email','phone','date','number','select','checkbox','radio','file','section_header','info']),
  required: z.boolean().optional(),
  placeholder: z.string().nullable().optional(),
  help_text: z.string().nullable().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  show_if_field_key: z.string().nullable().optional(),
  show_if_value: z.string().nullable().optional(),
  client_field_mapping: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
});

const Body = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  client_type: z.string().nullable().optional(),
  service_filter: z.array(z.string().uuid()).optional(),
  is_default: z.boolean().optional(),
  active: z.boolean().optional(),
  fields: z.array(Field).optional(),
});

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data, error } = await supabase
    .from('proposal_onboarding_forms')
    .select('*, fields:proposal_onboarding_form_fields(*)')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ forms: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { data: form, error } = await supabase
    .from('proposal_onboarding_forms')
    .insert({
      firm_id: ctx.firmId,
      name: body.name,
      description: body.description ?? null,
      client_type: body.client_type ?? null,
      service_filter: body.service_filter && body.service_filter.length > 0 ? body.service_filter : null,
      is_default: body.is_default ?? false,
      active: body.active ?? true,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (body.fields && body.fields.length > 0) {
    const rows = body.fields.map((f, i) => ({
      form_id: form.id,
      field_key: f.field_key,
      label: f.label,
      field_type: f.field_type,
      required: f.required ?? false,
      placeholder: f.placeholder ?? null,
      help_text: f.help_text ?? null,
      options: f.options ?? null,
      show_if_field_key: f.show_if_field_key ?? null,
      show_if_value: f.show_if_value ?? null,
      client_field_mapping: f.client_field_mapping ?? null,
      display_order: f.display_order ?? i,
    }));
    await supabase.from('proposal_onboarding_form_fields').insert(rows);
  }
  return NextResponse.json({ form });
}
