// Client-side audit logging for actions that happen in the browser (a per-record
// download, a list export) with no server round-trip of their own. Best-effort —
// never blocks the user's action. Posts to the admin-gated /api/audit endpoint.

export async function logAuditClient(input: {
  tool: string;
  action: 'exported' | 'downloaded';
  entityId?: string | null;
  entityLabel?: string | null;
  clientId?: string | null;
  summary?: string;
}): Promise<void> {
  try {
    await fetch('/api/audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch { /* non-critical */ }
}
