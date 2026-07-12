// Billing module — append-only audit logging + admin-permission helper.

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export type BillingAuditAction =
  | 'created' | 'sent' | 'viewed' | 'paid' | 'part_paid' | 'overdue' | 'cancelled' | 'bad_debt'
  | 'payment' | 'credit_note' | 'emailed' | 'deleted' | 'posted_to_bookkeeping'
  | 'imported' | 'bulk' | 'allocated';

/** Record a billing event. Best-effort — never throws, never blocks the caller. */
export async function logBillingAudit(
  supabase: SupabaseClient,
  args: { firmId: string; invoiceId?: string | null; userId?: string | null; action: BillingAuditAction; detail?: string | null },
): Promise<void> {
  try {
    await supabase.from('billing_audit').insert({
      firm_id: args.firmId,
      invoice_id: args.invoiceId ?? null,
      user_id: args.userId ?? null,
      action: args.action,
      detail: args.detail ?? null,
    });
  } catch { /* audit failures never affect the operation */ }
}

/** 403 for a non-admin attempting a restricted billing action. */
export function requireAdmin(userRole: string, action = 'do this'): NextResponse | null {
  if (userRole === 'admin') return null;
  return NextResponse.json({ error: `Only firm admins can ${action}.` }, { status: 403 });
}
