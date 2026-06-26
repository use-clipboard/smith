import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';

// ── /api/account/firm-deletion-request ───────────────────────────────────────
// Admin-only request to delete the ENTIRE firm account. Recorded and processed
// by SMITH/operator after verification — NOT an instant in-app wipe.
//
//   GET    → the firm's current pending request (or null)
//   POST   → raise a request { confirm_name, reason? } (confirm_name must match the firm name)
//   DELETE → cancel the firm's pending request

const Body = z.object({
  confirm_name: z.string(),
  reason: z.string().max(2000).optional(),
});

const norm = (s: string) => s.trim().toLowerCase();

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { data } = await service
    .from('firm_deletion_requests')
    .select('id, status, requested_at, requested_by_name')
    .eq('firm_id', ctx.firmId)
    .eq('status', 'pending')
    .maybeSingle();

  return NextResponse.json({ request: data ?? null });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only an admin can request firm deletion' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }

  const service = createServiceClient();

  const { data: firm } = await service
    .from('firms').select('name').eq('id', ctx.firmId).single();
  const firmName = (firm?.name as string | null) ?? '';

  // Confirmation must match the firm name exactly (case-insensitive).
  if (!firmName || norm(body.confirm_name) !== norm(firmName)) {
    return NextResponse.json({ error: 'The firm name you typed does not match.' }, { status: 400 });
  }

  // Already pending?
  const { data: existing } = await service
    .from('firm_deletion_requests')
    .select('id').eq('firm_id', ctx.firmId).eq('status', 'pending').maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'A firm deletion request is already pending.' }, { status: 409 });
  }

  const { data: me } = await service
    .from('users').select('email, full_name').eq('id', ctx.userId).single();

  const { data: request, error } = await service
    .from('firm_deletion_requests')
    .insert({
      firm_id: ctx.firmId,
      requested_by: ctx.userId,
      requested_by_email: me?.email ?? null,
      requested_by_name: me?.full_name ?? null,
      firm_name: firmName,
      reason: body.reason ?? null,
      status: 'pending',
    })
    .select('id, status, requested_at')
    .single();
  if (error) {
    console.error('firm-deletion-request insert', error);
    return NextResponse.json({ error: 'Could not raise the request. Please try again.' }, { status: 500 });
  }

  // Notify the firm's other admins so it's visible internally.
  const { data: admins } = await service
    .from('users').select('id')
    .eq('firm_id', ctx.firmId).eq('role', 'admin').neq('id', ctx.userId);
  const who = me?.full_name || me?.email || 'An admin';
  await Promise.all((admins ?? []).map(a => createNotification({
    userId: a.id as string,
    firmId: ctx.firmId,
    type: 'firm_deletion_request',
    title: 'Firm account deletion requested',
    body: `${who} has requested deletion of the entire firm account. SMITH support will be in touch to confirm.`,
    data: { request_id: request.id },
  })));

  return NextResponse.json({ request });
}

export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { error } = await service
    .from('firm_deletion_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('firm_id', ctx.firmId)
    .eq('status', 'pending');
  if (error) return NextResponse.json({ error: 'Could not cancel the request.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
