import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessCampaigns } from '@/lib/campaigns/access';
import CampaignsComingSoon from '@/components/features/campaigns/CampaignsComingSoon';

// Gating layout for the Campaigns tool. It's a Practice-tier tool, but while in
// "Soon" preview it's additionally locked to the email allowlist so it stays
// hidden from the rest of the firm during the build. Everyone else lands on the
// Coming Soon placeholder.
export default async function CampaignsLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const ctx = await getUserContext();
  if (!ctx || !canAccessCampaigns(ctx.email)) {
    return <CampaignsComingSoon />;
  }

  return <>{children}</>;
}
