import { createClient } from '@/lib/supabase-server';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const displayName = user?.email?.split('@')[0] || 'there';

  // Fetch recent clients
  const { data: recentClients } = await supabase
    .from('clients')
    .select('id, name, client_ref')
    .order('created_at', { ascending: false })
    .limit(3);

  // Fetch recent AI outputs
  const { data: recentOutputs } = await supabase
    .from('outputs')
    .select('id, feature, created_at, clients(name)')
    .order('created_at', { ascending: false })
    .limit(3);

  // Fetch online team members (users in same firm)
  const { data: profile } = await supabase
    .from('users')
    .select('firm_id')
    .eq('id', user?.id ?? '')
    .single();

  const { data: teamMembers } = profile?.firm_id
    ? await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('firm_id', profile.firm_id)
        .limit(8)
    : { data: [] };

  return (
    <DashboardClient
      displayName={displayName}
      recentClients={recentClients ?? []}
      recentOutputs={(recentOutputs ?? []) as unknown as { id: string; feature: string; created_at: string; clients?: { name: string } | null }[]}
      teamMembers={teamMembers ?? []}
    />
  );
}
