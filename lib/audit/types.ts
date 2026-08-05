// Generic audit trail — pure, client-safe types + display metadata.
// No server-only imports, so both the API routes and the viewer can use it.

export type AuditTone =
  | 'create' | 'edit' | 'delete' | 'send' | 'approve' | 'reject' | 'file' | 'download' | 'neutral';

export interface AuditChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface AuditEntry {
  id: string;
  tool: string;
  entityId: string | null;
  entityLabel: string | null;
  clientId: string | null;
  actorName: string;
  action: string;
  summary: string | null;
  changes: AuditChange[] | null;
  createdAt: string;
}

// Known actions → label + tone. Unknown actions fall back to a neutral default.
export const ACTION_META: Record<string, { label: string; tone: AuditTone }> = {
  created:           { label: 'Created',            tone: 'create' },
  copied:            { label: 'Copied',             tone: 'create' },
  edited:            { label: 'Edited',             tone: 'edit' },
  deleted:           { label: 'Deleted',            tone: 'delete' },
  downloaded:        { label: 'Downloaded',         tone: 'download' },
  exported:          { label: 'Exported',           tone: 'download' },
  sent_for_approval: { label: 'Sent for approval',  tone: 'send' },
  client_approved:   { label: 'Approved by client', tone: 'approve' },
  client_rejected:   { label: 'Changes requested',  tone: 'reject' },
  published:         { label: 'Published',          tone: 'file' },
  submitted:         { label: 'Submitted',          tone: 'file' },
};

export function actionMeta(action: string): { label: string; tone: AuditTone } {
  return ACTION_META[action] ?? { label: action.replace(/_/g, ' '), tone: 'neutral' };
}
