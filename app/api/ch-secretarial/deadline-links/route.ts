import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Look up the current deadline for a company + type from the firm's
// ch_cache row. Used at link-creation time so a fresh task gets a sensible
// initial due_date instead of sitting blank until the next refresh.
async function deadlineFromCache(
  service: ReturnType<typeof createServiceClient>,
  firmId: string,
  companyNumber: string,
  deadlineType: 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due',
): Promise<string | null> {
  const norm = companyNumber.trim().toUpperCase().padStart(8, '0');
  const { data: cache } = await service
    .from('ch_cache')
    .select('companies')
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!cache?.companies) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companies = cache.companies as Array<any>;
  const co = companies.find(c => {
    if (typeof c?.companyNumber !== 'string') return false;
    return c.companyNumber.trim().toUpperCase().padStart(8, '0') === norm;
  });
  if (!co) return null;
  switch (deadlineType) {
    case 'accounts_due':     return (co.accountsNextDue       as string | null) ?? null;
    case 'cs_due':           return (co.csNextDue             as string | null) ?? null;
    case 'officer_idv_due':  return (co.nearestOfficerIdvDue  as string | null) ?? null;
    case 'psc_idv_due':      return (co.nearestPscIdvDue      as string | null) ?? null;
  }
}

function applyOffsetIso(iso: string, offset: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ─── /api/ch-secretarial/deadline-links ───────────────────────────────────
// Manage the link rows that tie a task to a live Companies House deadline
// so the task's due date follows the deadline through routine slides + the
// annual renewal cycle. The actual sync engine lives in lib/chDeadlineSync.ts
// and runs after every ch_cache refresh.

const DEADLINE_TYPES = ['accounts_due', 'cs_due', 'officer_idv_due', 'psc_idv_due'] as const;

const CreateSchema = z.object({
  client_id:     z.string().uuid(),
  deadline_type: z.enum(DEADLINE_TYPES),
  offset_days:   z.number().int().min(-365).max(365).default(0),
  // Either link an existing task...
  task_id:       z.string().uuid().optional(),
  // ...or create a fresh one. Both shapes route through the same insert at
  // the end — `new_task` just spawns the task first.
  new_task:      z.object({
    title:        z.string().min(1).max(300),
    description:  z.string().max(5000).optional().nullable(),
    initial_due:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  }).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body   = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { client_id, deadline_type, offset_days, task_id, new_task } = parsed.data;
  if (!task_id && !new_task) {
    return NextResponse.json({ error: 'Provide either task_id or new_task' }, { status: 400 });
  }

  const supabase = createClient();
  const service  = createServiceClient();

  // Confirm the client is in this firm, AND has a CH number — links are
  // only meaningful when there's a live Companies House record to follow.
  const { data: client } = await supabase
    .from('clients')
    .select('id, firm_id, companies_house_id')
    .eq('id', client_id)
    .maybeSingle();
  if (!client || (client as { firm_id: string }).firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  const clientChNumber = (client as { companies_house_id: string | null }).companies_house_id;
  if (!clientChNumber) {
    return NextResponse.json(
      { error: 'This client has no Companies House number — set one before linking to a deadline.' },
      { status: 400 },
    );
  }

  // Look up the current CH deadline for this client + type so a fresh
  // task can be born with the right due date instead of waiting for the
  // next sync tick. Falls back to whatever the caller provided as
  // `new_task.initial_due` (or null) when the cache doesn't know yet.
  const cachedDeadline = await deadlineFromCache(service, ctx.firmId, clientChNumber, deadline_type);
  const computedInitialDue = cachedDeadline
    ? applyOffsetIso(cachedDeadline, offset_days)
    : (new_task?.initial_due ?? null);

  // Resolve / create the task.
  let resolvedTaskId = task_id ?? null;
  if (!resolvedTaskId && new_task) {
    const { data: task, error: taskErr } = await service
      .from('tasks')
      .insert({
        firm_id:     ctx.firmId,
        client_id,
        created_by:  ctx.userId,
        title:       new_task.title,
        description: new_task.description ?? null,
        status:      'not_started',
        due_date:    computedInitialDue,
      })
      .select('id')
      .single();
    if (taskErr || !task) {
      console.error('deadline-links create task', taskErr);
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
    }
    resolvedTaskId = task.id;
  } else if (resolvedTaskId && cachedDeadline) {
    // Linking an existing task to a deadline — push the cached deadline
    // onto its due_date right away so the user sees the resolved date,
    // not the placeholder the task was created with.
    await service
      .from('tasks')
      .update({ due_date: computedInitialDue, updated_at: new Date().toISOString() })
      .eq('id', resolvedTaskId);
  }
  if (!resolvedTaskId) {
    return NextResponse.json({ error: 'Task could not be created' }, { status: 500 });
  }

  // Insert the link row. We snapshot the client's current CH number so the
  // sync engine can later detect "client's CH number was changed" → break
  // the link rather than silently following a different company's deadlines.
  // When the cache already has a deadline value, we seed last_synced_deadline
  // with it so the next sync doesn't fire spuriously (it sees no change and
  // skips). When the cache doesn't know yet, last_synced_deadline stays null
  // and the first sync after a refresh populates it.
  const { data: link, error: linkErr } = await service
    .from('ch_deadline_task_links')
    .insert({
      firm_id:               ctx.firmId,
      client_id,
      task_id:               resolvedTaskId,
      deadline_type,
      offset_days,
      linked_company_number: clientChNumber,
      status:                'active',
      last_synced_deadline:  cachedDeadline,
      last_synced_at:        cachedDeadline ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (linkErr || !link) {
    console.error('deadline-links insert', linkErr);
    return NextResponse.json({ error: 'Failed to create link' }, { status: 500 });
  }

  return NextResponse.json({ link_id: link.id, task_id: resolvedTaskId });
}

// GET ?client_id=…  → list links for a single client (drives the CH-row badge)
// GET ?task_id=…    → list links attached to a single task
// GET (no params)   → list every link for the firm (one fetch for the
//                     tasks page to surface link icons on every card)
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url      = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const taskId   = url.searchParams.get('task_id');

  const supabase = createClient();
  // PostgREST applies a server-side max-rows cap (typically 1000) that
  // silently truncates unbounded selects. To return every link for the
  // firm we paginate explicitly with .range() — page size 1000, loop
  // until a short page comes back. Left joins on clients/tasks so RLS or
  // transient missing rows don't drop link entries.
  const PAGE = 1000;
  type Row = { id: string; client_id: string; task_id: string; deadline_type: string; offset_days: number; last_synced_deadline: string | null; status: string; consecutive_failures: number; last_synced_at: string | null; last_error: string | null; linked_company_number: string | null; clients: { name: string | null; client_ref: string | null } | null; tasks: { id: string; title: string; status: string; due_date: string | null } | null };
  const all: Row[] = [];
  let from = 0;
  let pages = 0;
  for (; pages < 50; pages++) {
    let q = supabase
      .from('ch_deadline_task_links')
      .select('id, client_id, task_id, deadline_type, offset_days, last_synced_deadline, status, consecutive_failures, last_synced_at, last_error, linked_company_number, clients(name, client_ref), tasks(id, title, status, due_date)')
      .eq('firm_id', ctx.firmId);
    if (clientId) q = q.eq('client_id', clientId);
    if (taskId)   q = q.eq('task_id', taskId);
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) {
      console.error('[GET /api/ch-secretarial/deadline-links]', error);
      return NextResponse.json({ error: 'Failed to load links', links: [] }, { status: 500 });
    }
    const rows = (data ?? []) as unknown as Row[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return NextResponse.json({ links: all });
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const id  = url.searchParams.get('id');
  const parsed = DeleteSchema.safeParse({ id });
  if (!parsed.success) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service
    .from('ch_deadline_task_links')
    .delete()
    .eq('id', parsed.data.id)
    .eq('firm_id', ctx.firmId);
  if (error) {
    console.error('deadline-links delete', error);
    return NextResponse.json({ error: 'Failed to remove link' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
