import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * GET /api/clients/[id]/overview
 *
 * Everything the redesigned client Overview tab needs, in one round-trip:
 *   • client       — header + Key Information fields (what we store; CH-derived
 *                    fields like company number / accounts dates are a follow-up)
 *   • accountManager — the staff member who owns the relationship
 *   • taskSummary / tasksDueWeek — the client's live tasks
 *   • recentActivity — recent AI outputs for the client
 *   • toolsActivity — outputs grouped by feature (this client)
 *   • linkedClients — client_links (role from link_type, ownership from notes)
 *
 * Firm-scoped (404 if the client isn't in the caller's firm). Service role.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof getUserContext>>>;

interface ClientRow {
  id: string; name: string; client_ref: string | null; business_type: string | null;
  status: string | null; contact_email: string | null; year_end: string | null;
  paye_reference: string | null; vat_scheme: string | null; created_at: string;
  firm_id: string; account_manager_id?: string | null; contact_number?: string | null;
}

async function liveClientTasks(svc: SupabaseClient, ctx: Ctx, clientId: string) {
  const { data } = await svc
    .from('tasks')
    .select('id, title, due_date, status')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .not('status', 'in', '("complete","draft")');
  return (data ?? []) as { id: string; title: string | null; due_date: string | null; status: string }[];
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const clientId = params.id;
  const svc = createServiceClient();

  // Client record — account_manager_id / contact_number are recent columns, so
  // fall back to a select without them if the migration hasn't run yet.
  const FULL = 'id, name, client_ref, business_type, status, contact_email, year_end, paye_reference, vat_scheme, created_at, firm_id, account_manager_id, contact_number';
  const BASIC = 'id, name, client_ref, business_type, status, contact_email, year_end, paye_reference, vat_scheme, created_at, firm_id';
  let client: ClientRow | null = null;
  const full = await svc.from('clients').select(FULL).eq('id', clientId).single();
  if (full.error && full.error.code === '42703') {
    const basic = await svc.from('clients').select(BASIC).eq('id', clientId).single();
    client = basic.data as ClientRow | null;
  } else {
    client = full.data as ClientRow | null;
  }
  if (!client || client.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Current calendar-month boundaries (for the Tools & Activity timeline list).
  const nowD = new Date();
  const monthStartStr = new Date(nowD.getFullYear(), nowD.getMonth(), 1).toISOString().slice(0, 10);
  const nextMonthStr = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 1).toISOString().slice(0, 10);

  const [manager, liveTasks, recentOutputs, allOutputs, links, monthNotes] = await Promise.all([
    client.account_manager_id
      ? svc.from('users').select('id, full_name, job_title, avatar_url').eq('id', client.account_manager_id).single().then(r => r.data)
      : Promise.resolve(null),
    liveClientTasks(svc, ctx, clientId),
    svc.from('outputs').select('id, feature, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(8).then(r => r.data ?? []),
    // All tools ever used for this client (no date window).
    svc.from('outputs').select('feature').eq('client_id', clientId).neq('feature', 'timeline_summary').then(r => r.data ?? []),
    svc.from('client_links').select('linked_client_id, link_type, notes').eq('client_id', clientId).then(r => r.data ?? []),
    // Timeline entries dated within the current calendar month.
    svc.from('client_timeline_notes').select('id, title, note_type, note_date')
      .eq('client_id', clientId)
      .gte('note_date', monthStartStr).lt('note_date', nextMonthStr)
      .order('note_date', { ascending: false }).limit(50).then(r => r.data ?? []),
  ]);

  // ── Task summary + due-this-week ────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today); weekOut.setDate(weekOut.getDate() + 7);
  let overdue = 0, dueThisWeek = 0, later = 0;
  const dueWeekList: { id: string; title: string; due: string }[] = [];
  for (const t of liveTasks) {
    if (!t.due_date) { later++; continue; }
    const due = new Date(t.due_date);
    if (due < today) overdue++;
    else if (due <= weekOut) { dueThisWeek++; dueWeekList.push({ id: t.id, title: t.title ?? 'Untitled task', due: t.due_date }); }
    else later++;
  }
  dueWeekList.sort((a, b) => a.due.localeCompare(b.due));

  // ── Tools used (all-time, by feature) ───────────────────────────────────────
  const toolCounts = new Map<string, number>();
  for (const o of allOutputs as { feature: string }[]) toolCounts.set(o.feature, (toolCounts.get(o.feature) ?? 0) + 1);
  const toolsActivity = [...toolCounts.entries()].map(([feature, count]) => ({ feature, count })).sort((a, b) => b.count - a.count);

  // ── Timeline entries this calendar month ────────────────────────────────────
  const timelineThisMonth = (monthNotes as { id: string; title: string | null; note_type: string | null; note_date: string }[])
    .map(n => ({ id: n.id, title: n.title ?? 'Untitled', noteType: n.note_type ?? 'other', noteDate: n.note_date }));

  // ── Linked clients (names + role from link_type + ownership from notes) ──────
  const linkRows = links as { linked_client_id: string; link_type: string | null; notes: string | null }[];
  const linkedIds = linkRows.map(l => l.linked_client_id);
  const linkedNames = new Map<string, { name: string; client_ref: string | null }>();
  if (linkedIds.length > 0) {
    const { data } = await svc.from('clients').select('id, name, client_ref').in('id', linkedIds);
    for (const c of data ?? []) linkedNames.set(c.id, { name: c.name, client_ref: c.client_ref });
  }
  const linkedClients = linkRows.map(l => ({
    clientId: l.linked_client_id,
    name: linkedNames.get(l.linked_client_id)?.name ?? 'Unknown client',
    clientRef: linkedNames.get(l.linked_client_id)?.client_ref ?? null,
    role: l.link_type ?? 'Associated',
    detail: l.notes ?? null,
  }));

  return NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      clientRef: client.client_ref,
      businessType: client.business_type,
      status: client.status ?? 'active',
      contactEmail: client.contact_email,
      contactNumber: client.contact_number ?? null,
      relationshipSince: client.created_at,
      keyInfo: {
        yearEnd: client.year_end ?? null,
        payeReference: client.paye_reference ?? null,
        vatScheme: client.vat_scheme ?? null,
      },
      manager: manager ? { id: manager.id, name: manager.full_name, jobTitle: manager.job_title ?? null, avatarUrl: manager.avatar_url ?? null } : null,
    },
    taskSummary: { overdue, dueThisWeek, later, total: liveTasks.length },
    tasksDueWeek: dueWeekList.slice(0, 8),
    recentActivity: recentOutputs,
    toolsActivity,
    timelineThisMonth,
    linkedClients,
  });
}
