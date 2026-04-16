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

  // Fetch user profile (firm_id + full_name)
  const { data: profile } = await supabase
    .from('users')
    .select('firm_id, full_name')
    .eq('id', user?.id ?? '')
    .single();

  const firmId = profile?.firm_id ?? '';
  const currentUserName = profile?.full_name || displayName;

  // Fetch team members
  const { data: teamMembers } = firmId
    ? await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('firm_id', firmId)
        .limit(8)
    : { data: [] };

  // Fetch whiteboard messages for this firm
  const { data: whiteboardMessages } = firmId
    ? await supabase
        .from('whiteboard_messages')
        .select('id, content, color, author_name, created_at, user_id')
        .eq('firm_id', firmId)
        .order('created_at', { ascending: false })
        .limit(40)
    : { data: [] };

  return (
    <DashboardClient
      displayName={displayName}
      recentClients={recentClients ?? []}
      recentOutputs={(recentOutputs ?? []) as unknown as { id: string; feature: string; created_at: string; clients?: { name: string } | null }[]}
      teamMembers={teamMembers ?? []}
      whiteboardMessages={(whiteboardMessages ?? []) as unknown as { id: string; content: string; color: 'yellow' | 'pink' | 'blue'; author_name: string; created_at: string; user_id: string }[]}
      currentUserId={user?.id ?? ''}
      firmId={firmId}
      currentUserName={currentUserName}
    />
  );
}
