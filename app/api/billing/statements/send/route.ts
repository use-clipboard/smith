// Billing module — send one client's statement by hand.
//
// GET  ?clientId=… → the statement data + resolved subject/body + any blocker,
//                    so the modal can preview it and render the PDF.
// POST             → send it, with the caller-rendered PDF attached.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { fmtPence } from '@/lib/billing/totals';
import { buildStatement } from '@/lib/billing/statement';
import { sendStatementToClient, STATEMENT_CONFIG_COLUMNS, type StatementConfig } from '@/lib/billing/statementRun';
import { resolveStatementMergeTags, type StatementMergeContext } from '@/lib/billing/statementMergeTags';
import { DEFAULT_STATEMENT_EMAIL_SUBJECT, DEFAULT_STATEMENT_EMAIL_BODY, type StatementMode } from '@/lib/billing/types';

function ukDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

async function loadConfig(supabase: ReturnType<typeof createClient>, firmId: string) {
  const [{ data: cfgRow }, { data: firm }] = await Promise.all([
    supabase.from('billing_settings').select(STATEMENT_CONFIG_COLUMNS).eq('firm_id', firmId).maybeSingle(),
    supabase.from('firms').select('name').eq('id', firmId).maybeSingle(),
  ]);
  const cfg = (cfgRow ?? { firm_id: firmId }) as unknown as StatementConfig;
  const firmName = cfg.business_name || firm?.name || 'Our practice';
  return { cfg, firmName };
}

// GET — preview payload for the send modal.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const supabase = createClient();
  const { cfg, firmName } = await loadConfig(supabase, ctx.firmId);
  const mode = (cfg.statement_mode ?? 'outstanding') as StatementMode;

  const [{ data: client }, data] = await Promise.all([
    supabase.from('clients').select('name, contact_email, client_ref').eq('id', clientId).eq('firm_id', ctx.firmId).maybeSingle(),
    buildStatement(supabase, { firmId: ctx.firmId, clientId, mode, periodMonths: cfg.statement_period_months ?? 3 }),
  ]);
  if (!client || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let senderEmail: string | null = null;
  if (cfg.email_sender_mailbox_id) {
    const { data: mb } = await supabase
      .from('firm_sending_mailboxes').select('google_email').eq('id', cfg.email_sender_mailbox_id).eq('firm_id', ctx.firmId).maybeSingle();
    senderEmail = (mb?.google_email as string | null) ?? null;
  }

  const openCount = data.lines.filter(l => l.kind === 'invoice' && (l.balancePence ?? 1) > 0).length;
  const mergeCtx: StatementMergeContext = {
    client_name: data.clientName,
    client_code: (client.client_ref as string | null) ?? '',
    statement_date: ukDate(data.statementDate),
    amount_due: fmtPence(data.closingPence),
    period_from: ukDate(data.periodFrom),
    invoice_count: String(openCount),
    firm_name: firmName,
    portal_link: '',
  };

  const to = (client.contact_email as string | null) || null;
  const warning = !senderEmail
    ? 'No firm email is connected. Statements send from the same mailbox as invoices — connect one in Settings → Billing → Emails.'
    : !to ? 'This client has no email address on file.'
    : data.outstandingPence <= 0 ? 'This client has nothing outstanding — the statement will show a nil balance.'
    : null;

  return NextResponse.json({
    statement: data,
    firmName,
    to,
    senderEmail,
    subject: resolveStatementMergeTags(cfg.statement_email_subject || DEFAULT_STATEMENT_EMAIL_SUBJECT, mergeCtx),
    body: resolveStatementMergeTags(cfg.statement_email_body || DEFAULT_STATEMENT_EMAIL_BODY, mergeCtx),
    ready: !!senderEmail && !!to,
    warning,
  });
}

const SendSchema = z.object({
  clientId: z.string().uuid(),
  subject: z.string().max(300).optional(),
  body: z.string().max(6000).optional(),
  pdf_base64: z.string().max(14_000_000).optional(),
});

// POST — send the statement now.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = SendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const { cfg, firmName } = await loadConfig(supabase, ctx.firmId);

  const res = await sendStatementToClient(supabase, {
    firmId: ctx.firmId,
    clientId: parsed.data.clientId,
    cfg, firmName,
    trigger: 'manual',
    userId: ctx.userId,
    subject: parsed.data.subject,
    body: parsed.data.body,
    pdfBase64: parsed.data.pdf_base64,
  });

  if (!res.ok) return NextResponse.json({ error: res.error ?? 'Could not send the statement.' }, { status: 400 });
  return NextResponse.json({ ok: true, sentTo: res.sentTo });
}
