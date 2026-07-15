import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { renderTemplate, buildEmailHtml, formatDateUkForTemplate } from '@/lib/mtdIt/emailTemplates';
import { ensureLandlordFirmSettings, getLandlordLogoDataUrl } from '@/lib/landlord/firmSettings';

// ─── /api/cron/landlord-reminders ──────────────────────────────────────────
// Daily twin of /api/cron/mtd-it-reminders, for property income computations.
// For every firm with reminder_enabled, find approvals that are still
// outstanding and chase them from the original preparer's Gmail.
//
// An approval is chased only when ALL of these hold:
//   • it was really SENT (sent_at not null) — a draft still sitting in someone's
//     compose window has never reached the client, so chasing them is nonsense;
//   • no response yet (not approved / changes-requested / voided);
//   • reminders_paused is false — the preparer switched chasing off for this
//     one, e.g. the client is signing a paper copy;
//   • reminder_count < firm.reminder_max;
//   • reminder_days have passed since sent_at (first) or last_reminder_at.
//
// Send failures leave the counter alone so the row is retried tomorrow.

export const maxDuration = 300;

function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[Landlord Reminders] CRON_SECRET not set — allowing request.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

interface OutputJoin {
  id: string;
  firm_id: string;
  client_name: string | null;
  result_data: { dateFrom?: string; dateTo?: string } | null;
  clients: { name: string | null; client_ref: string | null } | null;
  firms: { name: string | null } | null;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const service = createServiceClient();
  const startedAt = Date.now();
  const summary: Array<{ approvalId: string; firmId: string; action: string; message?: string }> = [];

  const { data: firms, error: firmsErr } = await service
    .from('landlord_firm_settings')
    .select('firm_id, reminder_days, reminder_max')
    .eq('reminder_enabled', true);
  if (firmsErr) {
    console.error('[Landlord Reminders] firms select', firmsErr);
    return NextResponse.json({ error: 'Failed to load firm settings' }, { status: 500 });
  }
  if (!firms || firms.length === 0) {
    return NextResponse.json({ message: 'No firms with reminders enabled' });
  }

  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');

  for (const firm of firms) {
    const settings = await ensureLandlordFirmSettings(firm.firm_id);
    const reminderDays = Number(firm.reminder_days ?? 7);
    const reminderMax  = Number(firm.reminder_max ?? 1);

    const { data: approvals, error: aErr } = await service
      .from('landlord_approvals')
      .select(`
        id, token, person_name, sent_by, sent_at, recipient_email, reminder_count, last_reminder_at, reminders_paused,
        outputs!inner(id, firm_id, client_name, result_data, clients(name, client_ref), firms!inner(name))
      `)
      .not('sent_at', 'is', null)
      .is('approved_at', null)
      .is('changes_requested_at', null)
      .is('voided_at', null)
      .eq('reminders_paused', false)
      .eq('outputs.firm_id', firm.firm_id);
    if (aErr) {
      console.error('[Landlord Reminders] approvals select', firm.firm_id, aErr);
      continue;
    }
    if (!approvals || approvals.length === 0) continue;

    // Only build the logo once per firm, not once per approval.
    let logoDataUrl: string | null = null;
    let logoResolved = false;

    for (const row of approvals) {
      const a = row as unknown as {
        id: string; token: string; person_name: string | null; sent_by: string | null;
        sent_at: string; recipient_email: string | null;
        reminder_count: number; last_reminder_at: string | null;
        outputs: OutputJoin;
      };

      if ((a.reminder_count ?? 0) >= reminderMax) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_max' });
        continue;
      }
      const anchor = a.last_reminder_at ?? a.sent_at;
      const dueAt = new Date(anchor);
      dueAt.setDate(dueAt.getDate() + reminderDays);
      if (Date.now() < dueAt.getTime()) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_not_due' });
        continue;
      }
      if (!a.recipient_email) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_no_email' });
        continue;
      }
      if (!a.sent_by) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_no_sender' });
        continue;
      }

      // Chase from the mailbox that sent it, so it lands as a familiar address.
      const { data: connection } = await service
        .from('email_connections')
        .select('refresh_token, google_email')
        .eq('user_id', a.sent_by)
        .maybeSingle();
      if (!connection?.refresh_token || !connection.google_email) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_no_gmail', message: 'Preparer Gmail disconnected' });
        continue;
      }

      const { data: preparer } = await service
        .from('users').select('full_name, email').eq('id', a.sent_by).maybeSingle();
      const preparerName = (preparer?.full_name?.trim() || preparer?.email?.split('@')[0] || 'Your accountant');

      const out = a.outputs;
      const clientName = out.clients?.name ?? out.client_name ?? '';
      const rd = out.result_data ?? {};
      const approvalLink = `${siteBase || ''}/landlord/approve/${a.token}`;
      const vars = {
        client_name:   clientName,
        client_code:   out.clients?.client_ref ?? '',
        person_name:   a.person_name || clientName,
        period_from:   rd.dateFrom ? formatDateUkForTemplate(rd.dateFrom) : '',
        period_to:     rd.dateTo ? formatDateUkForTemplate(rd.dateTo) : '',
        firm_name:     out.firms?.name ?? '',
        preparer_name: preparerName,
        approval_link: approvalLink,
      };

      const subject = renderTemplate(settings.reminder_subject, vars);
      const bodyText = renderTemplate(settings.reminder_body, vars);

      if (!logoResolved) {
        logoDataUrl = await getLandlordLogoDataUrl(firm.firm_id, settings);
        logoResolved = true;
      }

      const html = buildEmailHtml({
        firmName: out.firms?.name ?? '',
        subject,
        bodyText,
        summary: [],
        cta: { label: 'Review and approve', url: approvalLink },
        footer: `If you didn't expect this email, please contact ${preparerName} at ${out.firms?.name ?? 'your accountant'}.`,
        brandHex: settings.brand_primary_color,
        logoDataUrl,
      });

      try {
        const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
        // No PDF on the reminder — the client already has it from the original
        // send, and re-attaching it every time just clutters their inbox.
        const raw = buildRawMessage({
          from: connection.google_email,
          to: [a.recipient_email],
          subject,
          htmlBody: html,
          attachments: [],
        });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      } catch (e) {
        console.error('[Landlord Reminders] gmail send', a.id, e);
        summary.push({
          approvalId: a.id, firmId: firm.firm_id, action: 'send_failed',
          message: e instanceof Error ? e.message : 'gmail error',
        });
        continue;
      }

      const { error: upErr } = await service
        .from('landlord_approvals')
        .update({ reminder_count: (a.reminder_count ?? 0) + 1, last_reminder_at: new Date().toISOString() })
        .eq('id', a.id);
      if (upErr) {
        // The email went out but the counter didn't move. Log it: worst case is
        // one repeat tomorrow, which beats silently spamming.
        console.error('[Landlord Reminders] counter update', a.id, upErr);
      }

      summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'sent' });
    }
  }

  return NextResponse.json({ tickMs: Date.now() - startedAt, handled: summary.length, summary });
}
