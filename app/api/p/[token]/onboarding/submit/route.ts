import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';
import { instantiateTaskFromTemplate } from '@/lib/instantiateTaskFromTemplate';
import { createBillingFromProposal } from '@/lib/billing/fromProposal';
import { createServicesFromProposal } from '@/lib/services/fromProposal';

const Body = z.object({
  form_id: z.string().uuid(),
  submitted_by_name: z.string().min(1),
  submitted_by_email: z.string().email(),
  answers: z.record(z.string(), z.unknown()),
});

// Whitelist of columns on `clients` we'll allow a form to write into.
// Anything not in this set is silently ignored so admins can't accidentally
// inject malicious column names via the mapping field.
const ALLOWED_CLIENT_COLUMNS = new Set<string>([
  'name', 'client_ref', 'business_type', 'contact_email', 'contact_number',
  'paye_reference', 'paye_accounts_office_reference', 'vat_submit_type',
  'vat_scheme', 'year_end', 'mtd_it',
]);

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const service = createServiceClient();
  const { data: proposal } = await service
    .from('proposals')
    .select(`
      id, firm_id, status, created_by, title,
      prospect_id,
      prospect:proposal_prospects(id, contact_name, company_name, email, phone, client_type, converted_client_id),
      response:proposal_onboarding_responses(id)
    `)
    .eq('public_token', params.token)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status !== 'accepted') return NextResponse.json({ error: 'Proposal must be accepted before submitting onboarding.' }, { status: 400 });
  if ((proposal.response as Array<{ id: string }>)?.length > 0) {
    return NextResponse.json({ error: 'Onboarding form has already been submitted.' }, { status: 400 });
  }

  // Load the form + fields used
  const { data: form } = await service
    .from('proposal_onboarding_forms')
    .select('*, fields:proposal_onboarding_form_fields(*)')
    .eq('id', body.form_id)
    .eq('firm_id', proposal.firm_id)
    .maybeSingle();
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 });

  // Required-field validation
  const fields = (form.fields as Array<{ field_key: string; label: string; field_type: string; required: boolean; show_if_field_key: string | null; show_if_value: string | null; client_field_mapping: string | null }>) ?? [];
  for (const f of fields) {
    if (f.field_type === 'section_header' || f.field_type === 'info') continue;
    if (!f.required) continue;
    // Respect conditional visibility
    if (f.show_if_field_key) {
      const dep = body.answers[f.show_if_field_key];
      if (String(dep ?? '') !== (f.show_if_value ?? '')) continue;
    }
    const v = body.answers[f.field_key];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      return NextResponse.json({ error: `${f.label} is required.` }, { status: 400 });
    }
  }

  // Firm settings — which side-effects to run
  // select('*') (not an explicit column list) so a not-yet-migrated column
  // (e.g. auto_create_billing pre-migration) can't fail the whole query and
  // silently disable the other auto side-effects.
  const { data: settings } = await service
    .from('firm_proposal_settings')
    .select('*')
    .eq('firm_id', proposal.firm_id)
    .maybeSingle();

  const sideEffectLog: Record<string, unknown> = {};
  const prospect = (Array.isArray(proposal.prospect) ? proposal.prospect[0] : proposal.prospect) as { id: string; contact_name: string; company_name: string | null; email: string; phone: string | null; client_type: string | null; converted_client_id: string | null };

  // ── Side-effect 1: graduate prospect → client ────────────────────────
  let graduatedClientId: string | null = prospect.converted_client_id;
  if (settings?.auto_graduate_client !== false && !graduatedClientId) {
    const clientName = prospect.company_name ?? prospect.contact_name;
    const businessTypeFromProspect = prospect.client_type ?? null;
    const { data: created, error: createErr } = await service
      .from('clients')
      .insert({
        firm_id: proposal.firm_id,
        name: clientName,
        business_type: businessTypeFromProspect,
        contact_email: prospect.email,
      })
      .select('id')
      .single();
    if (createErr) {
      sideEffectLog.graduate_error = createErr.message;
    } else {
      graduatedClientId = created.id;
      sideEffectLog.graduated = { client_id: created.id };
      // Mark prospect as converted
      await service
        .from('proposal_prospects')
        .update({ status: 'converted', converted_client_id: created.id, converted_at: new Date().toISOString() })
        .eq('id', prospect.id);
    }
  }

  // ── Side-effect 2: write mapped answers to clients ───────────────────
  if (graduatedClientId && settings?.auto_save_form_answers !== false) {
    const update: Record<string, unknown> = {};
    for (const f of fields) {
      if (!f.client_field_mapping) continue;
      if (!ALLOWED_CLIENT_COLUMNS.has(f.client_field_mapping)) continue;
      const v = body.answers[f.field_key];
      if (v === undefined) continue;
      update[f.client_field_mapping] = v;
    }
    if (Object.keys(update).length > 0) {
      const { error: upErr } = await service.from('clients').update(update).eq('id', graduatedClientId);
      if (upErr) sideEffectLog.save_answers_error = upErr.message;
      else sideEffectLog.saved_columns = Object.keys(update);
    }
  }

  // ── Side-effect 3: AML / Risk Assessment placeholder ─────────────────
  // We don't run the AI here — instead we insert an `outputs` row tagged as
  // risk_assessment carrying the AML-related answers from the onboarding form.
  // The user can open the Risk Assessment tool against this client to finalise it.
  if (settings?.auto_create_aml && graduatedClientId) {
    const amlAnswers: Record<string, unknown> = {};
    for (const f of fields) {
      const key = f.field_key.toLowerCase();
      if (key.includes('aml') || key.includes('pep') || key.includes('source_of_funds') || key.includes('id_verif')) {
        amlAnswers[f.field_key] = (body.answers as Record<string, unknown>)[f.field_key] ?? null;
      }
    }
    const { data: amlRow, error: amlErr } = await service
      .from('outputs')
      .insert({
        firm_id: proposal.firm_id,
        client_id: graduatedClientId,
        user_id: proposal.created_by,
        feature: 'risk_assessment',
        result_data: {
          source: 'proposal_onboarding',
          proposal_id: proposal.id,
          submittedAnswers: amlAnswers,
          note: 'Auto-stub created on prospect onboarding. Open Risk Assessment to finalise the AML rating.',
        },
      })
      .select('id')
      .single();
    if (amlErr) sideEffectLog.aml_error = amlErr.message;
    else sideEffectLog.aml = { output_id: amlRow.id, fields_captured: Object.keys(amlAnswers).length };
  }

  // ── Side-effect 4: create tasks from template ────────────────────────
  if (settings?.auto_create_tasks && graduatedClientId && settings.auto_tasks_template_id) {
    const result = await instantiateTaskFromTemplate({
      firmId: proposal.firm_id,
      templateId: settings.auto_tasks_template_id,
      clientId: graduatedClientId,
      createdBy: proposal.created_by,
      titleOverride: `Onboarding — ${prospect.company_name ?? prospect.contact_name}`,
    });
    if (result.error) sideEffectLog.tasks_error = result.error;
    if (result.taskId) sideEffectLog.tasks = { task_id: result.taskId };
  }

  // ── Side-effect 5 (placeholder): generate Letter of Engagement PDF ───
  if (settings?.auto_generate_loe) {
    sideEffectLog.loe = { deferred: 'PDF generation lands in Phase C' };
  }

  // ── Side-effect 6: create billing from the proposal's line items ─────
  // Recurring fees → recurring_invoices schedules (+ a first draft invoice);
  // one-off fees → a single draft invoice. Drafts, so the firm reviews first.
  if (settings?.auto_create_billing && graduatedClientId) {
    const billing = await createBillingFromProposal(service, {
      firmId: proposal.firm_id,
      proposalId: proposal.id,
      clientId: graduatedClientId,
      clientName: prospect.company_name ?? prospect.contact_name,
      createdBy: proposal.created_by,
    });
    if (billing.error) sideEffectLog.billing_error = billing.error;
    else sideEffectLog.billing = { recurring: billing.recurringCreated, invoices: billing.invoiceCreated };
  }

  // ── Side-effect 7: pre-populate the client's Services from the proposal ──
  // Each catalogue-derived line item (service_id set) becomes a client_service.
  if (settings?.pre_populate_services && graduatedClientId) {
    const svc = await createServicesFromProposal(service, {
      firmId: proposal.firm_id,
      proposalId: proposal.id,
      clientId: graduatedClientId,
      createdBy: proposal.created_by,
    });
    if (svc.error) sideEffectLog.services_error = svc.error;
    else sideEffectLog.services = { created: svc.created };
  }

  // Persist the response
  const { data: response, error: respErr } = await service
    .from('proposal_onboarding_responses')
    .insert({
      proposal_id: proposal.id,
      form_id: form.id,
      answers: body.answers,
      submitted_by_name: body.submitted_by_name,
      submitted_by_email: body.submitted_by_email,
      graduated_client_id: graduatedClientId,
      side_effect_log: sideEffectLog,
    })
    .select('id')
    .single();
  if (respErr) return NextResponse.json({ error: respErr.message }, { status: 500 });

  await service.from('proposals').update({ onboarding_response_id: response.id }).eq('id', proposal.id);

  // Notify the firm
  if (proposal.created_by) {
    void createNotification({
      userId: proposal.created_by,
      firmId: proposal.firm_id,
      type: 'proposal_onboarding_submitted',
      title: 'Onboarding form submitted',
      body: `${prospect.contact_name} completed onboarding for "${proposal.title}".`,
      data: { proposal_id: proposal.id, client_id: graduatedClientId, link: '/proposals' },
    });
  }

  return NextResponse.json({ ok: true, clientId: graduatedClientId });
}
