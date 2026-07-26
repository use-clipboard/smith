import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { logAuditEvent } from '@/lib/accounts-studio/audit';
import type { AuditChange, AuditEntry } from '@/lib/accounts-studio/auditTypes';

export const dynamic = 'force-dynamic';

// GET /api/accounts-studio/audit — ADMIN-ONLY audit trail for the firm.
// Optional ?engagementId=… to scope to one set of accounts. RLS also enforces
// admin-read, so a non-admin gets an empty list even if this check were bypassed.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Audit history is available to administrators only.' }, { status: 403 });

  const engagementId = req.nextUrl.searchParams.get('engagementId');
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 300) || 300, 1000);

  const supabase = createClient();
  let query = supabase
    .from('accounts_studio_audit_log')
    .select('id, engagement_id, client_id, company_name, actor_id, actor_name, action, summary, changes, created_at')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (engagementId) query = query.eq('engagement_id', engagementId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Resolve actor display names (actor_name wins — it carries a client's typed
  // name; otherwise look up the user).
  const userIds = [...new Set(rows.map(r => r.actor_id as string | null).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data: users } = await supabase.from('users').select('id, full_name, email').in('id', userIds);
    for (const u of users ?? []) nameById.set(u.id as string, (u.full_name as string | null)?.trim() || (u.email as string | null) || 'Unknown');
  }

  const entries: AuditEntry[] = rows.map(r => ({
    id: r.id as string,
    engagementId: (r.engagement_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    companyName: (r.company_name as string | null) ?? null,
    actorName: (r.actor_name as string | null) || (r.actor_id ? nameById.get(r.actor_id as string) ?? 'Unknown' : 'System'),
    action: r.action as AuditEntry['action'],
    summary: (r.summary as string | null) ?? null,
    changes: (r.changes as AuditChange[] | null) ?? null,
    createdAt: r.created_at as string,
  }));

  return NextResponse.json({ entries });
}

// POST /api/accounts-studio/audit — record a client-side action (download /
// list export) that has no server round-trip of its own. Authenticated; the
// actor is always the current user.
const PostBody = z.object({
  engagementId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  companyName: z.string().max(300).nullable().optional(),
  action: z.enum(['downloaded', 'exported']),
  summary: z.string().max(300),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof PostBody>;
  try { body = PostBody.parse(await req.json()); }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }

  await logAuditEvent({
    firmId: ctx.firmId,
    engagementId: body.engagementId ?? null,
    clientId: body.clientId ?? null,
    companyName: body.companyName ?? null,
    actorId: ctx.userId,
    action: body.action,
    summary: body.summary,
  });

  return NextResponse.json({ ok: true });
}
