import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { renderTaskReminderEmail } from '@/lib/email';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';
import { createNotification } from '@/lib/notifications';

// POST /api/cron/timeout-conditions
// Runs daily via Vercel Cron. Finds task steps whose incoming timeout-condition
// edge has elapsed without the step being completed, and sends a reminder email.
// Secured by CRON_SECRET header.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const service = createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://smithforaccountants.co.uk';

  // 1. Fetch all timeout-condition edges, with task + step + client + assignee data
  const { data: edges, error: edgesError } = await service
    .from('task_step_edges')
    .select(`
      id,
      task_id,
      from_step_key,
      to_step_key,
      condition_config,
      task:tasks (
        id,
        title,
        firm_id,
        created_by,
        email_sender_mode,
        email_sender_mailbox_id,
        client:clients ( name, contact_email )
      )
    `)
    .eq('condition_type', 'timeout');

  if (edgesError) {
    console.error('timeout-conditions: fetch edges', edgesError);
    return NextResponse.json({ error: 'Failed to fetch edges' }, { status: 500 });
  }

  if (!edges || edges.length === 0) {
    return NextResponse.json({ processed: 0, skipped: 0, failed: 0 });
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const edge of edges) {
    try {
      // Parse timeout duration — default to 1 day if nothing configured
      const cfg = edge.condition_config as { timeout_days?: number; timeout_hours?: number } | null;
      const timeoutMs =
        ((cfg?.timeout_days ?? 1) * 24 * 60 + (cfg?.timeout_hours ?? 0) * 60) * 60 * 1000;

      if (timeoutMs <= 0) { skipped++; continue; }

      // 2. Find the target step for this edge (not yet complete or skipped)
      const { data: step } = await service
        .from('task_steps')
        .select(`
          id,
          step_key,
          title,
          status,
          is_client_step,
          assignee_id,
          email_reminder_subject,
          email_reminder_message,
          created_at,
          assignee:users ( email, full_name ),
          client_tokens:task_client_tokens ( token, completed_at, expires_at )
        `)
        .eq('task_id', edge.task_id)
        .eq('step_key', edge.to_step_key)
        .not('status', 'in', '("complete","skipped")')
        .maybeSingle();

      if (!step) { skipped++; continue; }

      // 3. Check if the timeout period has actually elapsed
      const stepAge = Date.now() - new Date(step.created_at).getTime();
      if (stepAge < timeoutMs) { skipped++; continue; }

      // 4. Check we haven't already sent a timeout reminder for this (step, edge)
      const { data: existing } = await service
        .from('task_timeout_triggers')
        .select('id')
        .eq('task_step_id', step.id)
        .eq('edge_from_key', edge.from_step_key)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      // 5. Determine recipient
      const task = edge.task as unknown as {
        id: string;
        title: string;
        firm_id: string;
        created_by: string | null;
        email_sender_mode?: 'default' | 'owner' | 'specific';
        email_sender_mailbox_id?: string | null;
        client: { name: string; contact_email: string | null } | null;
      } | null;

      const assignee = step.assignee as unknown as { email: string; full_name: string | null } | null;
      const client = task?.client ?? null;

      let recipientEmail: string | null = null;
      let recipientName: string = 'Team Member';

      if (step.is_client_step && client?.contact_email) {
        recipientEmail = client.contact_email;
        recipientName = client.name ?? 'Client';
      } else if (assignee?.email) {
        recipientEmail = assignee.email;
        recipientName = assignee.full_name ?? assignee.email;
      }

      if (!recipientEmail) { skipped++; continue; }

      // 6. Build the portal URL (use client token if this is a client step)
      let taskUrl = `${appUrl}/tasks`;
      if (step.is_client_step) {
        const tokens = step.client_tokens as Array<{
          token: string; completed_at: string | null; expires_at: string;
        }> | null;
        const validToken = tokens?.find(t => !t.completed_at && new Date(t.expires_at) > new Date());
        if (validToken) taskUrl = `${appUrl}/client/task/${validToken.token}`;
      }

      // 7. Resolve the Gmail sender for this task (owner / specific mailbox /
      //    firm default). Owner = task creator, else the step assignee.
      const ownerUserId = task?.created_by ?? step.assignee_id ?? null;
      const sender = await resolveTaskEmailSender({
        firmId: task?.firm_id ?? '',
        mode: task?.email_sender_mode ?? 'default',
        mailboxId: task?.email_sender_mailbox_id ?? null,
        ownerUserId,
      });

      const timeoutLabel = cfg?.timeout_days
        ? `${cfg.timeout_days} day${cfg.timeout_days !== 1 ? 's' : ''}`
        : `${cfg?.timeout_hours ?? 24} hour${(cfg?.timeout_hours ?? 24) !== 1 ? 's' : ''}`;

      // 8. If no sender is connected, don't send via Resend — flag the owner and
      //    record the trigger so we neither resend nor re-flag daily.
      if (!sender.ok) {
        if (ownerUserId && task?.firm_id) {
          await createNotification({
            userId: ownerUserId,
            firmId: task.firm_id,
            type: 'task_email_blocked',
            title: `Couldn't send a task reminder for ${task?.title ?? 'a task'}`,
            body: `${sender.reason} The timeout reminder to ${recipientEmail} was not sent.`,
            data: { task_id: task?.id, task_link: `${appUrl}/tasks` },
          }).catch(() => {});
        }
        await service.from('task_timeout_triggers').insert({ task_step_id: step.id, edge_from_key: edge.from_step_key });
        skipped++;
        continue;
      }

      // 9. Send via Gmail, then record the trigger so we don't resend.
      const { subject, html } = renderTaskReminderEmail({
        to: recipientEmail,
        recipientName,
        taskTitle: task?.title ?? 'Task',
        stepTitle: step.title,
        clientName: client?.name ?? null,
        dueDate: null,
        taskUrl,
        customSubject: step.email_reminder_subject ?? null,
        customMessage: step.email_reminder_message
          ?? `This is an automated reminder — this step has been waiting for more than ${timeoutLabel} without a response. Please action it at your earliest convenience.`,
      });
      const raw = buildRawMessage({ from: sender.fromEmail, to: [recipientEmail], subject, htmlBody: html });
      await sender.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

      await service.from('task_timeout_triggers').insert({
        task_step_id: step.id,
        edge_from_key: edge.from_step_key,
      });

      processed++;
    } catch (err) {
      console.error('timeout-conditions: failed for edge', edge.id, err);
      failed++;
    }
  }

  return NextResponse.json({ processed, skipped, failed });
}
