import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/me — minimal "who am I" endpoint for client-side wrappers.
// Returns the bare minimum the bookkeeping/whiteboard surfaces need to render
// without re-asking the server on every navigation.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle();

  const userName = profile?.full_name || profile?.email || null;

  return NextResponse.json({
    userId: ctx.userId,
    userName,
    userRole: ctx.userRole,
    firmId: ctx.firmId,
  });
}
