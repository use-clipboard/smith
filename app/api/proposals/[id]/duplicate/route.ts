import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// POST /api/proposals/[id]/duplicate — clone an existing proposal as a fresh
// draft. Keeps the same prospect by default, copies title (with "(copy)"),
// intro, terms, VAT settings, packages and line items. Resets status/sent/
// viewed/decided/token so it really is a brand-new proposal.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();

  const { data: src } = await supabase
    .from('proposals')
    .select(`
      *,
      offered_packages:proposal_offered_packages(*),
      line_items:proposal_line_items(*)
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!src) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 1. Create the new proposal row
  const { data: cloned, error: clonedErr } = await supabase
    .from('proposals')
    .insert({
      firm_id: ctx.firmId,
      prospect_id: src.prospect_id,
      title: `${src.title} (copy)`,
      intro: src.intro,
      terms: src.terms,
      notes_internal: src.notes_internal,
      vat_mode: src.vat_mode,
      vat_rate: src.vat_rate,
      discount_amount: src.discount_amount,
      discount_label: src.discount_label,
      status: 'draft',
      expires_at: null,
      created_by: ctx.userId,
    })
    .select('id')
    .single();
  if (clonedErr || !cloned) return NextResponse.json({ error: clonedErr?.message ?? 'Insert failed' }, { status: 500 });

  // 2. Clone offered packages with a stable old→new id map for line items
  const packages = (src.offered_packages ?? []) as Array<{ id: string; name: string; description: string | null; display_order: number }>;
  const pkgIdMap = new Map<string, string>();
  if (packages.length > 0) {
    const rows = packages.map(p => ({
      proposal_id: cloned.id,
      name: p.name,
      description: p.description,
      display_order: p.display_order,
    }));
    const { data: inserted } = await supabase
      .from('proposal_offered_packages')
      .insert(rows)
      .select('id, name, display_order');
    if (inserted) {
      // Match by display_order + name (stable enough for a clone)
      for (const orig of packages) {
        const match = inserted.find(p => p.name === orig.name && p.display_order === orig.display_order);
        if (match) pkgIdMap.set(orig.id, match.id);
      }
    }
  }

  // 3. Clone line items, remapping offered_package_id
  const items = (src.line_items ?? []) as Array<Record<string, unknown>>;
  if (items.length > 0) {
    const rows = items.map(li => ({
      proposal_id: cloned.id,
      offered_package_id: li.offered_package_id ? (pkgIdMap.get(li.offered_package_id as string) ?? null) : null,
      service_id: li.service_id ?? null,
      service_name: li.service_name,
      description: li.description ?? null,
      tier_label: li.tier_label ?? null,
      frequency: li.frequency,
      unit_price: li.unit_price,
      quantity: li.quantity,
      vat_treatment: li.vat_treatment,
      display_order: li.display_order,
    }));
    await supabase.from('proposal_line_items').insert(rows);
  }

  return NextResponse.json({ ok: true, id: cloned.id });
}
