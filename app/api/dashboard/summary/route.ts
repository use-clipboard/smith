import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { currentTaxYear, getQuarterDates } from '@/lib/mtdIt/quarters';

/**
 * GET /api/dashboard/summary
 *
 * One round-trip that aggregates the DB-derived data the default dashboard
 * needs, so the page issues a single call instead of one-per-widget:
 *   • needsAttention — firm clients with overdue or imminent tasks
 *   • deadlines      — Companies House + MTD IT statutory deadlines, merged
 *
 * Personal task counts and notifications are NOT computed here — they're owned
 * app-wide by TasksCountProvider and NotificationsProvider (the latter pushed in
 * real time), shared with the sidebar/header, so we don't duplicate that work.
 *
 * External-integration data (email unread, calendar) stays on its own routes —
 * those hit Google per-user and don't belong in this DB aggregate.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof getUserContext>>>;

// ── Needs attention: firm clients ranked by task urgency ─────────────────────
async function needsAttention(supabase: SupabaseClient, ctx: Ctx) {
  const PAGE = 1000;
  const rows: { client_id: string; due_date: string }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from('tasks')
      .select('client_id, due_date')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .not('status', 'in', '("complete","draft")')
      .not('client_id', 'is', null)
      .not('due_date', 'is', null)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) return [];
    if (!data || data.length === 0) break;
    rows.push(...(data as { client_id: string; due_date: string }[]));
    if (data.length < PAGE) break;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today); weekOut.setDate(weekOut.getDate() + 7);

  const byClient = new Map<string, { overdue: number; dueSoon: number }>();
  for (const r of rows) {
    const due = new Date(r.due_date);
    const agg = byClient.get(r.client_id) ?? { overdue: 0, dueSoon: 0 };
    if (due < today) agg.overdue++;
    else if (due <= weekOut) agg.dueSoon++;
    byClient.set(r.client_id, agg);
  }

  const ranked = [...byClient.entries()]
    .filter(([, v]) => v.overdue > 0 || v.dueSoon > 0)
    .sort((a, b) => (b[1].overdue - a[1].overdue) || (b[1].dueSoon - a[1].dueSoon))
    .slice(0, 6);
  if (ranked.length === 0) return [];

  const ids = ranked.map(([id]) => id);
  const { data: clientRows } = await supabase.from('clients').select('id, name, client_ref').in('id', ids);
  const nameMap = new Map((clientRows ?? []).map(c => [c.id, c]));

  return ranked.map(([id, v]) => {
    const c = nameMap.get(id);
    return {
      clientId: id,
      name: c?.name ?? 'Unknown client',
      clientRef: c?.client_ref ?? null,
      status: v.overdue > 0 ? 'overdue' : 'due-soon',
      reason: v.overdue > 0
        ? `${v.overdue} overdue task${v.overdue === 1 ? '' : 's'}`
        : `${v.dueSoon} due this week`,
    };
  });
}

// ── Deadlines: Companies House (ch_cache) + MTD IT, merged & date-sorted ──────
interface CHCompany {
  companyName?: string;
  accountsNextDue?: string | null;
  csNextDue?: string | null;
  nearestOfficerIdvDue?: string | null;
  nearestPscIdvDue?: string | null;
}
const CH_LABEL: Record<string, string> = {
  Accounts: 'Accounts filing',
  Confirmation: 'Confirmation statement',
  'Officer IDV': 'Officer ID verification',
  'PSC IDV': 'PSC ID verification',
};

function daysUntilIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** MTD quarterly deadline = 7th of the 2nd month after the quarter end. */
function deadlineFor(taxYear: number, quarter: 1 | 2 | 3 | 4): Date {
  const range = getQuarterDates(taxYear, quarter, 'calendar');
  const [ey, em] = range.to.split('-').map(Number);
  return new Date(ey, (em - 1) + 2, 7);
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function deadlines(supabase: SupabaseClient, ctx: Ctx) {
  const out: { id: string; title: string; subtitle: string; dateISO: string; days: number }[] = [];

  // Companies House — from the firm's cached snapshot (service client: ch_cache
  // isn't user-scoped by RLS).
  try {
    const service = createServiceClient();
    const { data: cache } = await service
      .from('ch_cache').select('companies').eq('firm_id', ctx.firmId).single();
    const companies = (cache?.companies as CHCompany[] | null) ?? [];
    const HORIZON = 90;
    const push = (company: string, type: keyof typeof CH_LABEL, iso?: string | null) => {
      if (!iso) return;
      const days = daysUntilIso(iso);
      if (days < 0 || days <= HORIZON) {
        out.push({ id: `ch-${company}-${type}`, title: CH_LABEL[type], subtitle: company || 'Unknown company', dateISO: iso, days });
      }
    };
    for (const c of companies) {
      push(c.companyName ?? '', 'Accounts', c.accountsNextDue);
      push(c.companyName ?? '', 'Confirmation', c.csNextDue);
      push(c.companyName ?? '', 'Officer IDV', c.nearestOfficerIdvDue);
      push(c.companyName ?? '', 'PSC IDV', c.nearestPscIdvDue);
    }
  } catch { /* CH not set up — skip */ }

  // MTD IT — the active quarter's deadline, only while submissions outstanding.
  try {
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const cty = currentTaxYear(now);
    const candidates: { taxYear: number; quarter: 1 | 2 | 3 | 4; deadline: Date }[] = [];
    for (const ty of [cty - 1, cty, cty + 1]) {
      for (const q of [1, 2, 3, 4] as const) candidates.push({ taxYear: ty, quarter: q, deadline: deadlineFor(ty, q) });
    }
    const active = candidates.filter(c => c.deadline >= today).sort((a, b) => a.deadline.getTime() - b.deadline.getTime())[0]
      ?? candidates[candidates.length - 1];
    const range = getQuarterDates(active.taxYear, active.quarter, 'calendar');

    const { data } = await supabase
      .from('mtd_it_quarters')
      .select('status, clients!inner(firm_id)')
      .eq('clients.firm_id', ctx.firmId)
      .eq('tax_year', active.taxYear)
      .eq('quarter', active.quarter);
    const rows = (data ?? []) as unknown as { status: string }[];
    const submitted = rows.filter(r => r.status === 'submitted').length;
    const inReview = rows.filter(r => r.status === 'approved' || r.status === 'sent').length;
    const outstanding = rows.length - submitted - inReview;
    if (outstanding > 0) {
      const iso = fmt(active.deadline);
      out.push({
        id: 'mtd-deadline',
        title: 'MTD IT submission',
        subtitle: `${outstanding} outstanding · Q${active.quarter} ${range.monthsLabel}`,
        dateISO: iso,
        days: daysUntilIso(iso),
      });
    }
  } catch { /* MTD not set up — skip */ }

  out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return out;
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) {
    return NextResponse.json(
      { needsAttention: [], deadlines: [] },
      { status: 401 },
    );
  }
  const supabase = createClient();
  const [na, dl] = await Promise.all([
    needsAttention(supabase, ctx),
    deadlines(supabase, ctx),
  ]);
  return NextResponse.json({
    needsAttention: na,
    deadlines: dl,
  });
}
