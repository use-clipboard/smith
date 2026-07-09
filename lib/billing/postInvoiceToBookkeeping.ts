// Billing module — Bookkeeping posting seam.
//
// When `billing_settings.post_to_bookkeeping` is on, issuing an invoice should
// post a corresponding sale into the firm's own Bookkeeping sales ledger (and a
// payment posts the receipt). This is the single seam that whole feature lives
// behind — keep the branch here, not scattered through the API routes.
//
// Phase A: no-op. The Bookkeeping posting is wired when that toggle work is
// scheduled (see docs/billing-module.md §4). Returning `{ posted: false }`
// keeps callers honest about whether anything happened.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Invoice } from './types';

export interface PostResult {
  posted: boolean;
  reason?: string;
}

export async function postInvoiceToBookkeeping(
  _supabase: SupabaseClient,
  _firmId: string,
  _invoice: Invoice,
  settings: { postToBookkeeping: boolean; bookkeepingSalesAccount: string | null },
): Promise<PostResult> {
  if (!settings.postToBookkeeping) {
    return { posted: false, reason: 'toggle_off' };
  }
  // TODO(Phase D): create a sale in the Bookkeeping ledger against
  // settings.bookkeepingSalesAccount, mirroring the invoice net/VAT lines.
  return { posted: false, reason: 'not_implemented' };
}
