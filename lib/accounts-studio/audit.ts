// Accounts Studio audit trail — server-side write helper.
//
// Records one row per action into accounts_studio_audit_log via the service-role
// client so RLS never blocks a write. Best-effort: any failure is swallowed and
// logged, never propagated — auditing must not break the underlying action.

import { createServiceClient } from '@/lib/supabase-server';
import type { AuditAction, AuditChange } from './auditTypes';

export interface LogAuditInput {
  firmId: string;
  engagementId?: string | null;
  clientId?: string | null;
  companyName?: string | null;
  /** The acting user (null for a client acting via a tokened link). */
  actorId?: string | null;
  /** Display name — required when there's no actorId (e.g. a client's typed name). */
  actorName?: string | null;
  action: AuditAction;
  summary?: string | null;
  changes?: AuditChange[] | null;
}

export async function logAuditEvent(input: LogAuditInput): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from('accounts_studio_audit_log').insert({
      firm_id: input.firmId,
      engagement_id: input.engagementId ?? null,
      client_id: input.clientId ?? null,
      company_name: input.companyName ?? null,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      action: input.action,
      summary: input.summary ?? null,
      changes: input.changes && input.changes.length ? input.changes : null,
    });
  } catch (err) {
    console.error('[accounts-studio audit] log failed', err);
  }
}
