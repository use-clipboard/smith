import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { revokeUserGoogleConnections } from '@/lib/accountDeletion';
import { createNotification } from '@/lib/notifications';

// ── /api/account/deletion-request ────────────────────────────────────────────
// Self-serve account/data deletion REQUEST. On POST we immediately revoke the
// user's own Google (Gmail/Calendar) connections, record the request, and
// notify the firm's admins, who complete the full deletion within 30 days.
//
//   GET    → the caller's current pending request (or null)
//   POST   → raise a request { reason? }
//   DELETE → cancel the caller's pending request

const Body = z.object({ reason: z.string().max(2000).optional() });

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { data } = await service
    .from('account_deletion_requests')
    .select('id, status, requested_at')
    .eq('user_id', ctx.userId)
    .eq('status', 'pending')
    .maybeSingle();

  return NextResponse.json({ request: data ?? null });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json().catch(() => ({}))); }
  catch { return NextResponse.json({ error: 'Invalid payload' }, { status: 400 }); }

  const service = createServiceClient();

  // The last remaining admin can't delete themselves — that would orphan the
  // firm. They must promote another admin first.
  if (ctx.userRole === 'admin') {
    const { count } = await service
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('firm_id', ctx.firmId)
      .eq('role', 'admin');
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "You're the only admin in the firm. Make another team member an admin before requesting deletion of your account." },
        { status: 400 },
      );
    }
  }

  // Already have a pending request?
  const { data: existing } = await service
    .from('account_deletion_requests')
    .select('id')
    .eq('user_id', ctx.userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'You already have a pending deletion request.' }, { status: 409 });
  }

  // Capture the requester's identity (denormalised so the audit record survives
  // after the user row is deleted on completion).
  const { data: me } = await service
    .from('users')
    .select('email, full_name')
    .eq('id', ctx.userId)
    .single();

  // Revoke the user's personal Google connections NOW (Gmail + Calendar). Drive
  // is firm-level and left untouched.
  await revokeUserGoogleConnections(service, ctx.userId);

  const { data: request, error } = await service
    .from('account_deletion_requests')
    .insert({
      user_id: ctx.userId,
      firm_id: ctx.firmId,
      user_email: me?.email ?? null,
      user_name: me?.full_name ?? null,
      reason: body.reason ?? null,
      status: 'pending',
    })
    .select('id, status, requested_at')
    .single();
  if (error) {
    console.error('deletion-request insert', error);
    return NextResponse.json({ error: 'Could not raise the request. Please try again.' }, { status: 500 });
  }

  // Notify the firm's admins (excluding the requester).
  const { data: admins } = await service
    .from('users')
    .select('id')
    .eq('firm_id', ctx.firmId)
    .eq('role', 'admin')
    .neq('id', ctx.userId);
  const name = me?.full_name || me?.email || 'A team member';
  await Promise.all((admins ?? []).map(a => createNotification({
    userId: a.id as string,
    firmId: ctx.firmId,
    type: 'account_deletion_request',
    title: 'Account deletion requested',
    body: `${name} has requested deletion of their account & data. Complete it in Settings → Team.`,
    data: { request_id: request.id, link: '/settings?tab=team' },
  })));

  return NextResponse.json({ request });
}

export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const { error } = await service
    .from('account_deletion_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('user_id', ctx.userId)
    .eq('status', 'pending');
  if (error) return NextResponse.json({ error: 'Could not cancel the request.' }, { status: 500 });

  return NextResponse.json({ ok: true });
}
