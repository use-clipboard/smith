import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { sendRecoveryEmail } from '@/lib/sendRecoveryEmail';

// ── POST /api/users/[id]/reset-password ──────────────────────────────────────
// Admin-only. Emails the target user a working password-reset link (token-hash
// recovery flow → /auth/confirm → /reset-password). The user sets their own new
// password; the admin never sees or chooses it.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Fetch the target user's email — scoped to the admin's own firm.
  const { data: target } = await supabase
    .from('users')
    .select('email')
    .eq('id', params.id)
    .eq('firm_id', profile.firm_id)
    .single();

  if (!target?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    const sent = await sendRecoveryEmail({ email: target.email, byAdmin: true });
    if (!sent) {
      return NextResponse.json({ error: 'Could not send the reset email for this user.' }, { status: 500 });
    }
  } catch (err) {
    console.error('[users] admin reset-password', err);
    return NextResponse.json({ error: 'Failed to send reset email' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
