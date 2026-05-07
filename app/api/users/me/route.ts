import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/users/me — returns current user's ID, role, name and firm name
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  const [userRes, firmRes] = await Promise.all([
    supabase.from('users').select('full_name, email').eq('id', ctx.userId).single(),
    supabase.from('firms').select('name').eq('id', ctx.firmId).single(),
  ]);

  const full_name = userRes.data?.full_name ?? userRes.data?.email ?? null;
  const firm_name = firmRes.data?.name ?? null;

  return NextResponse.json({
    userId: ctx.userId,
    firmId: ctx.firmId,
    userRole: ctx.userRole,
    full_name,
    firm_name,
  });
}
