import { Resend } from 'resend';
import { resolveMergeTags, type MergeTagContext } from './emailMergeTags';

// Only instantiate if the key exists — avoids build-time crash when RESEND_API_KEY is not set yet.
let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY environment variable is not set.');
    _resend = new Resend(key);
  }
  return _resend;
}

export interface TaskReminderEmailOptions {
  to: string;
  recipientName: string;
  taskTitle: string;
  stepTitle: string;
  clientName: string | null;
  dueDate: string | null;
  /** Custom subject line — may contain {{merge_tags}}. Falls back to default if not set. */
  customSubject?: string | null;
  /** Custom message body — may contain {{merge_tags}}. Appears below the task details box. */
  customMessage?: string | null;
  taskUrl: string;
  /** Override the sender. Falls back to RESEND_FROM_ADDRESS env var, then a hardcoded default. */
  fromAddress?: string;
  /** Context used to resolve {{merge_tags}} in subject and message. */
  mergeContext?: MergeTagContext;
}

export async function sendTaskReminderEmail(opts: TaskReminderEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <noreply@smithapp.co.uk>';

  // Build merge tag context — merge in the top-level fields as a baseline
  const ctx: MergeTagContext = {
    client_name:    opts.clientName,
    task_title:     opts.taskTitle,
    step_title:     opts.stepTitle,
    due_date:       opts.dueDate,
    recipient_name: opts.recipientName,
    ...opts.mergeContext,
  };

  // Resolve merge tags in subject and message
  const defaultSubject = `[SMITH] Reminder: ${opts.stepTitle} — ${opts.taskTitle}`;
  const subject = opts.customSubject
    ? resolveMergeTags(opts.customSubject, ctx)
    : defaultSubject;

  const resolvedMessage = opts.customMessage
    ? resolveMergeTags(opts.customMessage, ctx)
    : null;

  const dueLine = opts.dueDate
    ? `<p style="color:#6b7280;font-size:14px;">Due: <strong>${new Date(opts.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></p>`
    : '';

  const clientLine = opts.clientName
    ? `<p style="color:#6b7280;font-size:14px;">Client: <strong>${opts.clientName}</strong></p>`
    : '';

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">SMITH — Task Reminder</h1>
      </div>
      <div style="padding:24px;">
        <p style="color:#111827;font-size:16px;margin:0 0 8px;">Hello ${opts.recipientName},</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;">You have a task step that requires your attention:</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#111827;">${opts.taskTitle}</p>
          <p style="margin:0 0 12px;font-size:14px;color:#6b7280;">Step: ${opts.stepTitle}</p>
          ${clientLine}
          ${dueLine}
        </div>
        ${resolvedMessage ? `<p style="color:#374151;font-size:14px;margin:0 0 20px;white-space:pre-line;">${resolvedMessage}</p>` : ''}
        <a href="${opts.taskUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">View Task</a>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">This reminder was sent from SMITH. You are receiving this because you are assigned to this task step.</p>
      </div>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject,
    html,
  });

  if (error) throw new Error(`Failed to send email: ${error.message}`);
}

// ── Client step complete — notifies the assigned team member ─────────────────

export interface ClientStepCompleteEmailOptions {
  to: string;
  recipientName: string;
  stepTitle: string;
  taskTitle: string;
  clientName: string | null;
  taskUrl: string;
}

export async function sendClientStepCompleteEmail(opts: ClientStepCompleteEmailOptions) {
  const resend = getResend();
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'SMITH <noreply@smithapp.co.uk>';

  const clientLine = opts.clientName
    ? `<p style="color:#6b7280;font-size:14px;">Client: <strong>${opts.clientName}</strong></p>`
    : '';

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">SMITH — Client Action Complete</h1>
      </div>
      <div style="padding:24px;">
        <p style="color:#111827;font-size:16px;margin:0 0 8px;">Hello ${opts.recipientName},</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;">A client has completed their task step:</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#111827;">✓ ${opts.stepTitle}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">Part of: ${opts.taskTitle}</p>
          ${clientLine}
        </div>
        <a href="${opts.taskUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">View Task in SMITH</a>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">This notification was sent from SMITH because you are assigned to this task step.</p>
      </div>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: `[SMITH] Client completed: ${opts.stepTitle}`,
    html,
  });

  if (error) throw new Error(`Failed to send client-complete email: ${error.message}`);
}

// ─── Manager briefing notification ───────────────────────────────────────────
export interface ManagerBriefingEmailOptions {
  to: string;
  briefingId: string;
  fromAddress?: string;
}

export async function sendManagerBriefingEmail(opts: ManagerBriefingEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <noreply@smithapp.co.uk>';
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/hr?tab=resources`;

  const html = `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:#4F46E5;color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">New manager briefing</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.6;">A fresh quarterly briefing on UK employment-law changes and training tips for managers is now available in SMITH.</p>
        <p style="margin:0 0 16px;font-size:13px;color:#6b7280;line-height:1.5;">It's reading material drawn from gov.uk, ACAS, CIPD and other UK authoritative sources — verify with a qualified adviser before acting on anything specific.</p>
        <a href="${link}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">Read the briefing</a>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">You received this because you manage staff or are an admin in your firm. Admins can opt out at Settings → HR → Holiday config.</p>
      </div>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: '[SMITH] New manager briefing — UK employment law update',
    html,
  });
  if (error) throw new Error(`Failed to send briefing email: ${error.message}`);
}
