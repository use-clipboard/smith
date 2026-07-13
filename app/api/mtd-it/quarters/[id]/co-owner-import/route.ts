import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET  /api/mtd-it/quarters/[id]/co-owner-import
//   Returns a list of "importable" co-owner quarters for THIS quarter —
//   one entry per linked property × co-owner that already has clean
//   (non-flagged, non-deleted) entries for the same tax year + quarter.
//   The setup-phase banner uses this to decide whether to prompt the user.
//
// POST /api/mtd-it/quarters/[id]/co-owner-import
//   Body: { imports: Array<{ source_quarter_id, source_property_id,
//                            target_property_id, mode: 'append'|'replace' }> }
//   Copies clean entries from each source onto this quarter, applying
//   THIS client's share_pct (from the target property row) so the
//   importing client sees their own share, not the source's. Drive
//   links + source filenames are preserved so reviewers can still jump
//   to the original document.

// ── Shared helpers ────────────────────────────────────────────────────
function normAddress(a: string): string { return a.replace(/\s+/g, ' ').trim().toLowerCase(); }

interface QuarterInfo { id: string; client_id: string; tax_year: number; quarter: number; firm_id: string; }

async function loadQuarter(quarterId: string): Promise<QuarterInfo | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('mtd_it_quarters')
    .select('id, client_id, tax_year, quarter, clients!inner(firm_id)')
    .eq('id', quarterId)
    .maybeSingle();
  if (!data) return null;
  const f = (data as unknown as { clients?: { firm_id?: string } }).clients?.firm_id;
  if (!f) return null;
  return {
    id:        data.id as string,
    client_id: data.client_id as string,
    tax_year:  data.tax_year as number,
    quarter:   data.quarter as number,
    firm_id:   f,
  };
}

interface ImportableSource {
  source_quarter_id:    string;
  source_quarter_status: string;
  source_client_id:     string;
  source_client_name:   string;
  source_property_id:   string;
  /** Target property row on the importing client — the one entries land on. */
  target_property_id:   string;
  property_address:     string;
  property_type:        'uk' | 'foreign';
  clean_entry_count:    number;
  existing_count_on_target: number;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const q = await loadQuarter(params.id);
  if (!q || q.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  const service = createServiceClient();

  // This client's properties (only rental — sole trader doesn't share).
  const { data: myProps } = await service
    .from('mtd_it_properties')
    .select('id, address, property_type, ownership_pct')
    .eq('client_id', q.client_id)
    .in('property_type', ['uk', 'foreign']);
  if (!myProps || myProps.length === 0) return NextResponse.json({ sources: [] });

  // Their co-owner links.
  const myPropIds = myProps.map(p => p.id as string);
  const { data: links } = await service
    .from('mtd_it_property_links')
    .select('property_id, co_owner_client_id')
    .in('property_id', myPropIds);
  if (!links || links.length === 0) return NextResponse.json({ sources: [] });

  // For each link, find the co-owner's matching quarter (same tax_year + quarter)
  // and count clean entries on the matching property (by normalised address).
  const sources: ImportableSource[] = [];
  for (const link of links) {
    const myProp = myProps.find(p => p.id === link.property_id);
    if (!myProp) continue;
    const wantedAddr = normAddress(myProp.address as string);

    // Find the co-owner's quarter row for this tax year + quarter
    const { data: coQuarter } = await service
      .from('mtd_it_quarters')
      .select('id, status')
      .eq('client_id', link.co_owner_client_id)
      .eq('tax_year', q.tax_year)
      .eq('quarter',  q.quarter)
      .maybeSingle();
    if (!coQuarter) continue;

    // Find the matching co-owner property by address
    const { data: coProps } = await service
      .from('mtd_it_properties')
      .select('id, address')
      .eq('client_id', link.co_owner_client_id);
    const coProp = (coProps ?? []).find(p => normAddress(p.address as string) === wantedAddr);
    if (!coProp) continue;

    // Count clean entries on the co-owner's quarter that are tagged to that
    // property. Clean = not deleted (deletes are physical here), not flagged
    // (flagged_reason set + flag_dismissed false).
    const { count: cleanCount } = await service
      .from('mtd_it_entries')
      .select('id', { count: 'exact', head: true })
      .eq('quarter_id', coQuarter.id)
      .eq('property_id', coProp.id)
      .or('flagged_reason.is.null,flag_dismissed.eq.true');

    if (!cleanCount || cleanCount === 0) continue;

    // Co-owner name (one-off look-up — fine for the typical < 10 sources)
    const { data: coClient } = await service.from('clients').select('name').eq('id', link.co_owner_client_id).maybeSingle();

    // Existing entries on THIS quarter for the target property — so we can
    // show "you already have N entries" in the conflict picker.
    const { count: existingCount } = await service
      .from('mtd_it_entries')
      .select('id', { count: 'exact', head: true })
      .eq('quarter_id', q.id)
      .eq('property_id', myProp.id);

    sources.push({
      source_quarter_id:        coQuarter.id as string,
      source_quarter_status:    (coQuarter.status as string) ?? 'draft',
      source_client_id:         link.co_owner_client_id as string,
      source_client_name:       coClient?.name ?? '',
      source_property_id:       coProp.id as string,
      target_property_id:       myProp.id as string,
      property_address:         myProp.address as string,
      property_type:            myProp.property_type as 'uk' | 'foreign',
      clean_entry_count:        cleanCount,
      existing_count_on_target: existingCount ?? 0,
    });
  }

  return NextResponse.json({ sources });
}

const PostSchema = z.object({
  imports: z.array(z.object({
    source_quarter_id:  z.string().uuid(),
    source_property_id: z.string().uuid(),
    target_property_id: z.string().uuid(),
    mode:               z.enum(['append', 'replace']),
  })).min(1),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const q = await loadQuarter(params.id);
  if (!q || q.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();

  let totalInserted = 0;
  let totalReplaced = 0;

  for (const it of parsed.data.imports) {
    // Re-validate target property belongs to THIS quarter's client + firm.
    const { data: targetProp } = await service
      .from('mtd_it_properties')
      .select('id, client_id, ownership_pct, property_type, address, clients!inner(firm_id)')
      .eq('id', it.target_property_id)
      .maybeSingle();
    const targetFirm = (targetProp as unknown as { clients?: { firm_id?: string } } | null)?.clients?.firm_id;
    if (!targetProp || targetProp.client_id !== q.client_id || targetFirm !== ctx.firmId) {
      console.warn('co-owner-import: target property mismatch, skipping', it);
      continue;
    }

    // Re-validate source quarter is co-owned (via property link)
    const { data: sourceProp } = await service
      .from('mtd_it_properties')
      .select('id, client_id, address')
      .eq('id', it.source_property_id)
      .maybeSingle();
    if (!sourceProp) continue;
    const { data: link } = await service
      .from('mtd_it_property_links')
      .select('id')
      .eq('property_id', it.target_property_id)
      .eq('co_owner_client_id', sourceProp.client_id)
      .maybeSingle();
    if (!link) {
      console.warn('co-owner-import: no link between target + source, skipping', it);
      continue;
    }

    // Optional REPLACE pass — wipe existing entries for the target property
    // on this quarter before importing.
    if (it.mode === 'replace') {
      const { count: rc } = await service
        .from('mtd_it_entries')
        .delete({ count: 'exact' })
        .eq('quarter_id', q.id)
        .eq('property_id', it.target_property_id);
      totalReplaced += rc ?? 0;
    }

    // Pull clean entries from the source.
    const { data: sourceEntries } = await service
      .from('mtd_it_entries')
      .select('stream, source_file_name, page_number, entry_date, description, supplier, invoice_number, category, entry_type, gross_amount, net_amount, vat_amount, currency, fx_rate, gbp_amount, drive_link')
      .eq('quarter_id', it.source_quarter_id)
      .eq('property_id', it.source_property_id)
      .or('flagged_reason.is.null,flag_dismissed.eq.true');
    if (!sourceEntries || sourceEntries.length === 0) continue;

    // Build insert rows — set property_id to TARGET, share_pct to TARGET's
    // ownership, manual=false. Drive link + source_file_name preserved.
    const rows = sourceEntries.map(e => ({
      quarter_id:       q.id,
      trade_id:         null,
      property_id:      it.target_property_id,
      stream:           e.stream,
      source_file_name: e.source_file_name,
      page_number:      e.page_number,
      entry_date:       e.entry_date,
      description:      e.description,
      supplier:         e.supplier,
      invoice_number:   e.invoice_number,
      category:         e.category,
      entry_type:       e.entry_type,
      gross_amount:     e.gross_amount,
      net_amount:       e.net_amount,
      vat_amount:       e.vat_amount,
      currency:         e.currency,
      fx_rate:          e.fx_rate,
      gbp_amount:       e.gbp_amount,
      share_pct:        Number(targetProp.ownership_pct),
      manual:           false,
      drive_link:       e.drive_link,
    }));
    const { error: insErr, count } = await service.from('mtd_it_entries').insert(rows, { count: 'exact' });
    if (insErr) {
      console.error('co-owner-import insert', insErr);
      continue;
    }
    totalInserted += count ?? rows.length;
  }

  return NextResponse.json({ ok: true, inserted: totalInserted, replaced: totalReplaced });
}
