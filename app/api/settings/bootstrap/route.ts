import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { OPTIONAL_MODULE_IDS } from '@/config/modules.config';

// GET /api/settings/bootstrap — returns everything the Settings page needs to render.
// Replaces the server-side props in app/(app)/settings/page.tsx so the Settings page
// can be hosted inside TabPanels (kept mounted across tab switches).
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id, full_name, avatar_url')
    .eq('id', user.id)
    .single();

  let firmName = '';
  let subscriptionTier = 'internal';
  let activeModules: string[] = OPTIONAL_MODULE_IDS;
  let seatCount = 1;
  let firmLogoUrl: string | null = null;
  let emailSenderName: string | null = null;
  let emailSenderAddress: string | null = null;

  if (profile?.firm_id) {
    try {
      const { data: firm } = await supabase
        .from('firms')
        .select('name, subscription_tier, active_modules, seat_count, logo_url, email_from_name, email_from_address')
        .eq('id', profile.firm_id)
        .single();
      firmName = firm?.name ?? '';
      subscriptionTier = firm?.subscription_tier ?? 'internal';
      seatCount = (firm?.seat_count as number | null) ?? 1;
      firmLogoUrl = (firm as Record<string, unknown>)?.logo_url as string | null ?? null;
      emailSenderName = (firm as Record<string, unknown>)?.email_from_name as string | null ?? null;
      emailSenderAddress = (firm as Record<string, unknown>)?.email_from_address as string | null ?? null;
      const stored = (firm?.active_modules as string[] | null) ?? [];
      if (stored.length > 0) activeModules = stored;
    } catch {
      try {
        const { data: firmBasic } = await supabase
          .from('firms')
          .select('name, subscription_tier')
          .eq('id', profile.firm_id)
          .single();
        firmName = firmBasic?.name ?? '';
        subscriptionTier = firmBasic?.subscription_tier ?? 'internal';
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({
    userId: user.id,
    userEmail: user.email ?? '',
    userName: profile?.full_name ?? '',
    avatarUrl: profile?.avatar_url ?? null,
    userRole: profile?.role ?? 'staff',
    firmId: profile?.firm_id ?? null,
    firmName, firmLogoUrl, subscriptionTier, activeModules, seatCount,
    emailSenderName, emailSenderAddress,
  });
}
