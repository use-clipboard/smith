import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  frequency: z.string().max(30).nullable().optional(),
  price_pence: z.number().int().min(0).nullable().optional(),
  status: z.enum(['active', 'paused', 'ended']).optional(),
  next_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  linked_recurring_invoice_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
  /** Full desired set of linked task ids (reconciled: links these, unlinks the rest). */
  task_ids: z.array(z.string().uuid()).optional(),
  /** When ending the service, also soft-delete its linked tasks (the cross-warning "yes"). */
  also_delete_tasks: z.boolean().optional(),
});

// PATCH /api/clients/[id]/services/[serviceId] — edit / re-link / change status (admin only).
export async function PATCH(req: NextRequest, { params }: { params: { id: string; serviceId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { data: existing } = await service
    .from('client_services').select('id, client_id')
    .eq('id', params.serviceId).eq('firm_id', ctx.firmId).eq('client_id', params.id).single();
  if (!existing) return NextResponse.json({ error: 'Service not found' }, { status: 404 });

  const { task_ids, also_delete_tasks, ...fields } = parsed.data;

  if (Object.keys(fields).length > 0) {
    const { error } = await service
      .from('client_services')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', params.serviceId).eq('firm_id', ctx.firmId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Reconcile the linked-task set when provided.
  if (task_ids) {
    const desired = new Set(task_ids);
    // Link the desired tasks (scoped to firm + client).
    if (task_ids.length > 0) {
      await service.from('tasks').update({ service_id: params.serviceId })
        .in('id', task_ids).eq('firm_id', ctx.firmId).eq('client_id', params.id);
    }
    // Unlink any task currently pointing at this service but no longer wanted.
    const { data: current } = await service.from('tasks').select('id').eq('service_id', params.serviceId);
    const toUnlink = (current ?? []).map(t => t.id as string).filter(id => !desired.has(id));
    if (toUnlink.length > 0) {
      await service.from('tasks').update({ service_id: null }).in('id', toUnlink);
    }
  }

  // Ending + "delete the linked tasks too" → soft-delete them (mirrors the task tool).
  if (also_delete_tasks && fields.status === 'ended') {
    await service.from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.userId })
      .eq('service_id', params.serviceId).is('deleted_at', null);
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/clients/[id]/services/[serviceId] — remove the service (admin only).
// tasks.service_id is cleared automatically (ON DELETE SET NULL); the UI offers a
// separate "delete linked tasks too" choice via PATCH before deleting.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; serviceId: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const service = createServiceClient();
  const { error } = await service
    .from('client_services')
    .delete()
    .eq('id', params.serviceId).eq('firm_id', ctx.firmId).eq('client_id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
