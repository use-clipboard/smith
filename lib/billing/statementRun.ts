// Billing module — sending statements, by hand or on a schedule.
//
// Statements go from the firm's own Gmail (the same mailbox invoices use), not
// Resend, because a statement is a client-facing account document and replies
// belong with the firm. That means a firm with no mailbox connected can't send
// statements — the run reports that rather than failing silently.
//
// The scheduled run is idempotent per (client, day) via billing_statement_runs:
// a cron that fires twice must never email a client twice.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtPence } from './totals';
import { buildStatement } from './statement';
import { buildStatementEmailHtml } from './statementHtml';
import { resolveStatementMergeTags, type StatementMergeContext } from './statementMergeTags';
import { getOrCreatePortalLink } from './portalLink';
import { isStatementDueToday } from './statementSchedule';
import { DEFAULT_STATEMENT_EMAIL_SUBJECT, DEFAULT_STATEMENT_EMAIL_BODY, type StatementMode } from './types';
import { resolveTaskEmailSender } from '@/lib/tasks/taskEmailSender';
import { buildRawMessage } from '@/lib/gmail';

export interface StatementConfig {
  firm_id: string;
  statement_mode: StatementMode | null;
  statement_period_months: number | null;
  statement_auto_enabled: boolean | null;
  statement_frequency: 'weekly' | 'monthly' | null;
  statement_day: number | null;
  statement_min_balance_pence: number | null;
  statement_email_subject: string | null;
  statement_email_body: string | null;
  email_sender_mailbox_id: string | null;
  business_name: string | null;
  invoice_accent: string | null;
}

export const STATEMENT_CONFIG_COLUMNS =
  'firm_id, statement_mode, statement_period_months, statement_auto_enabled, statement_frequency, ' +
  'statement_day, statement_min_balance_pence, statement_email_subject, statement_email_body, ' +
  'email_sender_mailbox_id, business_name, invoice_accent';

function ukDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export { isStatementDueToday };

export interface SendStatementResult {
  ok: boolean;
  error?: string;
  sentTo?: string;
  outstandingPence?: number;
}

/**
 * Build and send one client's statement. Shared by the manual action and the
 * scheduled run — so what a client receives never depends on which fired it.
 */
export async function sendStatementToClient(
  supabase: SupabaseClient,
  args: {
    firmId: string;
    clientId: string;
    cfg: StatementConfig;
    firmName: string;
    trigger: 'auto' | 'manual';
    today?: string;
    userId?: string | null;
    /** Overrides from the send modal (test what's on screen). */
    subject?: string;
    body?: string;
    /** Client-rendered statement PDF. The cron has no browser, so it sends none. */
    pdfBase64?: string;
  },
): Promise<SendStatementResult> {
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const mode = (args.cfg.statement_mode ?? 'outstanding') as StatementMode;

  const { data: client } = await supabase
    .from('clients').select('name, contact_email').eq('id', args.clientId).eq('firm_id', args.firmId).maybeSingle();
  if (!client) return { ok: false, error: 'Client not found' };
  const to = (client.contact_email as string | null) || null;
  if (!to) return { ok: false, error: 'This client has no contact email on file' };

  if (!args.cfg.email_sender_mailbox_id) {
    return { ok: false, error: 'Connect a firm email for invoices in Settings → Billing → Emails first — statements send from the same mailbox.' };
  }

  const data = await buildStatement(supabase, {
    firmId: args.firmId, clientId: args.clientId, mode,
    periodMonths: args.cfg.statement_period_months ?? 3, today,
  });
  if (!data) return { ok: false, error: 'Could not build the statement' };

  const sender = await resolveTaskEmailSender({
    firmId: args.firmId, mode: 'specific', mailboxId: args.cfg.email_sender_mailbox_id, ownerUserId: null,
  });
  if (!sender.ok) return { ok: false, error: sender.reason };

  const portalLink = await getOrCreatePortalLink(supabase, {
    firmId: args.firmId, clientId: args.clientId, userId: args.userId ?? null,
  });

  const openCount = data.lines.filter(l => l.kind === 'invoice' && (l.balancePence ?? 1) > 0).length;
  const ctx: StatementMergeContext = {
    client_name: data.clientName,
    statement_date: ukDate(data.statementDate),
    amount_due: fmtPence(data.closingPence),
    period_from: ukDate(data.periodFrom),
    invoice_count: String(openCount),
    firm_name: args.firmName,
    portal_link: portalLink,
  };

  const subjectTpl = args.subject || args.cfg.statement_email_subject || DEFAULT_STATEMENT_EMAIL_SUBJECT;
  const bodyTpl = args.body || args.cfg.statement_email_body || DEFAULT_STATEMENT_EMAIL_BODY;
  const attachmentName = `Statement-${ukDate(data.statementDate)}.pdf`;
  const attachments = args.pdfBase64
    ? [{ filename: attachmentName, mimeType: 'application/pdf', data: Buffer.from(args.pdfBase64, 'base64') }]
    : [];

  const html = buildStatementEmailHtml({
    bodyText: resolveStatementMergeTags(bodyTpl, ctx),
    data,
    firmName: args.firmName,
    accent: args.cfg.invoice_accent,
    portalLink,
    hasAttachment: attachments.length > 0,
    attachmentName,
  });

  try {
    const raw = buildRawMessage({
      from: sender.fromEmail, to: [to],
      subject: resolveStatementMergeTags(subjectTpl, ctx),
      htmlBody: html, attachments,
    });
    await sender.gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  } catch (err) {
    console.error('statement send', args.clientId, err);
    return { ok: false, error: 'The email could not be sent — the firm mailbox may need reconnecting.' };
  }

  await supabase.from('billing_statement_runs').insert({
    firm_id: args.firmId, client_id: args.clientId, trigger: args.trigger, mode,
    outstanding_pence: data.outstandingPence, sent_to: to, created_by: args.userId ?? null,
  });

  return { ok: true, sentTo: to, outstandingPence: data.outstandingPence };
}

export interface StatementRunResult {
  sent: number;
  scanned: number;
  /** Firms due today but with no mailbox connected — they'd send nothing. */
  firmsBlocked: number;
}

/**
 * The scheduled run. Fires daily; each firm decides whether today is its day.
 * Only clients with an outstanding balance over the firm's threshold get one —
 * nobody wants to email a client to tell them they owe nothing.
 */
export async function runStatements(
  supabase: SupabaseClient,
  opts: { today?: string; firmId?: string } = {},
): Promise<StatementRunResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  let query = supabase.from('billing_settings').select(STATEMENT_CONFIG_COLUMNS).eq('statement_auto_enabled', true);
  if (opts.firmId) query = query.eq('firm_id', opts.firmId);
  const { data: firmSettings } = await query;
  if (!firmSettings?.length) return { sent: 0, scanned: 0, firmsBlocked: 0 };

  let sent = 0, scanned = 0, firmsBlocked = 0;

  for (const raw of firmSettings) {
    const cfg = raw as unknown as StatementConfig;
    if (!isStatementDueToday(cfg, today)) continue;
    if (!cfg.email_sender_mailbox_id) { firmsBlocked++; continue; }

    const firmId = cfg.firm_id;
    const minBalance = cfg.statement_min_balance_pence ?? 0;

    const { data: firm } = await supabase.from('firms').select('name').eq('id', firmId).maybeSingle();
    const firmName = cfg.business_name || firm?.name || 'Our practice';

    // Clients with something open. Driving off invoices (not the client list)
    // keeps the scan proportional to real debt, not headcount.
    const { data: invData } = await supabase
      .from('invoices')
      .select('client_id, total_pence, amount_paid_pence, credit_pence, status')
      .eq('firm_id', firmId)
      .in('status', ['sent', 'viewed', 'part_paid', 'overdue'])
      .limit(5000);

    const owed = new Map<string, number>();
    for (const r of invData ?? []) {
      if (!r.client_id) continue;
      const bal = r.total_pence - r.amount_paid_pence - (r.credit_pence ?? 0);
      if (bal > 0) owed.set(r.client_id as string, (owed.get(r.client_id as string) ?? 0) + bal);
    }

    for (const [clientId, balance] of owed) {
      scanned++;
      if (balance < minBalance) continue;

      // Already had one today? (A retry, or a manual send this morning.)
      const { data: already } = await supabase
        .from('billing_statement_runs')
        .select('id').eq('client_id', clientId).gte('sent_at', `${today}T00:00:00Z`).limit(1).maybeSingle();
      if (already) continue;

      const res = await sendStatementToClient(supabase, {
        firmId, clientId, cfg, firmName, trigger: 'auto', today, userId: null,
      });
      if (res.ok) sent++;
    }
  }

  return { sent, scanned, firmsBlocked };
}
