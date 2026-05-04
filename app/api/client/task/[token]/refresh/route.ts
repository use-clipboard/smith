import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// POST /api/client/task/[token]/refresh
// Public — no auth. Creates a fresh token for the same step (when original is expired).
export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServiceClient();
  const { token } = params;

  // Fetch the expired token to get step/task/firm IDs
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('task_client_tokens')
    .select('id, expires_at, completed_at, task_id, step_id, firm_id')
    .eq('token', token)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Don't refresh a completed token — the step is already done
  if (tokenRow.completed_at) {
    return NextResponse.json({ error: 'already_completed' }, { status: 409 });
  }

  // If somehow not expired yet, just return a signal to use the existing link
  if (new Date(tokenRow.expires_at) >= new Date()) {
    return NextResponse.json({ error: 'not_expired' }, { status: 400 });
  }

  // Invalidate the old token by setting its expiry to the past (keep it for audit)
  await supabase
    .from('task_client_tokens')
    .update({ expires_at: new Date(0).toISOString() })
    .eq('id', tokenRow.id);

  // Create a new token for the same step
  const { data: newToken, error: insertErr } = await supabase
    .from('task_client_tokens')
    .insert({
      task_id: tokenRow.task_id,
      step_id: tokenRow.step_id,
      firm_id: tokenRow.firm_id,
      // token and expires_at use DB defaults
    })
    .select('token')
    .single();

  if (insertErr || !newToken) {
    console.error('Failed to create refresh token', insertErr);
    return NextResponse.json({ error: 'Failed to refresh' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://smithapp.co.uk';
  return NextResponse.json({
    success: true,
    new_url: `${appUrl}/client/task/${newToken.token}`,
  });
}
