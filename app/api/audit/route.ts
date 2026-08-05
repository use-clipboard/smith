import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { logAudit } from '@/lib/audit/log';
import type { AuditChange, AuditEntry } from '@/lib/audit/types';

export const dynamic = 'force-dynamic';

// GET /api/audit?tool=…[&entityId=…] — ADMIN-ONLY audit trail for one tool.
// RLS also enforces admin-read, so a non-admin gets an empty list regardless.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Audit history is available to administrators only.' }, { status: 403 });

  const tool = req.nextUrl.searchParams.get('tool');
  const entityId = req.nextUrl.searchParams.get('entityId');
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 300) || 300, 1000);

  const supabase = createClient();
  let query = supabase
    .from('audit_log')
    .select('id, tool, entity_id, entity_label, client_id, actor_id, actor_name, action, summary, changes, created_at')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (tool) query = query.eq('tool', tool);
  if (entityId) query = query.eq('entity_id', entityId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];

  // Resolve actor display names (actor_name wins — it's a client's typed name).
  const userIds = [...new Set(rows.map(r => r.actor_id as string | null).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id, full_name, email').in('id', userIds);
    for (const u of users ?? []) nameById.set(u.id as string, (u.full_name as string | null)?.trim() || (u.email as string | null) || 'Unknown');
  }

  const entries: AuditEntry[] = rows.map(r => ({
    id: r.id as string,
    tool: r.tool as string,
    entityId: (r.entity_id as string | null) ?? null,
    entityLabel: (r.entity_label as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) || (r.actor_id ? nameById.get(r.actor_id as string) ?? 'Unknown' : 'System'),
    action: r.action as string,
    summary: (r.summary as string | null) ?? null,
    changes: (r.changes as AuditChange[] | null) ?? null,
    createdAt: r.created_at as string,
  }));

  return NextResponse.json({ entries });
}

// POST /api/audit — record a client-side action (a list export / download) that
// has no server round-trip of its own. Authenticated; actor is the current user.
const PostBody = z.object({
  tool: z.string().min(1).max(64),
  action: z.enum(['exported', 'downloaded']),
  entityId: z.string().uuid().nullable().optional(),
  entityLabel: z.string().max(300).nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  summary: z.string().max(300).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PostBody>;
  try { body = PostBody.parse(await req.json()); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  await logAudit({
    firmId: ctx.firmId,
    tool: body.tool,
    action: body.action,
    entityId: body.entityId ?? null,
    entityLabel: body.entityLabel ?? null,
    clientId: body.clientId ?? null,
    actorId: ctx.userId,
    summary: body.summary ?? null,
  });

  return NextResponse.json({ ok: true });
}
