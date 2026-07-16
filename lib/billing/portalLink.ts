// Billing module — the client's statement-portal link.
//
// One live token per client, reused until it expires (90 days). Both the invoice
// email and the credit-control chaser need it, and the cron has no user, so
// created_by is optional — the column is nullable by design.

import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBaseUrl } from '@/lib/getBaseUrl';

export async function getOrCreatePortalLink(
  supabase: SupabaseClient,
  args: { firmId: string; clientId: string | null; userId?: string | null },
): Promise<string> {
  if (!args.clientId) return '';

  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from('billing_portal_tokens')
    .select('token')
    .eq('firm_id', args.firmId)
    .eq('client_id', args.clientId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    const { error } = await supabase.from('billing_portal_tokens').insert({
      firm_id: args.firmId, client_id: args.clientId, token, created_by: args.userId ?? null,
    });
    // No link is better than a link to a token that was never stored.
    if (error) return '';
  }
  return `${getBaseUrl()}/statement/${token}`;
}
