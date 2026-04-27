import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: token, error } = await supabase
    .from('calendar_tokens')
    .select('google_email, updated_at')
    .eq('user_id', ctx.userId)
    .single();

  // If the table doesn't exist (migration not run), surface a clear error
  if (error && error.code !== 'PGRST116') {
    // PGRST116 = "no rows returned" which is expected when not connected
    // Any other error (e.g. table missing) gets logged
    console.error('calendar_tokens query error — has the migration been run?', error);
    return NextResponse.json({ connected: false, setupRequired: true });
  }

  return NextResponse.json({
    connected: !!token,
    googleEmail: token?.google_email ?? null,
    connectedAt: token?.updated_at ?? null,
    isAdmin: ctx.userRole === 'admin',
  });
}
