import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { sendTaskReminderEmail } from '@/lib/email';
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
        id, title, due_date,
        client:clients(name, client_ref, business_type, year_end, vat_number, companies_house_id, utr_number, paye_reference, contact_email, contact_number, address),
        firm:firms(email_from_name, email_from_address)
      ),
      step:task_steps(id, title, due_date, email_reminder_subject, email_reminder_message, is_client_step,
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://smithapp.co.uk';
  let processed = 0;
  let failed = 0;

  for (const reminder of reminders) {
    try {
      // Build a custom "from" address if the firm has configured one
      const firm = reminder.task?.firm;
      let fromAddress: string | undefined;
      if (firm?.email_from_address) {
        fromAddress = firm.email_from_name
          ? `${firm.email_from_name} <${firm.email_from_address}>`
          : firm.email_from_address;
      }

      const client = reminder.task?.client;
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

      await sendTaskReminderEmail({
        to: reminder.recipient_email,
        recipientName: reminder.recipient_name ?? 'Team Member',
        taskTitle: reminder.task?.title ?? 'Task',
        stepTitle: reminder.step?.title ?? 'Step',
        clientName: client?.name ?? null,
        dueDate: reminder.step?.due_date ?? reminder.task?.due_date ?? null,
        taskUrl,
        customSubject: reminder.step?.email_reminder_subject ?? null,
        customMessage: reminder.step?.email_reminder_message ?? null,
        fromAddress,
        mergeContext,
      });

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

  return NextResponse.json({ processed, failed });
}
