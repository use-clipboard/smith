import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignFirmSettings } from '@/types/campaigns';

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignFirmSettings = {
  reply_to: null,
  include_unsubscribe: true,
  unsubscribe_footer: '',
  default_dedupe: 'per_email',
  frequency_guard_days: 0,
  require_approval: false,
  approval_min_recipients: 0,
  allow_self_approve: false,
};

/**
 * The firm's campaign defaults, merged over the built-in defaults. Never throws:
 * a missing row or an unapplied migration falls back to the defaults, so a send
 * is never blocked by a settings read.
 */
export async function getCampaignFirmSettings(supabase: SupabaseClient, firmId: string): Promise<CampaignFirmSettings> {
  try {
    const { data } = await supabase
      .from('campaign_settings')
      .select('reply_to, include_unsubscribe, unsubscribe_footer, default_dedupe, frequency_guard_days, require_approval, approval_min_recipients, allow_self_approve')
      .eq('firm_id', firmId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_CAMPAIGN_SETTINGS };
    return {
      reply_to: (data.reply_to as string) ?? null,
      include_unsubscribe: data.include_unsubscribe ?? true,
      unsubscribe_footer: (data.unsubscribe_footer as string) ?? '',
      default_dedupe: (data.default_dedupe as 'per_email' | 'per_client') ?? 'per_email',
      frequency_guard_days: (data.frequency_guard_days as number) ?? 0,
      require_approval: data.require_approval ?? false,
      approval_min_recipients: (data.approval_min_recipients as number) ?? 0,
      allow_self_approve: data.allow_self_approve ?? false,
    };
  } catch {
    return { ...DEFAULT_CAMPAIGN_SETTINGS };
  }
}
