import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { fetchUserEvents } from '@/lib/googleCalendar';

/**
 * GET /api/team/[id]/overview
 *
 * Everything the team-member profile's Overview tab needs, in one round-trip:
 *   • profile        — name, role, job title, contact, joined date, manager, department
 *   • taskSummary    — overdue / dueThisWeek / later / total for tasks assigned to them
 *   • tasksDueWeek   — their tasks due in the next 7 days
 *   • recentActivity — their recent AI outputs
 *   • clientsWorkedOn— clients they have live tasks on (total + open)
 *   • toolsUsed      — outputs by feature over the last 30 days
 *
 * Firm-scoped: the target must belong to the requester's firm, else 404. Uses
 * the service client (team data isn't all user-readable under RLS), with the
 * firm check enforced in code.
 */

type Ctx = NonNullable<Awaited<ReturnType<typeof getUserContext>>>;

interface LiveTask { id: string; title: string | null; due_date: string | null; status: string; client_id: string | null; }

// Tasks with at least one incomplete step assigned to the target user — mirrors
// the My Tasks / sidebar badge definition, but for an arbitrary user.
async function liveTasksFor(svc: SupabaseClient, ctx: Ctx, targetId: string): Promise<LiveTask[]> {
  const STEP_PAGE = 1000;
  const stepRows: { task_id: string; status: string }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await svc
      .from('task_steps')
      .select('task_id, status')
      .eq('assignee_id', targetId)
      .range(page * STEP_PAGE, (page + 1) * STEP_PAGE - 1);
    if (error) return [];
    if (!data || data.length === 0) break;
    stepRows.push(...data);
    if (data.length < STEP_PAGE) break;
  }
  const liveIds = [...new Set(stepRows.filter(r => r.status !== 'complete' && r.status !== 'skipped').map(r => r.task_id))];
  if (liveIds.length === 0) return [];

  const BATCH = 100;
  const tasks: LiveTask[] = [];
  for (let i = 0; i < liveIds.length; i += BATCH) {
    const { data } = await svc
      .from('tasks')
      .select('id, title, due_date, status, client_id')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .not('status', 'in', '("complete","draft")')
      .in('id', liveIds.slice(i, i + BATCH));
    if (data) tasks.push(...(data as LiveTask[]));
  }
  return tasks;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const targetId = params.id;
  const svc = createServiceClient();

  // Profile (firm-scoped — 404 if not a colleague). phone/office are recent
  // columns; if the migration hasn't run yet, fall back to a select without
  // them so the profile still loads.
  const FULL = 'id, full_name, email, avatar_url, role, job_title, phone, office, employment_start_date, department_id, manager_id, firm_id';
  const BASIC = 'id, full_name, email, avatar_url, role, job_title, employment_start_date, department_id, manager_id, firm_id';
  type UserRow = {
    id: string; full_name: string | null; email: string | null; avatar_url: string | null;
    role: string; job_title: string | null; phone?: string | null; office?: string | null;
    employment_start_date: string | null; department_id: string | null; manager_id: string | null; firm_id: string;
  };
  let user: UserRow | null = null;
  const full = await svc.from('users').select(FULL).eq('id', targetId).single();
  if (full.error && full.error.code === '42703') {
    const basic = await svc.from('users').select(BASIC).eq('id', targetId).single();
    user = basic.data as UserRow | null;
  } else {
    user = full.data as UserRow | null;
  }
  if (!user || user.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [manager, dept, deptCount, liveTasks, recentOutputs, monthOutputs, completedSteps, lastSeen] = await Promise.all([
    user.manager_id
      ? svc.from('users').select('id, full_name, job_title, avatar_url').eq('id', user.manager_id).single().then(r => r.data)
      : Promise.resolve(null),
    user.department_id
      ? svc.from('hr_departments').select('name').eq('id', user.department_id).single().then(r => r.data)
      : Promise.resolve(null),
    user.department_id
      ? svc.from('users').select('id', { count: 'exact', head: true }).eq('department_id', user.department_id).then(r => r.count ?? 0)
      : Promise.resolve(0),
    liveTasksFor(svc, ctx, targetId),
    svc.from('outputs').select('id, feature, created_at, clients(name, client_ref)')
      .eq('user_id', targetId).order('created_at', { ascending: false }).limit(8).then(r => r.data ?? []),
    svc.from('outputs').select('feature, client_id, created_at')
      .eq('user_id', targetId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .then(r => r.data ?? []),
    // Steps this user completed in the last 7 days → drives "Clients Worked On".
    svc.from('task_steps').select('task_id')
      .eq('assignee_id', targetId)
      .eq('status', 'complete')
      .gte('completed_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .then(r => r.data ?? []),
    // Last sign-in — fallback "last seen" when last_active_at isn't available.
    svc.auth.admin.getUserById(targetId).then(r => r.data.user?.last_sign_in_at ?? null).catch(() => null),
  ]);

  // Preferred "last seen": when the user was last active in the app (heartbeat),
  // not just when they last typed their password. Graceful if the column doesn't
  // exist yet (decoupled from the phone/office fallback above).
  let lastActive: string | null = null;
  const la = await svc.from('users').select('last_active_at').eq('id', targetId).single();
  if (!la.error) lastActive = ((la.data as { last_active_at?: string | null } | null)?.last_active_at) ?? null;

  // ── Task summary + due-this-week ────────────────────────────────────────────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today); weekOut.setDate(weekOut.getDate() + 7);
  let overdue = 0, dueThisWeek = 0, later = 0;
  const dueWeekList: { id: string; title: string; clientId: string | null; due: string }[] = [];
  for (const t of liveTasks) {
    if (!t.due_date) { later++; continue; }
    const due = new Date(t.due_date);
    if (due < today) { overdue++; }
    else if (due <= weekOut) { dueThisWeek++; dueWeekList.push({ id: t.id, title: t.title ?? 'Untitled task', clientId: t.client_id, due: t.due_date }); }
    else { later++; }
  }
  dueWeekList.sort((a, b) => a.due.localeCompare(b.due));

  // ── Clients worked on (steps this user completed in the last 7 days) ─────────
  // Map each completed step's task → its client, then tally completed steps and
  // distinct tasks per client. Only the firm's live (non-deleted) client tasks.
  const completedTaskIds = [...new Set((completedSteps as { task_id: string }[]).map(r => r.task_id))];
  const taskClient = new Map<string, string | null>();
  for (let i = 0; i < completedTaskIds.length; i += 100) {
    const { data } = await svc.from('tasks')
      .select('id, client_id')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .in('id', completedTaskIds.slice(i, i + 100));
    for (const t of data ?? []) taskClient.set(t.id, t.client_id);
  }
  const byClient = new Map<string, { completed: number; tasks: Set<string> }>();
  for (const r of completedSteps as { task_id: string }[]) {
    const clientId = taskClient.get(r.task_id);
    if (!clientId) continue; // task not in firm / deleted / no client
    const agg = byClient.get(clientId) ?? { completed: 0, tasks: new Set<string>() };
    agg.completed++;
    agg.tasks.add(r.task_id);
    byClient.set(clientId, agg);
  }
  const clientIds = [...byClient.keys()];
  const clientNames = new Map<string, { name: string; client_ref: string | null }>();
  if (clientIds.length > 0) {
    const { data: crows } = await svc.from('clients').select('id, name, client_ref').in('id', clientIds);
    for (const c of crows ?? []) clientNames.set(c.id, { name: c.name, client_ref: c.client_ref });
  }
  const clientsWorkedOn = clientIds
    .map(id => ({
      clientId: id,
      name: clientNames.get(id)?.name ?? 'Unknown client',
      clientRef: clientNames.get(id)?.client_ref ?? null,
      completed: byClient.get(id)!.completed,
      tasks: byClient.get(id)!.tasks.size,
    }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 8);

  // ── Tools used this month (outputs grouped by feature) ──────────────────────
  const toolCounts = new Map<string, number>();
  for (const o of monthOutputs as { feature: string }[]) {
    toolCounts.set(o.feature, (toolCounts.get(o.feature) ?? 0) + 1);
  }
  const toolsUsed = [...toolCounts.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // ── Upcoming events (next 7 days) from the target's own Google Calendar ──────
  // Read via the service role so it works for any colleague who has connected
  // their calendar, not just the viewer. Best-effort — empty if not connected.
  let upcomingEvents: { id: string; title: string; start: string; allDay: boolean }[] = [];
  let calendarConnected = false;
  try {
    const { data: ctok } = await svc
      .from('calendar_tokens')
      .select('google_access_token, google_refresh_token')
      .eq('user_id', targetId)
      .single();
    if (ctok?.google_refresh_token) {
      calendarConnected = true;
      const now = new Date();
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { events } = await fetchUserEvents(ctok.google_access_token ?? '', ctok.google_refresh_token, now.toISOString(), end.toISOString());
      upcomingEvents = events
        .slice(0, 6)
        .map(e => ({ id: e.id, title: e.title, start: e.start, allDay: !e.start.includes('T') }));
    }
  } catch { /* calendar fetch failed — leave empty */ }

  return NextResponse.json({
    profile: {
      id: user.id,
      name: user.full_name || user.email?.split('@')[0] || 'Team member',
      email: user.email,
      avatarUrl: user.avatar_url ?? null,
      role: user.role,
      jobTitle: user.job_title ?? null,
      phone: user.phone ?? null,
      office: user.office ?? null,
      joined: user.employment_start_date ?? null,
      lastSeen: lastActive ?? lastSeen,
      manager: manager ? { id: manager.id, name: manager.full_name, jobTitle: manager.job_title ?? null, avatarUrl: manager.avatar_url ?? null } : null,
      department: dept ? { name: dept.name, memberCount: deptCount } : null,
    },
    taskSummary: { overdue, dueThisWeek, later, total: liveTasks.length },
    tasksDueWeek: dueWeekList.slice(0, 8),
    recentActivity: recentOutputs,
    clientsWorkedOn,
    toolsUsed,
    upcomingEvents,
    calendarConnected,
    viewerIsAdmin: ctx.userRole === 'admin',
  });
}
