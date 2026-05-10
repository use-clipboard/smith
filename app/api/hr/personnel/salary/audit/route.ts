import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/hr/personnel/salary/audit?userId=… — see who has accessed a salary record.
// Subject sees their own audit log; admins see all.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const userId = new URL(req.url).searchParams.get('userId') ?? ctx.userId;
  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_salary_audit')
    .select('*, accessor:users!accessed_by ( id, full_name, email )')
    .eq('firm_id', ctx.firmId)
    .eq('salary_user_id', userId)
    .order('accessed_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
