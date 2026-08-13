import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { computeRentComputation, type LandlordEntityType } from '@/utils/landlordComputation';
import { personShareRows, personShareAdjustments, personOwnedProperties } from '@/utils/landlordAllocation';
import type { LandlordProperty } from '@/types';

export const dynamic = 'force-dynamic';

function parseFlexibleDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3]); return isNaN(d.getTime()) ? null : d; }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); return isNaN(d.getTime()) ? null : d; }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

interface LandlordRunData {
  income?: Record<string, unknown>[];
  expenses?: Record<string, unknown>[];
  adjustments?: Record<string, unknown>[];
  dateFrom?: string;
  dateTo?: string;
  entityType?: string;
  useAllowance?: boolean;
  broughtForwardLoss?: number;
  personSettings?: Record<string, { entityType?: string; useAllowance?: boolean; broughtForwardLoss?: number }>;
}

const NOT_FOUND = { found: false, dateFrom: '', dateTo: '', totalIncome: 0, totalExpenses: 0, netProfit: 0, taxableProfit: 0, financeCosts: 0, financeReducer: 0 };

// GET /api/tax-studio/integrations/landlord?clientId=<uuid>&taxYear=2025/26
//
// Returns the rental figures for `clientId`. If `clientId` is a co-owner (or a
// partial owner) of a landlord analysis — their OWN, or one saved under another
// client where they're a linked owner — the figures are THEIR SHARE, computed by
// scaling that person's transactions and running the ordinary rental computation
// (so the finance-cost restriction, £1,000 allowance and losses apply to their
// numbers, not to a slice of the portfolio's answer). Sole/unregistered analyses
// return the whole portfolio, as before.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const taxYearLabel = url.searchParams.get('taxYear') ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
  const startYear = parseInt(taxYearLabel.slice(0, 4), 10);
  if (Number.isNaN(startYear)) return NextResponse.json({ error: 'Invalid taxYear' }, { status: 400 });

  const from = new Date(startYear, 3, 6);
  const windowEnd = new Date(startYear + 1, 3, 30);
  const supabase = createServiceClient();

  // ── Discover the analysis owner ──
  // 1) analyses saved under this client; 2) analyses saved under another client
  //    where this client is a linked co-owner of a property.
  const analysisClientIds: string[] = [clientId];
  const { data: coOwnerRows } = await supabase
    .from('property_owners')
    .select('mtd_it_properties!inner(client_id)')
    .eq('owner_client_id', clientId);
  for (const r of (coOwnerRows ?? []) as unknown as { mtd_it_properties?: { client_id?: string } }[]) {
    const cid = r.mtd_it_properties?.client_id;
    if (cid && !analysisClientIds.includes(cid)) analysisClientIds.push(cid);
  }

  const { data: outputs, error } = await supabase
    .from('outputs')
    .select('id, client_id, result_data, created_at')
    .eq('firm_id', ctx.firmId).in('client_id', analysisClientIds).eq('feature', 'landlord_analysis')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = outputs ?? [];
  if (rows.length === 0) return NextResponse.json(NOT_FOUND);

  // Prefer the client's OWN analysis, then a co-owned one; within each, the run
  // whose period ends in the tax year, else the most recent.
  const inYear = (r: { result_data: unknown }) => { const end = parseFlexibleDate((r.result_data as LandlordRunData)?.dateTo); return !!(end && end >= from && end <= windowEnd); };
  const own = rows.filter(r => r.client_id === clientId);
  const co = rows.filter(r => r.client_id !== clientId);
  const chosen = own.find(inYear) ?? co.find(inYear) ?? own[0] ?? co[0];
  let note: string | undefined;
  if (!inYear(chosen)) {
    const rd = (chosen.result_data ?? {}) as LandlordRunData;
    note = `No saved run clearly matches ${taxYearLabel} — showing the latest (${rd.dateFrom || '?'} – ${rd.dateTo || '?'}). Confirm it’s the right year.`;
  }
  const analysisClientId = chosen.client_id as string;
  const rd = (chosen.result_data ?? {}) as LandlordRunData;

  // ── Property register + ownership split for the analysis owner ──
  const { data: props } = await supabase
    .from('mtd_it_properties')
    .select('id, address, property_type, ownership_pct, use_type, active')
    .eq('client_id', analysisClientId).eq('active', true);
  const propRows = (props ?? []) as { id: string; address: string; property_type: string; ownership_pct: number | null; use_type: string | null }[];
  let ownersByProp: Record<string, { id: string; property_id: string; owner_client_id: string | null; owner_name: string; share_pct: number }[]> = {};
  if (propRows.length) {
    const { data: owners } = await supabase
      .from('property_owners')
      .select('id, property_id, owner_client_id, owner_name, share_pct')
      .in('property_id', propRows.map(p => p.id));
    ownersByProp = {};
    for (const o of (owners ?? []) as { id: string; property_id: string; owner_client_id: string | null; owner_name: string; share_pct: number }[]) {
      (ownersByProp[o.property_id] ??= []).push({ id: o.id, property_id: o.property_id, owner_client_id: o.owner_client_id ?? null, owner_name: o.owner_name, share_pct: Number(o.share_pct) });
    }
  }
  const register: LandlordProperty[] = propRows.map(p => ({
    id: p.id, client_id: analysisClientId, address: p.address, ownership_pct: p.ownership_pct == null ? 100 : Number(p.ownership_pct),
    property_type: (p.property_type === 'foreign' ? 'foreign' : 'uk'), use_type: (p.use_type === 'residential' || p.use_type === 'commercial' ? p.use_type : null),
    active: true, owners: ownersByProp[p.id] ?? [],
  }));
  const hasSplit = register.some(p => (p.owners.length > 0) || p.ownership_pct < 100);

  const { data: clientRow } = await supabase.from('clients').select('name').eq('id', analysisClientId).maybeSingle();
  const analysisClientName = (clientRow?.name as string | undefined) ?? 'the portfolio';

  const income = (rd.income ?? []) as unknown as { PropertyAddress: string; Amount: number; Category: string; CapitalExpense?: boolean }[];
  const expenses = (rd.expenses ?? []) as unknown as { PropertyAddress: string; Amount: number; Category: string; CapitalExpense?: boolean }[];
  const adjustments = (rd.adjustments ?? []) as unknown as { propertyAddress: string; type: 'income' | 'expense'; amount: number; category: string; description: string }[];

  // ── Per-owner share when the portfolio is split; else the whole portfolio ──
  if (hasSplit && register.length) {
    const primaryClient = { id: analysisClientId, name: analysisClientName };
    const owned = personOwnedProperties(register, primaryClient, clientId);
    if (owned.length === 0) return NextResponse.json(NOT_FOUND);
    const ps = rd.personSettings?.[clientId];
    const comp = computeRentComputation(
      personShareRows(income, register, primaryClient, clientId),
      personShareRows(expenses, register, primaryClient, clientId),
      personShareAdjustments(adjustments, register, primaryClient, clientId),
      { entityType: (ps?.entityType === 'company' ? 'company' : 'individual') as LandlordEntityType, useAllowance: !!ps?.useAllowance, broughtForwardLoss: Number(ps?.broughtForwardLoss ?? 0) },
    );
    const pcts = [...new Set(owned.map(o => Math.round(o.pct)))];
    const ownerSharePct = pcts.length === 1 ? pcts[0] : null;
    return NextResponse.json({
      found: true, dateFrom: rd.dateFrom ?? '', dateTo: rd.dateTo ?? '',
      totalIncome: Math.round(comp.totalIncome), totalExpenses: Math.round(comp.totalExpenses),
      netProfit: Math.round(comp.netProfit), taxableProfit: Math.round(comp.taxableProfit),
      financeCosts: Math.round(comp.financeCosts), financeReducer: Math.round(comp.financeReducer),
      jointlyOwned: true, analysisClientId, analysisClientName, ownerSharePct, note,
    });
  }

  // Whole portfolio (sole owner / no property register).
  const comp = computeRentComputation(income, expenses, adjustments, {
    entityType: (rd.entityType === 'company' ? 'company' : 'individual') as LandlordEntityType,
    useAllowance: !!rd.useAllowance, broughtForwardLoss: Number(rd.broughtForwardLoss ?? 0),
  });
  return NextResponse.json({
    found: true, dateFrom: rd.dateFrom ?? '', dateTo: rd.dateTo ?? '',
    totalIncome: Math.round(comp.totalIncome), totalExpenses: Math.round(comp.totalExpenses),
    netProfit: Math.round(comp.netProfit), taxableProfit: Math.round(comp.taxableProfit),
    financeCosts: Math.round(comp.financeCosts), financeReducer: Math.round(comp.financeReducer),
    jointlyOwned: false, analysisClientId, analysisClientName, note,
  });
}
