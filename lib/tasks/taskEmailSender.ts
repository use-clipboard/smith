// Resolve which Gmail mailbox a task email should be sent from.
//
// Task emails (reminders + client task request/completion) are sent from a
// connected Gmail — either the task owner's mailbox or a specific firm mailbox —
// NOT via Resend. Resolution order:
//   task.email_sender_mode === 'default'  → fall back to the firm default
//   'owner'    → the task owner's connected Gmail (email_connections)
//   'specific' → a firm sending mailbox (firm_sending_mailboxes)
// If the resolved sender isn't connected/usable, we return { ok:false, reason }
// so the caller can skip the send and flag the owner (no Resend fallback).

import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient } from '@/lib/gmail';

type Gmail = Awaited<ReturnType<typeof getRefreshedGmailClient>>['gmail'];

export type ResolvedTaskSender =
  | { ok: true; gmail: Gmail; fromEmail: string }
  | { ok: false; reason: string };

export async function resolveTaskEmailSender(opts: {
  firmId: string;
  /** From the task row. 'default' inherits the firm default. */
  mode: 'default' | 'owner' | 'specific';
  /** From the task row — the chosen firm mailbox when mode is 'specific'. */
  mailboxId: string | null;
  /** The team member who owns the task (used when mode resolves to 'owner'). */
  ownerUserId: string | null;
}): Promise<ResolvedTaskSender> {
  const service = createServiceClient();

  // Resolve 'default' against the firm's configured default sender.
  let mode = opts.mode;
  let mailboxId = opts.mailboxId;
  if (mode === 'default') {
    const { data: firm } = await service
      .from('firms')
      .select('task_email_sender_mode, task_email_sender_mailbox_id')
      .eq('id', opts.firmId)
      .maybeSingle();
    mode = ((firm?.task_email_sender_mode as 'owner' | 'specific' | null) ?? 'owner');
    mailboxId = (firm?.task_email_sender_mailbox_id as string | null) ?? null;
  }

  if (mode === 'owner') {
    if (!opts.ownerUserId) {
      return { ok: false, reason: 'This task has no owner to send from — assign an owner or set a sending mailbox.' };
    }
    const { data: conn } = await service
      .from('email_connections')
      .select('refresh_token, google_email')
      .eq('user_id', opts.ownerUserId)
      .maybeSingle();
    if (!conn?.refresh_token || !conn.google_email) {
      return { ok: false, reason: 'The task owner has not connected their Gmail, so the email could not be sent.' };
    }
    try {
      const { gmail } = await getRefreshedGmailClient(conn.refresh_token);
      return { ok: true, gmail, fromEmail: conn.google_email };
    } catch {
      return { ok: false, reason: "The task owner's Gmail connection needs reconnecting." };
    }
  }

  // mode === 'specific'
  if (!mailboxId) {
    return { ok: false, reason: 'No sending mailbox is selected for this task.' };
  }
  const { data: mb } = await service
    .from('firm_sending_mailboxes')
    .select('refresh_token, google_email, firm_id')
    .eq('id', mailboxId)
    .maybeSingle();
  if (!mb || mb.firm_id !== opts.firmId || !mb.refresh_token || !mb.google_email) {
    return { ok: false, reason: 'The selected sending mailbox is unavailable — reconnect it in Tasks settings.' };
  }
  try {
    const { gmail } = await getRefreshedGmailClient(mb.refresh_token as string);
    return { ok: true, gmail, fromEmail: mb.google_email as string };
  } catch {
    return { ok: false, reason: 'The selected sending mailbox needs reconnecting in Tasks settings.' };
  }
}
