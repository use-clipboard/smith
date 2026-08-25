import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { deriveHealth, type ClientService, type LinkedTaskRef, type ServiceStatus, type ServiceFrequency } from '@/lib/services/serviceTypes';

const DONE_STATUSES = new Set(['complete', 'cancelled']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function baseMap(r: any): Omit<ClientService, 'tasks' | 'nextDue' | 'health'> {
  return {
    id: r.id,
    clientId: r.client_id,
    catalogueId: r.catalogue_id ?? null,
    name: r.name,
    description: r.description ?? null,
    icon: r.icon ?? null,
    frequency: (r.frequency ?? null) as ServiceFrequency | null,
    pricePence: r.price_pence ?? null,
    status: (r.status ?? 'active') as ServiceStatus,
    manualNextDue: r.next_due ?? null,
    notes: r.notes ?? null,
    linkedRecurringInvoiceId: r.linked_recurring_invoice_id ?? null,
    sortOrder: r.sort_order ?? 0,
  };
}

// GET /api/clients/[id]/services → the client's services with linked tasks,
// derived next-due (earliest open linked task, else the manual date) and health.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  // Confirm the client is in this firm.
  const { data: client } = await supabase
    .from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { data: rows, error } = await supabase
    .from('client_services')
    .select('*')
    .eq('client_id', params.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ services: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const base = (rows ?? []).map(baseMap);

  // Linked, non-deleted tasks for these services, in one query.
  const ids = base.map(s => s.id);
  const tasksByService = new Map<string, LinkedTaskRef[]>();
  if (ids.length > 0) {
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, due_date, service_id')
      .in('service_id', ids)
      .is('deleted_at', null);
    for (const t of tasks ?? []) {
      const sid = t.service_id as string;
      const list = tasksByService.get(sid) ?? [];
      list.push({ id: t.id, title: t.title, status: t.status, dueDate: t.due_date ?? null });
      tasksByService.set(sid, list);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const services: ClientService[] = base.map(s => {
    const tasks = tasksByService.get(s.id) ?? [];
    // Effective next-due = earliest open linked task due date, else manual.
    const openDues = tasks
      .filter(t => !DONE_STATUSES.has(t.status) && t.dueDate)
      .map(t => t.dueDate as string)
      .sort();
    const nextDue = openDues[0] ?? s.manualNextDue;
    return { ...s, tasks, nextDue, health: deriveHealth(s.status, nextDue, today) };
  });

  return NextResponse.json({ services });
}

const CreateSchema = z.object({
  catalogue_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  frequency: z.string().max(30).nullable().optional(),
  price_pence: z.number().int().min(0).nullable().optional(),
  status: z.enum(['active', 'paused', 'ended']).optional(),
  next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  task_ids: z.array(z.string().uuid()).optional(), // link these existing tasks
});

// POST /api/clients/[id]/services → add a service to the client (admin only).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  // Firm ownership of the client.
  const { data: client } = await service
    .from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { task_ids, ...fields } = parsed.data;
  const { data: last } = await service
    .from('client_services').select('sort_order')
    .eq('client_id', params.id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const sortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await service
    .from('client_services')
    .insert({ firm_id: ctx.firmId, client_id: params.id, created_by: ctx.userId, sort_order: sortOrder, ...fields })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Link any chosen tasks (scoped to this client + firm for safety).
  if (task_ids && task_ids.length > 0) {
    await service.from('tasks').update({ service_id: data.id })
      .in('id', task_ids).eq('firm_id', ctx.firmId).eq('client_id', params.id);
  }

  return NextResponse.json({ service: baseMap(data) }, { status: 201 });
}
