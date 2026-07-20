import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { computeCampaignOutcomes } from '@/lib/campaigns/outcomes';
import type { CHCompanyData } from '@/types/ch';

const OUTCOME_WINDOW_DAYS = 30;

export const maxDuration = 30;

interface Suggestion {
  key: string;
  title: string;
  detail: string;
  count: number;
  action: string;   // suggested campaign name
}

function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return Math.floor((dt.getTime() - Date.now()) / 86_400_000);
}

// GET /api/campaigns/overview — KPIs, recent/scheduled campaigns and a live
// "Communications Briefing" of suggested campaigns drawn from practice data.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();

  const [{ data: campaignsRaw }, { data: recipients }] = await Promise.all([
    supabase.from('campaigns')
      .select('id, name, subject, status, audience_id, scheduled_at, sent_at, stats, settings, created_at')
      .eq('firm_id', ctx.firmId).order('created_at', { ascending: false }),
    supabase.from('campaign_recipients')
      .select('client_id, status, sent_at, opened_at, first_clicked_at, bounced_at, unsubscribed_at, replied_at')
      .eq('firm_id', ctx.firmId),
  ]);

  // Hide internal backing campaigns used by journey automations.
  const campaigns = (campaignsRaw ?? []).filter(c => !(c.settings as Record<string, unknown> | null)?.journey_automation_id);

  const rcpts = recipients ?? [];
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const sentRcpts = rcpts.filter(r => r.sent_at);
  const sentThisMonth = sentRcpts.filter(r => new Date(r.sent_at as string) >= monthStart).length;
  const sent = sentRcpts.length;
  const bounced = rcpts.filter(r => r.bounced_at).length;
  const opened = rcpts.filter(r => r.opened_at).length;
  const clicked = rcpts.filter(r => r.first_clicked_at).length;
  const replied = rcpts.filter(r => r.replied_at).length;
  const unsubscribed = rcpts.filter(r => r.unsubscribed_at).length;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  const kpis = {
    sentThisMonth,
    deliveryRate: pct(sent - bounced, sent),
    openRate: pct(opened, sent),
    clickRate: pct(clicked, sent),
    replies: replied,
    bounceRate: pct(bounced, sent),
    unsubscribes: unsubscribed,
    scheduled: (campaigns ?? []).filter(c => c.status === 'scheduled').length,
    awaitingApproval: (campaigns ?? []).filter(c => c.status === 'awaiting_review').length,
    activeAutomations: 0, // Automations arrive in a later phase.
  };

  // ── Communications Briefing (heuristic, from live data) ──────────────────────
  const suggestions: Suggestion[] = [];

  // Accounts / confirmation statements due soon (Companies House cache).
  try {
    const { data: chRow } = await supabase.from('ch_cache').select('companies').eq('firm_id', ctx.firmId).maybeSingle();
    const companies = (chRow?.companies as CHCompanyData[] | null) ?? [];
    const accountsDue = companies.filter(c => { const d = daysUntil(c.accountsNextDue); return d !== null && d >= 0 && d <= 60; }).length;
    const csDue = companies.filter(c => { const d = daysUntil(c.csNextDue); return d !== null && d >= 0 && d <= 30; }).length;
    if (accountsDue > 0) suggestions.push({ key: 'accounts_due', title: `${accountsDue} companies have year ends within 60 days`, detail: 'Send them a records checklist to get accounts started on time.', count: accountsDue, action: 'Year-end records checklist' });
    if (csDue > 0) suggestions.push({ key: 'cs_due', title: `${csDue} confirmation statements due within 30 days`, detail: 'Confirm details and remind clients before the filing deadline.', count: csDue, action: 'Confirmation statement reminder' });
  } catch { /* no CH module */ }

  // Outstanding MTD IT quarters.
  try {
    const { data: clientRows } = await supabase.from('clients').select('id').eq('firm_id', ctx.firmId);
    const ids = (clientRows ?? []).map(c => c.id as string);
    if (ids.length) {
      const outstanding = new Set<string>();
      for (let i = 0; i < ids.length; i += 300) {
        const { data } = await supabase.from('mtd_it_quarters').select('client_id, status').in('client_id', ids.slice(i, i + 300));
        for (const q of (data ?? [])) {
          const st = (q.status as string) ?? '';
          if (st !== 'submitted' && st !== 'approved' && q.client_id) outstanding.add(q.client_id as string);
        }
      }
      if (outstanding.size > 0) suggestions.push({ key: 'mtd_outstanding', title: `${outstanding.size} clients have an outstanding MTD IT quarter`, detail: 'Nudge them to send records for the current quarter.', count: outstanding.size, action: 'MTD IT quarter reminder' });
    }
  } catch { /* no MTD module */ }

  // Overdue invoices.
  try {
    const { data: inv } = await supabase.from('invoices').select('client_id, status, total_pence, amount_paid_pence, credit_pence, due_date').eq('firm_id', ctx.firmId);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueClients = new Set<string>();
    for (const i of (inv ?? [])) {
      const st = (i.status as string) ?? '';
      if (['draft', 'cancelled', 'paid', 'bad_debt'].includes(st)) continue;
      const outstanding = ((i.total_pence as number) ?? 0) - ((i.amount_paid_pence as number) ?? 0) - ((i.credit_pence as number) ?? 0);
      if (outstanding > 0 && i.due_date && new Date(i.due_date as string) < today && i.client_id) overdueClients.add(i.client_id as string);
    }
    if (overdueClients.size > 0) suggestions.push({ key: 'overdue_invoices', title: `${overdueClients.size} clients have an overdue invoice`, detail: 'A friendly payment reminder can speed things up.', count: overdueClients.size, action: 'Payment reminder' });
  } catch { /* no billing module */ }

  // ── Outcomes roll-up: what clients emailed recently went on to do ───────────
  // Approximate but honest: everyone emailed in the window, matched against
  // practice activity over the same window.
  const windowStart = new Date(Date.now() - OUTCOME_WINDOW_DAYS * 86_400_000);
  const recentlyEmailed = rcpts.filter(r => r.sent_at && new Date(r.sent_at as string) >= windowStart);
  const emailedClientIds = Array.from(new Set(
    recentlyEmailed.map(r => r.client_id as string | null).filter((v): v is string => !!v),
  ));
  const outcomes = {
    ...(await computeCampaignOutcomes(supabase, emailedClientIds, windowStart.toISOString(), OUTCOME_WINDOW_DAYS)),
    clientsEmailed: emailedClientIds.length,
  };

  const recent = (campaigns ?? []).filter(c => c.sent_at).slice(0, 6);
  const upcoming = (campaigns ?? []).filter(c => c.status === 'scheduled')
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))).slice(0, 6);

  return NextResponse.json({ kpis, suggestions, outcomes, recent, upcoming, totalCampaigns: (campaigns ?? []).length });
}
