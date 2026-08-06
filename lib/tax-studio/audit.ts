// Tax Studio audit trail — server-side write helper.
//
// Records one row per action into tax_studio_audit_log via the service-role
// client so RLS never blocks a write. Best-effort: any failure is swallowed and
// logged, never propagated — auditing must not break the underlying action
// (and it degrades gracefully if the migration hasn't been applied yet).

import { createServiceClient } from '@/lib/supabase-server';

export type TaxAuditAction = 'created' | 'edited' | 'analysed' | 'reviewed' | 'sent' | 'approved' | 'submitted' | 'deleted' | 'copied';

export interface LogTaxAuditInput {
  firmId: string;
  returnId?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  actorId?: string | null;
  action: TaxAuditAction;
  summary?: string | null;
}

export async function logTaxAudit(input: LogTaxAuditInput): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from('tax_studio_audit_log').insert({
      firm_id: input.firmId,
      return_id: input.returnId ?? null,
      client_id: input.clientId ?? null,
      client_name: input.clientName ?? null,
      actor_id: input.actorId ?? null,
      action: input.action,
      summary: input.summary ?? null,
    });
  } catch (err) {
    console.error('[tax-studio audit] log failed', err);
  }
}
