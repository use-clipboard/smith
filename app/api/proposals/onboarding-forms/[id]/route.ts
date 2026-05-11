import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const Field = z.object({
  field_key: z.string().min(1).regex(/^[a-z0-9_]+$/),
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

const Patch = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  client_type: z.string().nullable().optional(),
  service_filter: z.array(z.string().uuid()).nullable().optional(),
  is_default: z.boolean().optional(),
  active: z.boolean().optional(),
  fields: z.array(Field).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  let patch: z.infer<typeof Patch>;
  try { patch = Patch.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }
  const supabase = createClient();
  const { fields, ...row } = patch;
  if (Object.keys(row).length > 0) {
    const update: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };
    if ('service_filter' in row && (!row.service_filter || row.service_filter.length === 0)) update.service_filter = null;
    const { error } = await supabase.from('proposal_onboarding_forms').update(update).eq('id', params.id).eq('firm_id', ctx.firmId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (fields) {
    await supabase.from('proposal_onboarding_form_fields').delete().eq('form_id', params.id);
    if (fields.length > 0) {
      const rows = fields.map((f, i) => ({
        form_id: params.id,
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
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  const supabase = createClient();
  const { error } = await supabase.from('proposal_onboarding_forms').delete().eq('id', params.id).eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
