import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignFirmSettings } from '@/types/campaigns';

export const DEFAULT_CAMPAIGN_SETTINGS: CampaignFirmSettings = {
  reply_to: null,
  include_unsubscribe: true,
  unsubscribe_footer: '',
  default_dedupe: 'per_email',
  frequency_guard_days: 0,
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
      .select('reply_to, include_unsubscribe, unsubscribe_footer, default_dedupe, frequency_guard_days')
      .eq('firm_id', firmId)
      .maybeSingle();
    if (!data) return { ...DEFAULT_CAMPAIGN_SETTINGS };
    return {
      reply_to: (data.reply_to as string) ?? null,
      include_unsubscribe: data.include_unsubscribe ?? true,
      unsubscribe_footer: (data.unsubscribe_footer as string) ?? '',
      default_dedupe: (data.default_dedupe as 'per_email' | 'per_client') ?? 'per_email',
      frequency_guard_days: (data.frequency_guard_days as number) ?? 0,
    };
  } catch {
    return { ...DEFAULT_CAMPAIGN_SETTINGS };
  }
}
