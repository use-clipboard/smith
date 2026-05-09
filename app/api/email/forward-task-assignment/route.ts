import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage, parseGmailMessage } from '@/lib/gmail';

const Schema = z.object({
  threadId: z.string().min(1),
  assigneeUserId: z.string().uuid(),
  taskTitle: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  steps: z.array(z.string()).default([]),
});

/**
 * POST /api/email/forward-task-assignment
 *
 * Auto-forwards an email thread to the user assigned to a freshly-created task,
 * with a header explaining who assigned it and what the task is. Sent from the
 * task creator's Gmail account so the recipient sees a familiar sender.
 *
 * Skipped client-side when the assignee is the creator themself, or when there
 * is no assignee — but we re-check both here.
 */
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { threadId, assigneeUserId, taskTitle, dueDate, steps } = parsed.data;

  if (assigneeUserId === ctx.userId) {
    return NextResponse.json({ error: 'Cannot forward task to yourself' }, { status: 400 });
  }

  const supabase = createClient();

  // Look up creator + assignee
  const { data: people } = await supabase
    .from('users')
    .select('id, email, full_name')
    .in('id', [ctx.userId, assigneeUserId]);
  const creator = people?.find(p => p.id === ctx.userId);
  const assignee = people?.find(p => p.id === assigneeUserId);
  if (!assignee?.email) {
    return NextResponse.json({ error: 'Assignee has no email address' }, { status: 404 });
  }

  // Get creator's Gmail connection
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

    // Fetch the thread → grab the most recent inbound (non-SENT) message
    const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
    const messages = (threadRes.data.messages ?? []).map(m =>
      parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
    );
    const original = messages.filter(m => !m.labelIds.includes('SENT')).pop() ?? messages[messages.length - 1];
    if (!original) {
      return NextResponse.json({ error: 'Thread has no messages' }, { status: 404 });
    }

    // Download attachments
    const attachments: Array<{ filename: string; mimeType: string; data: Buffer }> = [];
    for (const att of original.attachments) {
      if (!att.attachmentId) continue;
      try {
        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: att.messageId,
          id: att.attachmentId,
        });
        const dataB64 = attRes.data.data;
        if (!dataB64) continue;
        attachments.push({
          filename: att.filename,
          mimeType: att.mimeType,
          data: Buffer.from(dataB64, 'base64url'),
        });
      } catch (err) {
        console.error('Failed to download attachment', att.filename, err);
        // continue — partial forward is better than none
      }
    }

    // Build the message body
    const creatorName = creator?.full_name?.trim() || creator?.email || 'A teammate';
    const assigneeName = assignee.full_name?.trim() || assignee.email.split('@')[0];
    const dueLine = dueDate ? new Date(dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'No due date set';
    const stepsHtml = steps.length > 0
      ? `<ol style="margin: 8px 0 0 0; padding-left: 20px; color: #1f2937;">${steps.map(s => `<li style="margin-bottom: 4px;">${escapeHtml(s)}</li>`).join('')}</ol>`
      : '<p style="margin: 8px 0 0 0; color: #6b7280; font-style: italic;">No steps defined.</p>';

    const header = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb; margin-bottom: 16px;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #1f2937;">
          Hi ${escapeHtml(assigneeName)},
        </p>
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #1f2937;">
          <strong>${escapeHtml(creatorName)}</strong> has assigned you a task related to the email below.
        </p>
        <table style="margin: 0; padding: 0; border-collapse: collapse; font-size: 13px; color: #1f2937;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Task</td><td style="padding: 4px 0;"><strong>${escapeHtml(taskTitle)}</strong></td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Due</td><td style="padding: 4px 0;">${escapeHtml(dueLine)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280; vertical-align: top;">Steps</td><td style="padding: 4px 0;">${stepsHtml}</td></tr>
        </table>
        <p style="margin: 12px 0 0 0; font-size: 12px; color: #6b7280;">
          The original email is forwarded below — including any attachments and context you'll need.
        </p>
      </div>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
    `;

    const fwdHeader = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #6b7280; margin-bottom: 12px;">
        <p style="margin: 0 0 4px 0;"><strong>---------- Forwarded message ----------</strong></p>
        <p style="margin: 0;">From: ${escapeHtml(original.from.name ? `${original.from.name} <${original.from.email}>` : original.from.email)}</p>
        <p style="margin: 0;">Date: ${escapeHtml(original.date)}</p>
        <p style="margin: 0;">Subject: ${escapeHtml(original.subject)}</p>
        ${original.to.length ? `<p style="margin: 0;">To: ${escapeHtml(original.to.map(t => t.email).join(', '))}</p>` : ''}
      </div>
    `;

    const htmlBody = `${header}${fwdHeader}<div>${original.body}</div>`;

    const subject = `Task: ${taskTitle} — Fwd: ${original.subject}`;

    const raw = buildRawMessage({
      from: connection.google_email,
      to: [assignee.email],
      subject,
      htmlBody,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

    await supabase
      .from('email_connections')
      .update({ access_token: accessToken, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId);

    return NextResponse.json({ success: true, forwardedTo: assignee.email });
  } catch (err) {
    console.error('Forward task assignment error:', err);
    const message = err instanceof Error ? err.message.slice(0, 300) : 'Failed to forward email';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
