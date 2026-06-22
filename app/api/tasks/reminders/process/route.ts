import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { renderTaskReminderEmail } from '@/lib/email';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';
import { createNotification } from '@/lib/notifications';
import type { MergeTagContext } from '@/lib/emailMergeTags';

// POST /api/tasks/reminders/process
// Called by Vercel Cron — processes pending email reminders that are due.
// Secured by CRON_SECRET header.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const supabase = createClient();
  const now = new Date().toISOString();

  // Fetch pending reminders due by now, joining through to the firm for custom email settings
  const { data: reminders, error } = await supabase
    .from('task_email_reminders')
    .select(`
      *,
      task:tasks(
        id, title, due_date, firm_id, created_by, email_sender_mode, email_sender_mailbox_id,
        client:clients(name, client_ref, business_type, year_end, vat_number, companies_house_id, utr_number, paye_reference, contact_email, contact_number, address),
        firm:firms(email_from_name, email_from_address)
      ),
      step:task_steps(id, title, due_date, email_reminder_subject, email_reminder_message, is_client_step, assignee_id,
        client_tokens:task_client_tokens(token, completed_at, expires_at)
      )
    `)
    .eq('status', 'pending')
    .lte('send_at', now)
    .limit(50);

  if (error) {
    console.error('reminders/process fetch', error);
    return NextResponse.json({ error: 'Failed to fetch reminders' }, { status: 500 });
  }

  if (!reminders || reminders.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://smithforaccountants.co.uk';
  let processed = 0;
  let failed = 0;
  let blocked = 0;

  for (const reminder of reminders) {
    try {
      const task = reminder.task as {
        id?: string; title?: string; due_date?: string | null;
        firm_id?: string; created_by?: string | null;
        email_sender_mode?: 'default' | 'owner' | 'specific';
        email_sender_mailbox_id?: string | null;
        client?: Record<string, string | null>;
      } | null;
      const client = task?.client;
      const mergeContext: MergeTagContext = {
        client_name:        client?.name            ?? null,
        client_ref:         client?.client_ref       ?? null,
        business_type:      client?.business_type    ?? null,
        year_end:           client?.year_end          ?? null,
        vat_number:         client?.vat_number        ?? null,
        companies_house_id: client?.companies_house_id ?? null,
        utr_number:         client?.utr_number        ?? null,
        paye_reference:     client?.paye_reference    ?? null,
        contact_email:      client?.contact_email     ?? null,
        contact_number:     client?.contact_number    ?? null,
        address:            client?.address           ?? null,
        recipient_name:     reminder.recipient_name   ?? null,
      };

      // For client steps, link directly to the client portal page via their token
      const step = reminder.step as {
        is_client_step?: boolean;
        assignee_id?: string | null;
        client_tokens?: Array<{ token: string; completed_at: string | null; expires_at: string }>;
      } | null;
      let taskUrl = `${appUrl}/tasks`;
      if (step?.is_client_step && step.client_tokens?.length) {
        // Use the most recent non-completed, non-expired token
        const validToken = step.client_tokens.find(t =>
          !t.completed_at && new Date(t.expires_at) > new Date()
        );
        if (validToken) taskUrl = `${appUrl}/client/task/${validToken.token}`;
      }

      // Resolve who this email sends from. Owner = the step's team assignee if
      // present, else the task creator. (No task-level assignee exists in the
      // schema, so created_by is the task's owner-of-record.)
      const ownerUserId = step?.assignee_id ?? task?.created_by ?? null;
      const sender = await resolveTaskEmailSender({
        firmId: task?.firm_id ?? '',
        mode: task?.email_sender_mode ?? 'default',
        mailboxId: task?.email_sender_mailbox_id ?? null,
        ownerUserId,
      });

      if (!sender.ok) {
        // Don't send via Resend — flag the owner instead so a real person fixes it.
        await supabase.from('task_email_reminders').update({ status: 'failed' }).eq('id', reminder.id);
        if (ownerUserId && task?.firm_id) {
          await createNotification({
            userId: ownerUserId,
            firmId: task.firm_id,
            type: 'task_email_blocked',
            title: `Couldn't send a task reminder for ${task?.title ?? 'a task'}`,
            body: `${sender.reason} Reminder to ${reminder.recipient_email} was not sent.`,
            data: { task_id: task?.id, task_link: `${appUrl}/tasks` },
          }).catch(() => {});
        }
        blocked++;
        continue;
      }

      const { subject, html } = renderTaskReminderEmail({
        to: reminder.recipient_email,
        recipientName: reminder.recipient_name ?? 'Team Member',
        taskTitle: task?.title ?? 'Task',
        stepTitle: reminder.step?.title ?? 'Step',
        clientName: client?.name ?? null,
        dueDate: reminder.step?.due_date ?? task?.due_date ?? null,
        taskUrl,
        customSubject: reminder.step?.email_reminder_subject ?? null,
        customMessage: reminder.step?.email_reminder_message ?? null,
        mergeContext,
      });

      const raw = buildRawMessage({
        from: sender.fromEmail,
        to: [reminder.recipient_email],
        subject,
        htmlBody: html,
      });
      await sender.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });

      await supabase.from('task_email_reminders').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      }).eq('id', reminder.id);

      processed++;
    } catch (err) {
      console.error('Failed to send reminder', reminder.id, err);
      await supabase.from('task_email_reminders').update({ status: 'failed' }).eq('id', reminder.id);
      failed++;
    }
  }

  return NextResponse.json({ processed, failed, blocked });
}
