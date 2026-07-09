// Billing module — turn an accepted proposal's line items into billing.
//
// Grouped by frequency: recurring lines (monthly/quarterly/annual) each become
// a recurring_invoices schedule (and the first invoice is minted immediately as
// a DRAFT so the accountant reviews before it goes out); one_off lines become a
// single draft invoice. Called as side-effect 6 of proposal onboarding, gated
// by firm_proposal_settings.auto_create_billing. Uses a service-role client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { computeInvoiceTotals } from './totals';
import { mintRecurringInvoice } from './recurrence';

type Freq = 'one_off' | 'monthly' | 'quarterly' | 'annual';

interface ProposalLineRow {
  service_name: string;
  description: string | null;
  frequency: Freq;
  unit_price: number;      // pounds
  quantity: number;
  vat_treatment: 'inclusive' | 'exclusive' | 'exempt';
}

interface TemplateLine { description: string; quantity: number; unitPricePence: number; vatRate: number }

export interface ProposalBillingResult {
  recurringCreated: number;
  invoiceCreated: number;
  error?: string;
}

export async function createBillingFromProposal(
  service: SupabaseClient,
  args: { firmId: string; proposalId: string; clientId: string | null; clientName: string; createdBy: string | null },
): Promise<ProposalBillingResult> {
  const { firmId, proposalId, clientId, clientName, createdBy } = args;

  const { data: lineData, error: lineErr } = await service
    .from('proposal_line_items')
    .select('service_name, description, frequency, unit_price, quantity, vat_treatment')
    .eq('proposal_id', proposalId);
  if (lineErr) return { recurringCreated: 0, invoiceCreated: 0, error: lineErr.message };

  const lines = (lineData ?? []) as ProposalLineRow[];
  if (!lines.length) return { recurringCreated: 0, invoiceCreated: 0 };

  const { data: settings } = await service
    .from('billing_settings').select('default_vat_rate, default_payment_terms_days').eq('firm_id', firmId).maybeSingle();
  const defaultVat = Number(settings?.default_vat_rate ?? 20);
  const termsDays = settings?.default_payment_terms_days ?? 14;

  // exempt / inclusive → no VAT added; exclusive → the firm's default rate.
  const vatFor = (t: ProposalLineRow['vat_treatment']) => (t === 'exclusive' ? defaultVat : 0);
  const toTemplate = (l: ProposalLineRow): TemplateLine => ({
    description: l.description?.trim() ? `${l.service_name} — ${l.description.trim()}` : l.service_name,
    quantity: Number(l.quantity) || 1,
    unitPricePence: Math.round((Number(l.unit_price) || 0) * 100),
    vatRate: vatFor(l.vat_treatment),
  });

  const today = new Date().toISOString().slice(0, 10);
  const byFreq: Record<string, ProposalLineRow[]> = {};
  for (const l of lines) (byFreq[l.frequency] ??= []).push(l);

  let recurringCreated = 0;
  let invoiceCreated = 0;

  // Recurring schedules (one per frequency present).
  for (const freq of ['monthly', 'quarterly', 'annual'] as const) {
    const group = byFreq[freq];
    if (!group?.length) continue;
    const template = group.map(toTemplate);
    const totals = computeInvoiceTotals(template);

    const { data: rec, error: recErr } = await service
      .from('recurring_invoices')
      .insert({
        firm_id: firmId,
        client_id: clientId,
        client_name: clientName,
        frequency: freq,
        start_date: today,
        next_run_date: today,
        status: 'active',
        template: totals.lines.map(l => ({ description: l.description, quantity: l.quantity, unitPricePence: l.unitPricePence, vatRate: l.vatRate })),
        subtotal_pence: totals.subtotalPence,
        vat_pence: totals.vatPence,
        total_pence: totals.totalPence,
        auto_send: false, // drafts — accountant reviews before sending
        proposal_id: proposalId,
        source_note: 'Created from accepted proposal',
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (recErr || !rec) continue;
    recurringCreated++;

    // Mint the first invoice now (draft), advancing the schedule to next period.
    const res = await mintRecurringInvoice(service, rec, termsDays);
    if (res.minted) invoiceCreated++;
  }

  // One-off lines → a single draft invoice.
  const oneOff = byFreq['one_off'];
  if (oneOff?.length) {
    const template = oneOff.map(toTemplate);
    const totals = computeInvoiceTotals(template);
    const { data: inv, error: invErr } = await service
      .from('invoices')
      .insert({
        firm_id: firmId,
        client_id: clientId,
        client_name: clientName,
        status: 'draft',
        issue_date: today,
        subtotal_pence: totals.subtotalPence,
        vat_pence: totals.vatPence,
        total_pence: totals.totalPence,
        source: 'proposal',
        source_id: null,
        created_by: createdBy,
      })
      .select('id')
      .single();
    if (!invErr && inv) {
      invoiceCreated++;
      await service.from('invoice_lines').insert(
        totals.lines.map((l, i) => ({
          invoice_id: inv.id, firm_id: firmId,
          description: l.description, quantity: l.quantity, unit_price_pence: l.unitPricePence,
          vat_rate: l.vatRate, net_pence: l.netPence, vat_pence: l.vatPence, gross_pence: l.grossPence, position: i,
        })),
      );
    }
  }

  return { recurringCreated, invoiceCreated };
}
