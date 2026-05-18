import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { getQuarterDates, taxYearLabel } from '@/lib/mtdIt/quarters';
import { renderTemplate, buildEmailHtml, formatDateUkForTemplate } from '@/lib/mtdIt/emailTemplates';
import { ensureMtdItFirmSettings } from '@/lib/mtdIt/firmSettings';

// ─── /api/cron/mtd-it-reminders ────────────────────────────────────────────
// Once per day: walk every firm with reminder_enabled, find approval rows
// that are still outstanding (sent, but not approved/changed/voided), and
// — if enough days have passed since the last touch — send a follow-up
// reminder email from the original preparer's Gmail.
//
// "Enough days" = firm.reminder_days, counted from sent_at on the first
// reminder and from last_reminder_at on subsequent ones. firm.reminder_max
// caps the total number of reminders per approval cycle (default 1, max 5).
//
// Each successful send bumps reminder_count + stamps last_reminder_at.
// Send failures (preparer's Gmail disconnected, transient 4xx/5xx) leave
// the counter untouched so the row is retried the next day.

export const maxDuration = 300;

// Match the CH-refresh cron's auth pattern.
function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[MTD IT Reminders] CRON_SECRET not set — allowing request.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

interface ApprovalRow {
  id: string;
  quarter_id: string;
  token: string;
  sent_by: string | null;
  sent_at: string;
  recipient_email: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
}

interface QuarterRow {
  id: string;
  tax_year: number;
  quarter: 1 | 2 | 3 | 4;
  status: string;
  clients: {
    name: string | null;
    client_ref: string | null;
    mtd_it_quarter_type: 'calendar' | 'standard' | null;
    firms: { name: string | null } | null;
  } | null;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const service = createServiceClient();
  const startedAt = Date.now();
  const summary: Array<{ approvalId: string; firmId: string; action: string; message?: string }> = [];

  // Firms with reminders enabled. Anything else is a quick skip.
  const { data: firms, error: firmsErr } = await service
    .from('mtd_it_firm_settings')
    .select('firm_id, reminder_enabled, reminder_days, reminder_max, reminder_subject, reminder_body, approval_email_subject, brand_primary_color, brand_logo_path')
    .eq('reminder_enabled', true);
  if (firmsErr) {
    console.error('[MTD IT Reminders] firms select', firmsErr);
    return NextResponse.json({ error: 'Failed to load firm settings' }, { status: 500 });
  }
  if (!firms || firms.length === 0) {
    return NextResponse.json({ message: 'No firms with reminders enabled' });
  }

  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');

  for (const firm of firms) {
    const settings = await ensureMtdItFirmSettings(firm.firm_id);
    const reminderDays = Number(firm.reminder_days ?? 7);
    const reminderMax  = Number(firm.reminder_max ?? 1);

    // Pull all currently-outstanding approvals for this firm in one go.
    // Filter the date-window check in JS — Postgres doesn't make "X days ago
    // from another column" a one-liner without an interval cast and we're
    // talking small tens of rows per firm at worst.
    const { data: approvals, error: aErr } = await service
      .from('mtd_it_quarter_approvals')
      .select('id, quarter_id, token, sent_by, sent_at, recipient_email, reminder_count, last_reminder_at, mtd_it_quarters!inner(id, tax_year, quarter, status, clients!inner(name, client_ref, mtd_it_quarter_type, firm_id, firms!inner(name)))')
      .is('voided_at', null)
      .is('approved_at', null)
      .is('changes_requested_at', null)
      .eq('mtd_it_quarters.clients.firm_id', firm.firm_id);
    if (aErr) {
      console.error('[MTD IT Reminders] approvals select', firm.firm_id, aErr);
      continue;
    }
    if (!approvals || approvals.length === 0) continue;

    for (const row of approvals) {
      const a = row as unknown as ApprovalRow & { mtd_it_quarters: QuarterRow };
      // Only chase quarters whose status is still 'sent'. Anything else
      // implies the workflow has moved on (admin re-saved as draft etc.).
      if (a.mtd_it_quarters.status !== 'sent') {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_status' });
        continue;
      }
      if ((a.reminder_count ?? 0) >= reminderMax) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_max' });
        continue;
      }
      const anchor = a.last_reminder_at ?? a.sent_at;
      const dueAt  = new Date(anchor);
      dueAt.setDate(dueAt.getDate() + reminderDays);
      if (Date.now() < dueAt.getTime()) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_not_due' });
        continue;
      }

      const c = a.mtd_it_quarters.clients;
      if (!c) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_no_client' });
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

      // Look up the original preparer's Gmail. Reminders go from the same
      // mailbox as the initial send so they appear as a reply on the same
      // thread in the client's inbox (or at least from a familiar address).
      const { data: connection } = await service
        .from('email_connections')
        .select('refresh_token, google_email')
        .eq('user_id', a.sent_by)
        .maybeSingle();
      if (!connection?.refresh_token || !connection.google_email) {
        summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'skipped_no_gmail', message: 'Preparer Gmail disconnected' });
        continue;
      }

      // Preparer display name (best-effort).
      const { data: preparer } = await service
        .from('users')
        .select('full_name, email')
        .eq('id', a.sent_by)
        .maybeSingle();
      const preparerName = (preparer?.full_name?.trim() || preparer?.email?.split('@')[0] || 'Your accountant');

      // Build template vars + render subject/body. Same renderTemplate +
      // buildEmailHtml as the initial send so the reminder feels like part
      // of the same thread visually.
      const year    = a.mtd_it_quarters.tax_year;
      const quarter = a.mtd_it_quarters.quarter;
      const range   = getQuarterDates(year, quarter, c.mtd_it_quarter_type ?? 'calendar');
      const approvalLink = `${siteBase || ''}/mtd-it/approve/${a.token}`;
      const vars = {
        client_name:    c.name ?? '',
        client_code:    c.client_ref ?? '',
        quarter_label:  `Q${quarter}`,
        tax_year_label: taxYearLabel(year),
        period_from:    formatDateUkForTemplate(range.from),
        period_to:      formatDateUkForTemplate(range.to),
        firm_name:      c.firms?.name ?? '',
        preparer_name:  preparerName,
        approval_link:  approvalLink,
      };

      const subject = renderTemplate(settings.reminder_subject, vars);
      const body    = renderTemplate(settings.reminder_body,    vars);

      // Optionally embed the firm logo so the reminder looks branded too.
      let logoDataUrl: string | null = null;
      if (settings.brand_logo_path) {
        try {
          const { data: logoBlob } = await service.storage.from('mtd-it-branding').download(settings.brand_logo_path);
          if (logoBlob) {
            const buf  = Buffer.from(await logoBlob.arrayBuffer());
            const mime = logoBlob.type || 'image/png';
            logoDataUrl = `data:${mime};base64,${buf.toString('base64')}`;
          }
        } catch { /* non-fatal */ }
      }

      const html = buildEmailHtml({
        firmName: c.firms?.name ?? '',
        subject,
        bodyText: body,
        summary:  [],
        cta: { label: 'Review and approve', url: approvalLink },
        footer: `If you didn't expect this email, please contact ${preparerName} at ${c.firms?.name ?? 'your accountant'}.`,
        brandHex: settings.brand_primary_color,
        logoDataUrl,
      });

      try {
        const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
        const raw = buildRawMessage({
          from:     connection.google_email,
          to:       [a.recipient_email],
          subject,
          htmlBody: html,
          // Deliberately no PDF attachment on the reminder — the client
          // already has it from the original send, and dropping the same
          // file every time clutters their inbox.
          attachments: [],
        });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      } catch (e) {
        console.error('[MTD IT Reminders] gmail send', a.id, e);
        summary.push({
          approvalId: a.id,
          firmId:     firm.firm_id,
          action:     'send_failed',
          message:    e instanceof Error ? e.message : 'gmail error',
        });
        continue;
      }

      // Record the send. reminder_count is a small int so the +1 race is
      // not a concern at any plausible scale.
      const { error: upErr } = await service
        .from('mtd_it_quarter_approvals')
        .update({
          reminder_count:   (a.reminder_count ?? 0) + 1,
          last_reminder_at: new Date().toISOString(),
        })
        .eq('id', a.id);
      if (upErr) {
        // The email went out but we couldn't bump the counter. Log and
        // carry on — worst case is the same reminder fires again tomorrow,
        // which is preferable to spamming after a counter-update fail.
        console.error('[MTD IT Reminders] counter update', a.id, upErr);
      }

      summary.push({ approvalId: a.id, firmId: firm.firm_id, action: 'sent' });
    }
  }

  return NextResponse.json({
    tickMs: Date.now() - startedAt,
    handled: summary.length,
    summary,
  });
}
