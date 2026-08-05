// Generic audit trail — server-side write helper.
//
// Records one row per action into audit_log via the service-role client so RLS
// never blocks a write. Best-effort: failures are swallowed + logged, never
// propagated — auditing must not break the underlying action.

import { createServiceClient } from '@/lib/supabase-server';
import type { AuditChange } from './types';

export interface LogAuditInput {
  firmId: string;
  tool: string;                 // discriminator (= outputs.feature where applicable)
  action: string;              // created | deleted | exported | …
  entityId?: string | null;
  entityLabel?: string | null; // client / company name
  clientId?: string | null;
  actorId?: string | null;
  actorName?: string | null;   // required when there's no actorId (a client)
  summary?: string | null;
  changes?: AuditChange[] | null;
}

export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from('audit_log').insert({
      firm_id: input.firmId,
      tool: input.tool,
      action: input.action,
      entity_id: input.entityId ?? null,
      entity_label: input.entityLabel ?? null,
      client_id: input.clientId ?? null,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      summary: input.summary ?? null,
      changes: input.changes && input.changes.length ? input.changes : null,
    });
  } catch (err) {
    console.error('[audit] log failed', err);
  }
}
