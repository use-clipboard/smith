import { createClient, createServiceClient } from '@/lib/supabase-server';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
  const supabase = createClient();
  const service = createServiceClient();
  const { data: { user } } = await supabase.auth.getUser();

  const displayName = user?.email?.split('@')[0] || 'there';

  // Fetch recent clients (capped at 3 for panel display)
  const { data: recentClients } = await supabase
    .from('clients')
    .select('id, name, client_ref')
    .order('created_at', { ascending: false })
    .limit(15);

  // Fetch recent AI outputs — include client_ref for display
  const { data: recentOutputs } = await supabase
    .from('outputs')
    .select('id, feature, created_at, clients(name, client_ref)')
    .order('created_at', { ascending: false })
    .limit(15);

  // Fetch user profile
  const { data: profile } = await supabase
    .from('users')
    .select('firm_id, full_name')
    .eq('id', user?.id ?? '')
    .single();

  const firmId = profile?.firm_id ?? '';
  const currentUserName = profile?.full_name || displayName;

  // Fetch all team members — client sorts and slices for display
  const { data: teamMembersRaw } = firmId
    ? await service
        .from('users')
        .select('id, full_name, email, role, avatar_url')
        .eq('firm_id', firmId)
        .order('full_name')
    : { data: [] };

  // Merge last_sign_in_at from auth.users via service role
  let lastLoginMap: Record<string, string | null> = {};
  try {
    const { data: authData } = await service.auth.admin.listUsers({ perPage: 1000 });
    if (authData?.users) {
      lastLoginMap = Object.fromEntries(
        authData.users.map(u => [u.id, u.last_sign_in_at ?? null])
      );
    }
  } catch {
    // Non-critical — last login omitted if unavailable
  }

  const teamMembers = (teamMembersRaw ?? []).map(m => ({
    ...m,
    last_sign_in_at: lastLoginMap[m.id] ?? null,
  }));

  // Fetch whiteboard messages for this firm — includes the new positioning
  // and kind columns so notes are draggable / can be marker text.
  const { data: whiteboardMessages } = firmId
    ? await supabase
        .from('whiteboard_messages')
        .select('id, content, color, author_name, created_at, user_id, kind, pos_x, pos_y, rotation')
        .eq('firm_id', firmId)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] };

  return (
    <DashboardClient
      displayName={displayName}
      recentClients={recentClients ?? []}
      recentOutputs={(recentOutputs ?? []) as unknown as { id: string; feature: string; created_at: string; clients?: { name: string; client_ref?: string | null } | null }[]}
      teamMembers={teamMembers}
      whiteboardMessages={(whiteboardMessages ?? []) as unknown as { id: string; content: string; color: 'yellow' | 'pink' | 'blue'; author_name: string; created_at: string; user_id: string }[]}
      currentUserId={user?.id ?? ''}
      firmId={firmId}
      currentUserName={currentUserName}
    />
  );
}
