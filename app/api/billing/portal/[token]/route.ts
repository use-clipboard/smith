import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { balancePence } from '@/lib/billing/totals';
import { mapInvoiceRow, type InvoiceRow, type InvoiceLineRow } from '@/lib/billing/map';
import { isStripeConfigured } from '@/lib/billing/stripe';

// GET /api/billing/portal/[token] — PUBLIC. Resolves a client statement-portal
// token (service-role, no auth) and returns their statement + letterhead.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: tok } = await supabase
    .from('billing_portal_tokens').select('firm_id, client_id, expires_at').eq('token', params.token).maybeSingle();
  if (!tok || (tok.expires_at as string) < nowIso) {
    return NextResponse.json({ error: 'This statement link has expired.' }, { status: 404 });
  }

  const [{ data: settings }, { data: firm }, { data: client }, { data: invData }] = await Promise.all([
    supabase.from('billing_settings').select('business_name, business_address, vat_number, bank_details, invoice_footer').eq('firm_id', tok.firm_id).maybeSingle(),
    supabase.from('firms').select('name').eq('id', tok.firm_id).maybeSingle(),
    supabase.from('clients').select('name').eq('id', tok.client_id).maybeSingle(),
    supabase.from('invoices').select('*').eq('firm_id', tok.firm_id).eq('client_id', tok.client_id).not('status', 'in', '("draft","cancelled")').order('issue_date', { ascending: false }).limit(200),
  ]);

  const invoices = (invData ?? []) as InvoiceRow[];
  const ids = invoices.map(i => i.id);
  const linesByInvoice = new Map<string, InvoiceLineRow[]>();
  if (ids.length) {
    const { data: lineData } = await supabase.from('invoice_lines').select('*').in('invoice_id', ids).order('position', { ascending: true });
    for (const l of (lineData ?? []) as (InvoiceLineRow & { invoice_id: string })[]) {
      const list = linesByInvoice.get(l.invoice_id) ?? []; list.push(l); linesByInvoice.set(l.invoice_id, list);
    }
  }

  const outstandingPence = invoices.reduce((s, r) => s + (['sent', 'viewed', 'part_paid', 'overdue'].includes(r.status) ? balancePence(r.total_pence, r.amount_paid_pence) : 0), 0);
  const businessName = (settings?.business_name as string) || firm?.name || 'Our practice';

  return NextResponse.json({
    firmName: businessName,
    businessAddress: settings?.business_address ?? '',
    vatNumber: settings?.vat_number ?? '',
    bankDetails: settings?.bank_details ?? '',
    invoiceFooter: settings?.invoice_footer ?? '',
    clientName: client?.name ?? 'Customer',
    outstandingPence,
    stripeConfigured: isStripeConfigured(),
    invoices: invoices.map(r => mapInvoiceRow(r, linesByInvoice.get(r.id))),
  });
}
