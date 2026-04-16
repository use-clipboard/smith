import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import AppShell from '@/components/ui/AppShell';
import { OPTIONAL_MODULE_IDS } from '@/config/modules.config';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SMITH',
  description: 'AI-powered accounting workflow tools',
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch user profile — never include columns that may not exist yet.
  // Each optional/new column gets its own safe query below.
  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id, full_name, avatar_url, onboarding_completed')
    .eq('id', user.id)
    .single();

  const displayName = profile?.full_name || user.email?.split('@')[0] || 'User';

  // Fetch favourites separately — gracefully handles pre-migration state
  // (if the column doesn't exist the main profile query won't break)
  let initialFavourites: string[] = [];
  try {
    const { data: favRow } = await supabase
      .from('users')
      .select('favourites')
      .eq('id', user.id)
      .single();
    initialFavourites = (favRow?.favourites as string[] | null) ?? [];
  } catch {
    // Column doesn't exist yet — use empty array
  }

  // Fetch firm data separately — gracefully handles pre-migration state
  let activeModules: string[] = OPTIONAL_MODULE_IDS;
  let hasApiKey = false;
  if (profile?.firm_id) {
    try {
      const { data: firm } = await supabase
        .from('firms')
        .select('active_modules, anthropic_api_key')
        .eq('id', profile.firm_id)
        .single();

      const stored = (firm?.active_modules as string[] | null) ?? [];
      if (stored.length > 0) activeModules = stored;

      // Derive boolean only — the key itself never leaves the server
      hasApiKey = Boolean((firm as { anthropic_api_key?: string } | null)?.anthropic_api_key);
    } catch {
      // Column doesn't exist yet — all modules active (Phase 1 behaviour)
      hasApiKey = true; // Don't warn pre-migration
    }
  }

  // Show onboarding guide for admins who haven't completed it yet
  const showOnboarding = profile?.role === 'admin' && !profile?.onboarding_completed;

  return (
    <AppShell
      userName={displayName}
      userEmail={user.email ?? ''}
      userRole={profile?.role ?? 'staff'}
      avatarUrl={profile?.avatar_url ?? null}
      userId={user.id}
      firmId={profile?.firm_id ?? ''}
      activeModules={activeModules}
      initialFavourites={initialFavourites}
      showOnboarding={showOnboarding ?? false}
      hasApiKey={hasApiKey}
    >
      {children}
    </AppShell>
  );
}
