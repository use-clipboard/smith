import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

/** POST: mark the current user's onboarding as completed */
export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  await supabase
    .from('users')
    .update({ onboarding_completed: true })
    .eq('id', user.id);

  return NextResponse.json({ success: true });
}
