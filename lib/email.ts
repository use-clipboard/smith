import { Resend } from 'resend';
import { resolveMergeTags, type MergeTagContext } from './emailMergeTags';
import { createServiceClient } from './supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from './gmail';
import { getBaseUrl } from './getBaseUrl';

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

// Render the task-reminder email (subject + HTML) WITHOUT sending. Used both by
// the Resend path (sendTaskReminderEmail below) and the Gmail path (the reminder
// cron sends from the task owner's / a firm mailbox's Gmail).
export function renderTaskReminderEmail(opts: TaskReminderEmailOptions): { subject: string; html: string } {
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

  return { subject, html };
}

// Resend path — renders then sends via Resend. Kept for any caller still using
// the system mailbox; the task reminder cron now prefers the Gmail path.
export async function sendTaskReminderEmail(opts: TaskReminderEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const { subject, html } = renderTaskReminderEmail(opts);

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject,
    html,
  });

  if (error) throw new Error(`Failed to send email: ${error.message}`);
}

// ── Credit-control chaser — sends an overdue-invoice reminder to a client ─────

export interface ChaserEmailOptions {
  to: string;
  subject: string;
  /** Plain-text body (paragraphs separated by blank lines); rendered to HTML. */
  body: string;
  /** Firm/business display name for the From line. */
  fromName: string;
  /** Where client replies should go (the firm's mailbox). */
  replyTo?: string;
  /** The client's statement portal — adds a "View & pay invoice" button. */
  portalLink?: string | null;
  /** Firm brand colour for that button. */
  accent?: string | null;
}

function escapeChaserHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Wrap a plain-text chaser body in a clean, neutral HTML shell.
 *  The body is always escaped — stage templates are plain text, so a firm can't
 *  inject markup — and the pay button is appended as trusted markup. */
export function renderChaserEmailHtml(body: string, opts: { portalLink?: string | null; accent?: string | null } = {}): string {
  const paras = body.split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 14px;line-height:1.6;color:#1F2937;font-size:14px">${escapeChaserHtml(p).replace(/\n/g, '<br/>')}</p>`,
  ).join('');

  const accent = /^#[0-9a-fA-F]{6}$/.test(opts.accent ?? '') ? opts.accent! : '#7C3AED';
  const button = opts.portalLink
    ? `<p style="margin:18px 0 4px"><a href="${escapeChaserHtml(opts.portalLink)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px;font-size:14px">View &amp; pay invoice</a></p>`
    : '';

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:8px 4px">${paras}${button}</div>`;
}

export async function sendChaserEmail(opts: ChaserEmailOptions) {
  const resend = getResend();
  const base = process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const addr = base.includes('<') ? base.slice(base.indexOf('<') + 1, base.indexOf('>')) : base;
  const fromName = opts.fromName.replace(/[<>]/g, '').trim() || 'Accounts';

  const { error } = await resend.emails.send({
    from: `${fromName} <${addr}>`,
    to: opts.to,
    subject: opts.subject,
    html: renderChaserEmailHtml(opts.body, { portalLink: opts.portalLink, accent: opts.accent }),
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  });
  if (error) throw new Error(`Failed to send chaser: ${error.message}`);
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

// Render the client-step-complete notification (subject + HTML) without sending.
export function renderClientStepCompleteEmail(opts: ClientStepCompleteEmailOptions): { subject: string; html: string } {
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

  return { subject: `[SMITH] Client completed: ${opts.stepTitle}`, html };
}

// Resend path — kept for any non-task caller. The client task flow now sends
// this via the task's resolved Gmail sender (see the complete route).
export async function sendClientStepCompleteEmail(opts: ClientStepCompleteEmailOptions) {
  const resend = getResend();
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const { subject, html } = renderClientStepCompleteEmail(opts);

  const { error } = await resend.emails.send({ from: fromAddress, to: opts.to, subject, html });
  if (error) throw new Error(`Failed to send client-complete email: ${error.message}`);
}

// ─── Password reset email ────────────────────────────────────────────────────
export interface PasswordResetEmailOptions {
  to: string;
  recipientName: string | null;
  /** Fully-qualified link to /auth/confirm with the recovery token_hash. */
  resetUrl: string;
  /** True when an admin triggered the reset (changes the copy slightly). */
  byAdmin?: boolean;
  fromAddress?: string;
}

export async function sendPasswordResetEmail(opts: PasswordResetEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const greeting = opts.recipientName ? `Hello ${escapeHtml(opts.recipientName)},` : 'Hello,';
  const lead = opts.byAdmin
    ? 'A password reset has been requested for your SMITH account by an administrator at your firm.'
    : 'We received a request to reset the password for your SMITH account.';

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">SMITH — Reset your password</h1>
      </div>
      <div style="padding:24px;">
        <p style="color:#111827;font-size:16px;margin:0 0 8px;">${greeting}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;line-height:1.6;">${lead} Click the button below to choose a new password. This link can only be used once and will expire shortly for your security.</p>
        <a href="${opts.resetUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">Reset password</a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or paste this link into your browser: <span style="word-break:break-all;">${opts.resetUrl}</span></p>
        <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">This email was sent from SMITH.</p>
      </div>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: '[SMITH] Reset your password',
    html,
  });
  if (error) throw new Error(`Failed to send password reset email: ${error.message}`);
}

// ─── Team invite email ───────────────────────────────────────────────────────
export interface InviteEmailOptions {
  to: string;
  recipientName: string | null;
  /** The inviting firm's name, for the email copy. */
  firmName: string | null;
  /** Fully-qualified link to /auth/confirm that lands on the set-password page. */
  inviteUrl: string;
  fromAddress?: string;
}

export async function sendInviteEmail(opts: InviteEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const greeting = opts.recipientName ? `Hello ${escapeHtml(opts.recipientName)},` : 'Hello,';
  const firm = opts.firmName ? escapeHtml(opts.firmName) : 'your firm';

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">SMITH — You're invited</h1>
      </div>
      <div style="padding:24px;">
        <p style="color:#111827;font-size:16px;margin:0 0 8px;">${greeting}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;line-height:1.6;">You've been invited to join <strong>${firm}</strong> on SMITH — the AI-powered workspace for accountancy firms. Click below to set your password and get started. This link can only be used once and will expire shortly for your security.</p>
        <a href="${opts.inviteUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">Accept invite &amp; set password</a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or paste this link into your browser: <span style="word-break:break-all;">${opts.inviteUrl}</span></p>
        <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">If you weren't expecting this, you can safely ignore this email.</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">This email was sent from SMITH.</p>
      </div>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: '[SMITH] You\'ve been invited to join SMITH',
    html,
  });
  if (error) throw new Error(`Failed to send invite email: ${error.message}`);
}

// ─── Magic-link sign-in email ────────────────────────────────────────────────
export interface MagicLinkEmailOptions {
  to: string;
  recipientName: string | null;
  /** Fully-qualified link to /auth/confirm with the magiclink token_hash. */
  magicUrl: string;
  fromAddress?: string;
}

export async function sendMagicLinkEmail(opts: MagicLinkEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const greeting = opts.recipientName ? `Hello ${escapeHtml(opts.recipientName)},` : 'Hello,';

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">SMITH — Sign in</h1>
      </div>
      <div style="padding:24px;">
        <p style="color:#111827;font-size:16px;margin:0 0 8px;">${greeting}</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;line-height:1.6;">Click the button below to sign in to your SMITH account. This link can only be used once and will expire shortly for your security.</p>
        <a href="${opts.magicUrl}" style="display:inline-block;background:#4F46E5;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">Sign in to SMITH</a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or paste this link into your browser: <span style="word-break:break-all;">${opts.magicUrl}</span></p>
        <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">This email was sent from SMITH.</p>
      </div>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: '[SMITH] Your sign-in link',
    html,
  });
  if (error) throw new Error(`Failed to send magic link email: ${error.message}`);
}

// ─── Manager briefing notification ───────────────────────────────────────────
export interface ManagerBriefingEmailOptions {
  to: string;
  briefingId: string;
  fromAddress?: string;
}

export async function sendManagerBriefingEmail(opts: ManagerBriefingEmailOptions) {
  const resend = getResend();
  const fromAddress = opts.fromAddress ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const baseUrl = getBaseUrl();
  // Deep-link straight to the Manager Briefings section. Clicked inside SMITH's
  // Email Triage this opens the HR tab on that section; clicked from a real
  // inbox it lands here after login (middleware preserves the destination).
  const link = `${baseUrl}/hr?tab=resources&section=briefings`;

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

// ─── Proposal delivery email ─────────────────────────────────────────────────
export interface ProposalEmailOptions {
  firmId: string;
  to: string;
  proposalTitle: string;
  prospectName: string;
  firmName: string;
  senderName: string | null;
  intro: string | null;
  acceptUrl: string;
}

/** Render the proposal email body + subject without dispatching. The
 *  prepare_only path in /api/proposals/[id]/send uses this so the in-app
 *  Compose window can take the rendered email and send via the user's own
 *  Gmail rather than going through Resend. */
export async function renderProposalEmail(opts: ProposalEmailOptions): Promise<{ subject: string; html: string }> {
  const color = await getBrandColor(opts.firmId, '#0ea5e9');
  const introBlock = opts.intro
    ? `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(opts.intro)}</p>`
    : '';
  const html = `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:${color};color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">A proposal from ${escapeHtml(opts.firmName)}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">Hi ${escapeHtml(opts.prospectName.split(' ')[0])},</p>
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">${opts.senderName ? `${escapeHtml(opts.senderName)} at ${escapeHtml(opts.firmName)}` : escapeHtml(opts.firmName)} has prepared a proposal for you: <strong>${escapeHtml(opts.proposalTitle)}</strong>.</p>
        ${introBlock}
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">Click below to review the proposal and let us know if you would like to proceed. There is a signature box on the page if you choose to accept.</p>
        <a href="${opts.acceptUrl}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View proposal</a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or paste this link into your browser: <span style="word-break:break-all;">${opts.acceptUrl}</span></p>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by SMITH on behalf of ${escapeHtml(opts.firmName)}.</p>
      </div>
    </div>
  `;
  const subject = resolveProposalSubject(
    await getProposalSubject(opts.firmId, 'proposal'),
    `Proposal from {firm} — {proposal}`,
    { firm_name: opts.firmName, prospect_name: opts.prospectName, proposal_title: opts.proposalTitle },
  );
  return { subject, html };
}

export async function sendProposalEmail(opts: ProposalEmailOptions) {
  const { subject, html } = await renderProposalEmail(opts);
  await dispatchProposalEmail({ firmId: opts.firmId, to: opts.to, subject, html });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// ─── Proposal email dispatcher ───────────────────────────────────────────────
// Sends a proposal-related email either via the firm's linked Gmail (when an
// email_connections row is wired up to firm_proposal_settings.proposal_email_sender_user_id)
// or via Resend as a fallback. Used by all three proposal email senders below.
interface ProposalDispatch {
  firmId: string;
  to: string;
  subject: string;
  html: string;
  fromAddressOverride?: string | null;  // explicit firm_proposal_settings.email_from_address override
}

async function dispatchProposalEmail(opts: ProposalDispatch): Promise<{ via: 'gmail' | 'resend'; senderEmail: string }> {
  const service = createServiceClient();
  const { data: settings } = await service
    .from('firm_proposal_settings')
    .select('proposal_email_sender_connection_id, email_from_address')
    .eq('firm_id', opts.firmId)
    .maybeSingle();

  const connectionId = (settings as { proposal_email_sender_connection_id?: string | null } | null)?.proposal_email_sender_connection_id ?? null;
  const overrideFrom = opts.fromAddressOverride ?? (settings?.email_from_address ?? null);

  // ── Try the dedicated proposals Gmail connection if configured ───────
  if (connectionId) {
    const { data: conn } = await service
      .from('proposal_email_connections')
      .select('id, refresh_token, google_email')
      .eq('id', connectionId)
      .maybeSingle();
    if (conn?.refresh_token && conn.google_email) {
      try {
        const { gmail, accessToken } = await getRefreshedGmailClient(conn.refresh_token);
        const raw = buildRawMessage({
          from: conn.google_email,
          to: [opts.to],
          subject: opts.subject,
          htmlBody: opts.html,
        });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
        await service
          .from('proposal_email_connections')
          .update({ access_token: accessToken, updated_at: new Date().toISOString() })
          .eq('id', conn.id);
        return { via: 'gmail', senderEmail: conn.google_email };
      } catch (e) {
        console.error('[proposals/dispatchEmail] Gmail send failed, falling back to Resend:', e);
        // fall through to Resend
      }
    }
  }

  // ── Resend fallback ──────────────────────────────────────────────────
  const resend = getResend();
  const fromAddress = overrideFrom ?? process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) throw new Error(`Failed to send email: ${error.message}`);
  return { via: 'resend', senderEmail: fromAddress };
}

/** Resolve merge tags in a subject template. Supports {firm}, {firm_name}, {prospect}, {prospect_name}, {proposal}, {proposal_title}. */
export function resolveProposalSubject(
  template: string | null | undefined,
  fallback: string,
  vars: { firm_name: string; prospect_name: string; proposal_title: string },
): string {
  const t = (template && template.trim()) ? template : fallback;
  return t
    .replace(/\{\{?\s*firm(?:_name)?\s*\}?\}/gi, vars.firm_name)
    .replace(/\{\{?\s*prospect(?:_name)?\s*\}?\}/gi, vars.prospect_name)
    .replace(/\{\{?\s*proposal(?:_title)?\s*\}?\}/gi, vars.proposal_title);
}

async function getProposalSubject(firmId: string, kind: 'proposal' | 'reminder' | 'onboarding'): Promise<string | null> {
  const service = createServiceClient();
  const col = kind === 'proposal' ? 'subject_proposal' : kind === 'reminder' ? 'subject_reminder' : 'subject_onboarding';
  const { data } = await service.from('firm_proposal_settings').select(col).eq('firm_id', firmId).maybeSingle();
  return (data as Record<string, string | null> | null)?.[col] ?? null;
}

async function getProposalBody(firmId: string, kind: 'reminder' | 'onboarding'): Promise<string | null> {
  const service = createServiceClient();
  const col = kind === 'reminder' ? 'body_reminder' : 'body_onboarding';
  const { data } = await service.from('firm_proposal_settings').select(col).eq('firm_id', firmId).maybeSingle();
  return (data as Record<string, string | null> | null)?.[col] ?? null;
}

async function getBrandColor(firmId: string, fallback: string): Promise<string> {
  const service = createServiceClient();
  const { data } = await service.from('firm_proposal_settings').select('brand_primary_color').eq('firm_id', firmId).maybeSingle();
  const c = (data as { brand_primary_color?: string | null } | null)?.brand_primary_color ?? null;
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback;
}

// ─── Post-acceptance onboarding-link email ───────────────────────────────────
export interface ProposalOnboardingEmailOptions {
  firmId: string;
  to: string;
  prospectName: string;
  firmName: string;
  onboardingUrl: string;
}

export async function sendProposalOnboardingEmail(opts: ProposalOnboardingEmailOptions) {
  const body = (await getProposalBody(opts.firmId, 'onboarding'))
    ?? 'Thanks for accepting our proposal. To get you set up properly, please fill in our short onboarding form using the link below. It collects the details we need to start the engagement.';
  const color = await getBrandColor(opts.firmId, '#10b981');
  const html = `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:${color};color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">Welcome aboard — one last form</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">Hi ${escapeHtml(opts.prospectName.split(' ')[0])},</p>
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(body)}</p>
        <a href="${opts.onboardingUrl}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Open onboarding form</a>
        <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Or paste this link into your browser: <span style="word-break:break-all;">${opts.onboardingUrl}</span></p>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by SMITH on behalf of ${escapeHtml(opts.firmName)}.</p>
      </div>
    </div>
  `;
  const subject = resolveProposalSubject(
    await getProposalSubject(opts.firmId, 'onboarding'),
    `Welcome to {firm} — onboarding form`,
    { firm_name: opts.firmName, prospect_name: opts.prospectName, proposal_title: '' },
  );
  await dispatchProposalEmail({ firmId: opts.firmId, to: opts.to, subject, html });
}

// ─── Proposal reminder email ─────────────────────────────────────────────────
export interface ProposalReminderEmailOptions {
  firmId: string;
  to: string;
  proposalTitle: string;
  prospectName: string;
  firmName: string;
  senderName: string | null;
  acceptUrl: string;
  customMessage: string | null;
}

// ─── Waitlist emails (pre-launch marketing) ──────────────────────────────────

/** Confirmation sent to someone who joins the pre-launch waitlist. */
export async function sendWaitlistConfirmationEmail(opts: { to: string }) {
  const resend = getResend();
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:20px 24px;">
        <h1 style="color:#fff;margin:0;font-size:18px;font-weight:600;">SMITH — You're on the list</h1>
      </div>
      <div style="padding:24px;">
        <p style="color:#111827;font-size:16px;margin:0 0 8px;">Thanks for your interest in SMITH.</p>
        <p style="color:#374151;font-size:14px;margin:0 0 20px;line-height:1.6;">You've been added to our waitlist. SMITH is the all-in-one AI workspace for accounting firms — built by accountants, for accountants. We're putting the finishing touches to it now, and we'll email you the moment it's open to new firms. No spam in the meantime.</p>
        <p style="color:#6b7280;font-size:13px;margin:0;">— The SMITH team</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">You received this because you asked to be notified when SMITH launches. If that wasn't you, you can ignore this email.</p>
      </div>
    </div>
  `;
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: opts.to,
    subject: "[SMITH] You're on the waitlist",
    html,
  });
  if (error) throw new Error(`Failed to send waitlist confirmation: ${error.message}`);
}

/** Internal notification to the team when someone joins the waitlist. */
export async function sendWaitlistNotificationEmail(opts: { email: string; firmName?: string | null; source?: string | null }) {
  const resend = getResend();
  const fromAddress = process.env.RESEND_FROM_ADDRESS ?? 'SMITH <hello@smithforaccountants.co.uk>';
  const notifyTo = process.env.WAITLIST_NOTIFY_ADDRESS ?? 'hello@smithforaccountants.co.uk';
  const rows = [
    ['Email', opts.email],
    ['Firm', opts.firmName || '—'],
    ['Source', opts.source || '—'],
  ]
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${k}</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(v)}</td></tr>`)
    .join('');
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <div style="background:#4F46E5;padding:16px 24px;">
        <h1 style="color:#fff;margin:0;font-size:16px;font-weight:600;">New waitlist signup</h1>
      </div>
      <div style="padding:20px 24px;">
        <table style="border-collapse:collapse;">${rows}</table>
      </div>
    </div>
  `;
  const { error } = await resend.emails.send({
    from: fromAddress,
    to: notifyTo,
    subject: `[SMITH] New waitlist signup: ${opts.email}`,
    html,
  });
  if (error) throw new Error(`Failed to send waitlist notification: ${error.message}`);
}

export async function sendProposalReminderEmail(opts: ProposalReminderEmailOptions) {
  const firmDefault = await getProposalBody(opts.firmId, 'reminder');
  const messageText = opts.customMessage
    ?? firmDefault
    ?? "Just a quick nudge in case our earlier email got buried — the proposal is still open and we'd love your decision when you've had a chance to review it.";
  const messageBlock = `<p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-wrap;">${escapeHtml(messageText)}</p>`;
  const color = await getBrandColor(opts.firmId, '#0ea5e9');
  const html = `
    <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
      <div style="background:${color};color:#fff;padding:20px 24px;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">A quick reminder from ${escapeHtml(opts.firmName)}</h1>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">Hi ${escapeHtml(opts.prospectName.split(' ')[0])},</p>
        ${messageBlock}
        <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">Your proposal — <strong>${escapeHtml(opts.proposalTitle)}</strong> — is still available below.</p>
        <a href="${opts.acceptUrl}" style="display:inline-block;background:${color};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View proposal</a>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">Sent by SMITH on behalf of ${escapeHtml(opts.firmName)}${opts.senderName ? ` · ${escapeHtml(opts.senderName)}` : ''}.</p>
      </div>
    </div>
  `;
  const subject = resolveProposalSubject(
    await getProposalSubject(opts.firmId, 'reminder'),
    `Reminder: {proposal}`,
    { firm_name: opts.firmName, prospect_name: opts.prospectName, proposal_title: opts.proposalTitle },
  );
  await dispatchProposalEmail({ firmId: opts.firmId, to: opts.to, subject, html });
}
