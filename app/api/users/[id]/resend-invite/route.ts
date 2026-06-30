import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { sendInvite } from '@/lib/sendInvite';

// ── POST /api/users/[id]/resend-invite ───────────────────────────────────────
// Admin-only. Re-emails the branded invite (set-password link) to a team member
// who hasn't accepted yet. Scoped to the admin's own firm.
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

  const { data: target } = await supabase
    .from('users')
    .select('email')
    .eq('id', params.id)
    .eq('firm_id', profile.firm_id)
    .single();

  if (!target?.email) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    const sent = await sendInvite(target.email);
    if (!sent) return NextResponse.json({ error: 'Could not resend the invite for this user.' }, { status: 500 });
  } catch (err) {
    console.error('[users] resend-invite', err);
    return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
