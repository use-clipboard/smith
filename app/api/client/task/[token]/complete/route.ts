import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';
import { renderClientStepCompleteEmail } from '@/lib/email';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';

// POST /api/client/task/[token]/complete
// Public — no auth. Marks the step done, notifies the assigned team member.
export async function POST(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServiceClient();
  const { token } = params;

  // Fetch token row
  const { data: tokenRow, error: tokenErr } = await supabase
    .from('task_client_tokens')
    .select(`
      id, expires_at, completed_at,
      task_id, step_id, firm_id,
      task:tasks(id, title, firm_id, created_by, email_sender_mode, email_sender_mailbox_id,
        client:clients(name)
      ),
      step:task_steps(id, title, assignee_id,
        assignee:users(id, email, full_name)
      )
    `)
    .eq('token', token)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  if (tokenRow.completed_at) {
    return NextResponse.json({ error: 'already_completed' }, { status: 409 });
  }

  const now = new Date().toISOString();

  // Mark the task_step as complete
  await supabase
    .from('task_steps')
    .update({ status: 'complete', completed_at: now })
    .eq('id', tokenRow.step_id);

  // Mark the token as completed
  await supabase
    .from('task_client_tokens')
    .update({ completed_at: now })
    .eq('id', tokenRow.id);

  // ── Notify the assigned team member ──────────────────────────────────────
  const step = tokenRow.step as unknown as {
    id: string; title: string; assignee_id: string | null;
    assignee: { id: string; email: string; full_name: string | null } | null;
  } | null;
  const task = tokenRow.task as unknown as {
    id: string; title: string; firm_id: string;
    created_by: string | null;
    email_sender_mode?: 'default' | 'owner' | 'specific';
    email_sender_mailbox_id?: string | null;
    client: { name: string } | null;
  } | null;
  const clientName = task?.client?.name ?? null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://smithforaccountants.co.uk';

  if (step?.assignee_id && step.assignee && task) {
    // In-app notification
    await createNotification({
      userId: step.assignee_id,
      firmId: tokenRow.firm_id,
      type: 'client_step_complete',
      title: `Client completed: ${step.title}`,
      body: `${clientName ? `${clientName} — ` : ''}${task.title}`,
      data: { task_id: task.id, step_id: step.id, task_link: `${appUrl}/tasks` },
    });

    // Email notification to the assignee — sent from the task's resolved Gmail
    // sender (off Resend). The in-app notification above is the fallback, so if
    // no sender is connected we just skip the email silently.
    try {
      const sender = await resolveTaskEmailSender({
        firmId: task.firm_id,
        mode: task.email_sender_mode ?? 'default',
        mailboxId: task.email_sender_mailbox_id ?? null,
        ownerUserId: task.created_by ?? step.assignee_id,
      });
      if (sender.ok) {
        const { subject, html } = renderClientStepCompleteEmail({
          to: step.assignee.email,
          recipientName: step.assignee.full_name ?? 'Team Member',
          stepTitle: step.title,
          taskTitle: task.title,
          clientName,
          taskUrl: `${appUrl}/tasks`,
        });
        const raw = buildRawMessage({ from: sender.fromEmail, to: [step.assignee.email], subject, htmlBody: html });
        await sender.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      }
    } catch (err) {
      // Non-critical — notification already sent in-app
      console.error('Failed to send client-step-complete email', err);
    }
  }

  return NextResponse.json({ success: true });
}
