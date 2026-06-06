import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── GET /api/mtd-it/activity ─────────────────────────────────────────────────
// Firm-wide MTD-IT activity feed: status changes (mtd_it_activity), HMRC
// submissions/amendments (mtd_it_submissions) and approval events
// (mtd_it_quarter_approvals), merged into one reverse-chronological timeline.
export interface ActivityEvent {
  at: string;
  kind: string;
  label: string;
  client: string | null;
  clientRef: string | null;
  actor: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  'self-employment': 'Self-employment', 'uk-property': 'UK property', 'foreign-property': 'Foreign property',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Saved as draft', complete: 'Marked complete', sent: 'Sent to client',
  approved: 'Marked approved', submitted: 'Marked submitted',
};
function uname(u: unknown): string | null {
  const r = Array.isArray(u) ? u[0] : u as { full_name?: string; email?: string } | null;
  return r ? (r.full_name ?? r.email ?? null) : null;
}
function cobj(c: unknown): { name?: string; client_ref?: string } | null {
  return (Array.isArray(c) ? c[0] : c) as { name?: string; client_ref?: string } | null;
}
function cname(c: unknown): string | null { return cobj(c)?.name ?? null; }
function cref(c: unknown): string | null { return cobj(c)?.client_ref ?? null; }

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const svc = createServiceClient();
  const events: ActivityEvent[] = [];

  // 1) Status changes
  try {
    const { data } = await svc.from('mtd_it_activity')
      .select('created_at, detail, quarter, clients(name, client_ref), user:users!mtd_it_activity_user_id_fkey(full_name, email)')
      .eq('firm_id', ctx.firmId).order('created_at', { ascending: false }).limit(150);
    for (const a of data ?? []) {
      events.push({
        at: a.created_at as string, kind: 'status_change',
        label: `${STATUS_LABEL[a.detail as string] ?? a.detail}${a.quarter ? ` · Q${a.quarter}` : ''}`,
        client: cname(a.clients), clientRef: cref(a.clients), actor: uname(a.user),
      });
    }
  } catch { /* non-critical */ }

  // 2) Submissions / amendments (earliest per quarter+business = submitted, rest = amended)
  try {
    const { data } = await svc.from('mtd_it_submissions')
      .select('quarter_id, business_id, type_of_business, period_to, hmrc_status, submitted_at, clients!inner(name, client_ref, firm_id), submitter:users!mtd_it_submissions_submitted_by_fkey(full_name, email)')
      .eq('clients.firm_id', ctx.firmId).order('submitted_at', { ascending: true }).limit(300);
    const seen = new Set<string>();
    for (const s of data ?? []) {
      const key = `${s.quarter_id}|${s.business_id}`;
      const amended = seen.has(key); seen.add(key);
      const ok = typeof s.hmrc_status === 'number' && s.hmrc_status >= 200 && s.hmrc_status < 300;
      const type = TYPE_LABEL[s.type_of_business as string] ?? s.type_of_business;
      events.push({
        at: s.submitted_at as string,
        kind: ok ? (amended ? 'amended' : 'submitted') : 'submit_failed',
        label: ok
          ? `${amended ? 'Amended' : 'Filed'} ${type} update to HMRC — period to ${String(s.period_to).split('-').reverse().join('/')}`
          : `${type} submission to HMRC failed`,
        client: cname(s.clients), clientRef: cref(s.clients), actor: uname(s.submitter),
      });
    }
  } catch { /* non-critical */ }

  // 3) Approval lifecycle
  try {
    const { data } = await svc.from('mtd_it_quarter_approvals')
      .select('sent_at, approved_at, changes_requested_at, recipient_email, sender:users!mtd_it_quarter_approvals_sent_by_fkey(full_name, email), mtd_it_quarters!inner(quarter, clients!inner(name, client_ref, firm_id))')
      .eq('mtd_it_quarters.clients.firm_id', ctx.firmId).order('sent_at', { ascending: false }).limit(200);
    for (const a of data ?? []) {
      const q = (Array.isArray(a.mtd_it_quarters) ? a.mtd_it_quarters[0] : a.mtd_it_quarters) as { quarter?: number; clients?: unknown } | null;
      const client = cname(q?.clients); const clientRef = cref(q?.clients);
      const qlabel = q?.quarter ? ` · Q${q.quarter}` : '';
      if (a.sent_at) events.push({ at: a.sent_at as string, kind: 'sent_for_approval', label: `Sent for client approval${qlabel}${a.recipient_email ? ` (${a.recipient_email})` : ''}`, client, clientRef, actor: uname(a.sender) });
      if (a.approved_at) events.push({ at: a.approved_at as string, kind: 'client_approved', label: `Client approved${qlabel}`, client, clientRef, actor: 'Client' });
      if (a.changes_requested_at) events.push({ at: a.changes_requested_at as string, kind: 'client_changes_requested', label: `Client requested changes${qlabel}`, client, clientRef, actor: 'Client' });
    }
  } catch { /* non-critical */ }

  events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return NextResponse.json({ events: events.slice(0, 200) });
}
