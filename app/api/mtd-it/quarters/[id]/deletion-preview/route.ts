import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/mtd-it/quarters/[id]/deletion-preview
//   Returns counts of what would be wiped if the quarter is deleted +
//   whether the caller is allowed to do it. The MtdItDeleteQuarterModal
//   pulls this on open so the admin sees exactly what they're committing
//   to ("18 entries, 6 documents, 1 approval cycle").

interface CountResponse {
  is_admin: boolean;
  entry_count: number;
  document_count: number;
  approval_count: number;
  status: string;
  client_name: string;
  client_ref: string | null;
  quarter_label: string;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Firm-scope check + load the basic shape of the quarter for the modal
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, status, quarter, tax_year, clients!inner(firm_id, name, client_ref)')
    .eq('id', params.id)
    .maybeSingle();
  const client = (q as unknown as { clients?: { firm_id?: string; name?: string; client_ref?: string | null } } | null)?.clients;
  if (!q || client?.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }

  // Three parallel counts. head:true + count:'exact' returns just the count
  // without pulling the rows themselves.
  const [entries, documents, approvals] = await Promise.all([
    supabase.from('mtd_it_entries')           .select('id', { count: 'exact', head: true }).eq('quarter_id', params.id),
    supabase.from('mtd_it_documents')         .select('id', { count: 'exact', head: true }).eq('quarter_id', params.id),
    supabase.from('mtd_it_quarter_approvals') .select('id', { count: 'exact', head: true }).eq('quarter_id', params.id),
  ]);

  const taxYear = (q as { tax_year: number }).tax_year;
  const quarter = (q as { quarter: number }).quarter;
  const next = (taxYear + 1) % 100;
  const taxYearLabel = `${taxYear}/${String(next).padStart(2, '0')}`;

  const payload: CountResponse = {
    is_admin:       ctx.userRole === 'admin',
    entry_count:    entries.count    ?? 0,
    document_count: documents.count  ?? 0,
    approval_count: approvals.count  ?? 0,
    status:         (q as { status: string }).status,
    client_name:    client.name ?? '',
    client_ref:     client.client_ref ?? null,
    quarter_label:  `Q${quarter} ${taxYearLabel}`,
  };
  return NextResponse.json(payload);
}
