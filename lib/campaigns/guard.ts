import { getUserContext, type UserContext } from '@/lib/getUserContext';
import { canAccessCampaigns } from '@/lib/campaigns/access';

/**
 * Resolve the user context for a Campaigns API route, enforcing both the
 * (preview) email allowlist and the firm's module entitlement. Returns null when
 * the caller shouldn't be here — the route turns that into a 401/403.
 */
export async function getCampaignsContext(): Promise<UserContext | null> {
  const ctx = await getUserContext();
  if (!ctx) return null;
  if (!canAccessCampaigns(ctx.email)) return null;
  if (!ctx.activeModules.includes('campaigns')) return null;
  return ctx;
}
