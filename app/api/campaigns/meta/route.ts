import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCampaignsContext } from '@/lib/campaigns/guard';

// GET /api/campaigns/meta — dynamic options for the builder + wizard:
// the firm's team members (for the "account manager" filter) and the current
// user's connected Gmail sender.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });

  const supabase = createClient();

  const [{ data: users }, { data: connection }] = await Promise.all([
    supabase.from('users').select('id, full_name, email').eq('firm_id', ctx.firmId).order('full_name'),
    supabase.from('email_connections').select('google_email').eq('user_id', ctx.userId).maybeSingle(),
  ]);

  const team = (users ?? []).map(u => ({
    id: u.id as string,
    name: (u.full_name as string) || (u.email as string) || 'Unnamed',
  }));

  return NextResponse.json({
    team,
    gmail: {
      connected: !!connection?.google_email,
      email: connection?.google_email ?? null,
    },
    emailTriageActive: ctx.activeModules.includes('email-triage'),
  });
}
