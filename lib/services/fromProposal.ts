// Create a client's Services from an accepted proposal's line items.
// Only line items that came from the shared catalogue (service_id set) are used
// — ad-hoc/free-text lines are skipped, matching "only if the proposal used the
// services catalogue". Idempotent: skips catalogue services the client already
// has. Advisory/informational fee (pence, whatever VAT treatment the line had).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = any;

export interface ServicesFromProposalResult { created: number; error?: string }

export async function createServicesFromProposal(
  service: Supa,
  opts: { firmId: string; proposalId: string; clientId: string; createdBy: string | null },
): Promise<ServicesFromProposalResult> {
  try {
    const { data: lines, error } = await service
      .from('proposal_line_items')
      .select('service_id, service_name, description, frequency, unit_price, quantity, vat_treatment')
      .eq('proposal_id', opts.proposalId)
      .not('service_id', 'is', null);
    if (error) return { created: 0, error: error.message };
    if (!lines || lines.length === 0) return { created: 0 };

    // Skip catalogue services the client already has.
    const { data: have } = await service.from('client_services').select('catalogue_id').eq('client_id', opts.clientId);
    const haveSet = new Set((have ?? []).map((r: { catalogue_id: string | null }) => r.catalogue_id).filter(Boolean));
    const { data: last } = await service
      .from('client_services').select('sort_order').eq('client_id', opts.clientId)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    let sort = (last?.sort_order ?? -1) as number;

    // Collapse duplicate service_ids within the proposal (keep the first).
    const seen = new Set<string>();
    const rows: Record<string, unknown>[] = [];
    for (const l of lines as Array<{ service_id: string; service_name: string; description: string | null; frequency: string; unit_price: number; quantity: number; vat_treatment: string | null }>) {
      if (seen.has(l.service_id) || haveSet.has(l.service_id)) continue;
      seen.add(l.service_id);
      const qty = Number(l.quantity) || 1;
      const pricePence = l.unit_price != null ? Math.round(Number(l.unit_price) * qty * 100) : null;
      rows.push({
        firm_id: opts.firmId,
        client_id: opts.clientId,
        catalogue_id: l.service_id,
        name: l.service_name,
        description: l.description ?? null,
        frequency: l.frequency ?? null,
        price_pence: pricePence,
        vat_treatment: l.vat_treatment ?? null,
        status: 'active',
        created_by: opts.createdBy,
        sort_order: ++sort,
      });
    }
    if (rows.length === 0) return { created: 0 };

    const { error: insErr } = await service.from('client_services').insert(rows);
    if (insErr) return { created: 0, error: insErr.message };
    return { created: rows.length };
  } catch (e) {
    return { created: 0, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
