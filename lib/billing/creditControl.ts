// Billing module — credit-control chaser engine.
//
// A firm-editable ladder of reminder stages (credit_control_stages). The daily
// cron walks each firm's overdue invoices and fires the appropriate stage once
// (logged to credit_control_events). Idempotent per (invoice, stage_key): a
// stage never sends twice, and if the cron missed days only the latest-due
// stage sends (no burst). Uses a service-role client.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fmtPence, balancePence } from './totals';
import { getOrCreatePortalLink } from './portalLink';
import { sendChaserEmail } from '@/lib/email';

export interface StageSeed {
  stage_key: string;
  name: string;
  tone: 'friendly' | 'reminder' | 'firm' | 'final' | 'legal';
  offset_days: number;
  subject: string;
  body: string;
}

/** Default reminder ladder seeded on first use. All text is firm-editable after. */
export const DEFAULT_STAGES: StageSeed[] = [
  {
    stage_key: 'friendly', name: 'Friendly reminder', tone: 'friendly', offset_days: 1,
    subject: 'Invoice {{invoice_number}} — a quick reminder',
    body:
      "Hi {{client_name}},\n\nWe hope you're well. This is just a friendly reminder that invoice {{invoice_number}} for {{amount_due}} was due on {{due_date}}. If you've already arranged payment, thank you — please ignore this note.\n\nIf you have any questions, just reply to this email.\n\nKind regards,\n{{firm_name}}",
  },
  {
    stage_key: 'reminder', name: 'Reminder', tone: 'reminder', offset_days: 7,
    subject: 'Reminder: invoice {{invoice_number}} is now overdue',
    body:
      "Hi {{client_name}},\n\nOur records show invoice {{invoice_number}} for {{amount_due}}, due on {{due_date}}, is now {{days_overdue}} days overdue. We'd be grateful if you could arrange payment at your earliest convenience.\n\nIf anything is holding this up, please let us know.\n\nKind regards,\n{{firm_name}}",
  },
  {
    stage_key: 'firm', name: 'Firm reminder', tone: 'firm', offset_days: 14,
    subject: 'Overdue invoice {{invoice_number}} — please arrange payment',
    body:
      'Dear {{client_name}},\n\nInvoice {{invoice_number}} for {{amount_due}} is now {{days_overdue}} days overdue (due {{due_date}}). Please arrange payment within the next 7 days to bring your account up to date.\n\nIf payment has already been made, please let us know so we can update our records.\n\nRegards,\n{{firm_name}}',
  },
  {
    stage_key: 'final', name: 'Final notice', tone: 'final', offset_days: 30,
    subject: 'FINAL REMINDER: invoice {{invoice_number}} ({{days_overdue}} days overdue)',
    body:
      'Dear {{client_name}},\n\nDespite our previous reminders, invoice {{invoice_number}} for {{amount_due}} remains unpaid and is now {{days_overdue}} days overdue. This is a final request for payment.\n\nPlease settle this invoice within 7 days to avoid further action.\n\nRegards,\n{{firm_name}}',
  },
  {
    stage_key: 'legal', name: 'Notice before action', tone: 'legal', offset_days: 60,
    subject: 'Notice before further action — invoice {{invoice_number}}',
    body:
      'Dear {{client_name}},\n\nInvoice {{invoice_number}} for {{amount_due}} is now {{days_overdue}} days overdue and remains unpaid despite repeated reminders. Unless payment is received within 7 days we may refer this matter for collection or take further steps to recover the amount due.\n\nWe would prefer to resolve this amicably — please contact us urgently.\n\nRegards,\n{{firm_name}}',
  },
];

export const CHASER_TAGS: { tag: string; label: string }[] = [
  { tag: '{{client_name}}', label: 'Client name' },
  { tag: '{{client_code}}', label: 'Client code' },
  { tag: '{{invoice_number}}', label: 'Invoice number' },
  { tag: '{{amount_due}}', label: 'Amount outstanding' },
  { tag: '{{due_date}}', label: 'Due date' },
  { tag: '{{days_overdue}}', label: 'Days overdue' },
  { tag: '{{firm_name}}', label: 'Your firm / business name' },
];

export interface ChaserContext {
  client_name: string;
  client_code: string;
  invoice_number: string;
  amount_due: string;
  due_date: string;
  days_overdue: string;
  firm_name: string;
}

/** Replace {{tokens}} in a template. Unknown tokens are left as-is. */
export function renderChaserTemplate(template: string, ctx: ChaserContext): string {
  const dict = ctx as unknown as Record<string, string>;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) =>
    key in dict ? String(dict[key]) : m,
  );
}

function ukDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

interface StageRow {
  stage_key: string; name: string; tone: string; offset_days: number;
  subject: string; body: string; enabled: boolean; position: number;
}

/** Seed the default ladder for a firm if it has none yet; return the rows. */
export async function ensureStages(supabase: SupabaseClient, firmId: string): Promise<StageRow[]> {
  const { data } = await supabase
    .from('credit_control_stages').select('*').eq('firm_id', firmId).order('position', { ascending: true });
  if (data && data.length > 0) return data as StageRow[];

  const seed = DEFAULT_STAGES.map((s, i) => ({ firm_id: firmId, position: i, enabled: true, ...s }));
  await supabase.from('credit_control_stages').insert(seed);
  const { data: after } = await supabase
    .from('credit_control_stages').select('*').eq('firm_id', firmId).order('position', { ascending: true });
  return (after ?? []) as StageRow[];
}

interface InvoiceRowLite {
  id: string; firm_id: string; client_id: string | null; client_name: string | null;
  number: string | null; status: string; due_date: string | null;
  total_pence: number; amount_paid_pence: number; auto_chase: boolean;
}

/**
 * Send one reminder for a single invoice immediately (the "Send reminder now"
 * action). Picks the given stage, or the most-advanced stage whose offset has
 * passed, else the first enabled stage. Logs a reminder_sent event.
 */
export async function chaseInvoiceOnce(
  supabase: SupabaseClient,
  args: { firmId: string; invoiceId: string; stageKey?: string; today?: string; userId?: string | null },
): Promise<{ ok: boolean; error?: string; stageName?: string }> {
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  const { data: inv } = await supabase
    .from('invoices')
    .select('id, firm_id, client_id, client_name, number, status, due_date, total_pence, amount_paid_pence, auto_chase')
    .eq('id', args.invoiceId).eq('firm_id', args.firmId).maybeSingle();
  if (!inv) return { ok: false, error: 'Invoice not found' };

  const stages = (await ensureStages(supabase, args.firmId)).filter(s => s.enabled).sort((a, b) => a.offset_days - b.offset_days);
  if (stages.length === 0) return { ok: false, error: 'No reminder stages configured' };

  const bal = balancePence(inv.total_pence, inv.amount_paid_pence);
  if (bal <= 0) return { ok: false, error: 'Nothing outstanding on this invoice' };

  let clientEmail: string | null = null;
  let clientName = inv.client_name ?? 'there';
  let clientCode = '';
  if (inv.client_id) {
    const { data: client } = await supabase.from('clients').select('name, contact_email, client_ref').eq('id', inv.client_id).maybeSingle();
    clientEmail = client?.contact_email ?? null;
    clientName = client?.name ?? clientName;
    clientCode = (client?.client_ref as string | null) ?? '';
  }
  if (!clientEmail) return { ok: false, error: 'This client has no contact email on file' };

  const daysOverdue = inv.due_date ? Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 86_400_000) : 0;
  const stage = args.stageKey
    ? stages.find(s => s.stage_key === args.stageKey)
    : (stages.filter(s => s.offset_days <= daysOverdue).slice(-1)[0] ?? stages[0]);
  if (!stage) return { ok: false, error: 'Stage not found' };

  const { data: firm } = await supabase.from('firms').select('name').eq('id', args.firmId).maybeSingle();
  const { data: cfg } = await supabase.from('billing_settings').select('business_name, chase_reply_to, invoice_accent').eq('firm_id', args.firmId).maybeSingle();
  const firmName = (cfg?.business_name as string) || firm?.name || 'Our practice';
  // Same "View & pay invoice" button the invoice email carries — a chased client
  // shouldn't have to reply to an email to work out how to pay.
  const portalLink = await getOrCreatePortalLink(supabase, { firmId: args.firmId, clientId: inv.client_id, userId: args.userId ?? null });

  const ctx: ChaserContext = {
    client_name: clientName,
    client_code: clientCode,
    invoice_number: inv.number ?? 'your invoice',
    amount_due: fmtPence(bal),
    due_date: ukDate(inv.due_date),
    days_overdue: String(Math.max(0, daysOverdue)),
    firm_name: firmName,
  };
  const subject = renderChaserTemplate(stage.subject, ctx);
  const body = renderChaserTemplate(stage.body, ctx);

  try {
    await sendChaserEmail({
      to: clientEmail, subject, body, fromName: firmName,
      replyTo: (cfg?.chase_reply_to as string) || undefined,
      portalLink, accent: (cfg?.invoice_accent as string | null) ?? null,
    });
  } catch (err) {
    console.error('manual chase send', err);
    return { ok: false, error: 'Email failed to send' };
  }

  await supabase.from('credit_control_events').insert({
    firm_id: args.firmId, invoice_id: inv.id, client_id: inv.client_id, type: 'reminder_sent',
    stage_key: stage.stage_key, stage_name: stage.name, channel: 'email', subject, body, created_by: args.userId ?? null,
  });
  if (inv.status !== 'overdue' && daysOverdue > 0) {
    await supabase.from('invoices').update({ status: 'overdue', updated_at: new Date().toISOString() }).eq('id', inv.id);
  }
  return { ok: true, stageName: stage.name };
}

const CHASEABLE = new Set(['sent', 'viewed', 'part_paid', 'overdue']);

/**
 * Fire due reminder stages across a firm's (or all firms') overdue invoices.
 * Returns how many emails were sent and how many invoices were scanned.
 */
export async function runCreditControlChase(
  supabase: SupabaseClient,
  opts: { today?: string; firmId?: string } = {},
): Promise<{ sent: number; scanned: number; skippedWeekend?: boolean }> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat

  // Which firms have auto-chase on (+ their config).
  let settingsQuery = supabase
    .from('billing_settings')
    .select('firm_id, auto_chase_enabled, chase_weekdays_only, chase_min_balance_pence, chase_reply_to, business_name, invoice_accent')
    .eq('auto_chase_enabled', true);
  if (opts.firmId) settingsQuery = settingsQuery.eq('firm_id', opts.firmId);
  const { data: firmSettings } = await settingsQuery;
  if (!firmSettings || firmSettings.length === 0) return { sent: 0, scanned: 0 };

  let sent = 0;
  let scanned = 0;

  for (const cfg of firmSettings) {
    if (cfg.chase_weekdays_only && (dow === 0 || dow === 6)) continue; // skip weekends
    const firmId = cfg.firm_id as string;
    const minBalance = cfg.chase_min_balance_pence ?? 0;

    const stages = (await ensureStages(supabase, firmId)).filter(s => s.enabled).sort((a, b) => a.offset_days - b.offset_days);
    if (stages.length === 0) continue;

    // Firm display name for {{firm_name}}.
    const { data: firm } = await supabase.from('firms').select('name').eq('id', firmId).maybeSingle();
    const firmName = (cfg.business_name as string) || firm?.name || 'Our practice';

    // Outstanding invoices worth chasing.
    const { data: invData } = await supabase
      .from('invoices')
      .select('id, firm_id, client_id, client_name, number, status, due_date, total_pence, amount_paid_pence, auto_chase')
      .eq('firm_id', firmId)
      .in('status', ['sent', 'viewed', 'part_paid', 'overdue'])
      .not('due_date', 'is', null)
      .limit(2000);
    const invoices = (invData ?? []) as InvoiceRowLite[];

    for (const inv of invoices) {
      scanned++;
      if (!inv.auto_chase || !inv.due_date || !CHASEABLE.has(inv.status)) continue;
      const bal = balancePence(inv.total_pence, inv.amount_paid_pence);
      if (bal <= 0 || bal < minBalance) continue;

      const daysOverdue = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 86_400_000);

      // Client email.
      let clientEmail: string | null = null;
      let clientName = inv.client_name ?? 'there';
      let clientCode = '';
      if (inv.client_id) {
        const { data: client } = await supabase.from('clients').select('name, contact_email, client_ref').eq('id', inv.client_id).maybeSingle();
        clientEmail = client?.contact_email ?? null;
        clientName = client?.name ?? clientName;
        clientCode = (client?.client_ref as string | null) ?? '';
      }
      if (!clientEmail) continue; // nothing to send to

      // Prior events for this invoice: sent stages + open promise-to-pay.
      const { data: events } = await supabase
        .from('credit_control_events')
        .select('type, stage_key, promised_date')
        .eq('invoice_id', inv.id);
      const sentKeys = new Set((events ?? []).filter(e => e.type === 'reminder_sent').map(e => e.stage_key));
      const openPromise = (events ?? []).some(e => e.type === 'promise_to_pay' && e.promised_date && e.promised_date >= today);
      if (openPromise) continue; // honour the promise — don't chase until it lapses

      // Eligible = enabled stage whose offset has passed and not yet sent.
      const eligible = stages.filter(s => s.offset_days <= daysOverdue && !sentKeys.has(s.stage_key));
      if (eligible.length === 0) continue;
      // Send only the most-advanced due stage; mark the earlier skipped ones as sent
      // (logged, no email) so they don't fire on a later run.
      const stage = eligible[eligible.length - 1];
      const superseded = eligible.slice(0, -1);

      const ctx: ChaserContext = {
        client_name: clientName,
        client_code: clientCode,
        invoice_number: inv.number ?? 'your invoice',
        amount_due: fmtPence(bal),
        due_date: ukDate(inv.due_date),
        days_overdue: String(Math.max(0, daysOverdue)),
        firm_name: firmName,
      };
      const subject = renderChaserTemplate(stage.subject, ctx);
      const body = renderChaserTemplate(stage.body, ctx);

      // The cron has no user behind it, so the token is minted with created_by null.
      const portalLink = await getOrCreatePortalLink(supabase, { firmId, clientId: inv.client_id, userId: null });

      try {
        await sendChaserEmail({
          to: clientEmail,
          subject,
          body,
          fromName: firmName,
          replyTo: (cfg.chase_reply_to as string) || undefined,
          portalLink,
          accent: (cfg.invoice_accent as string | null) ?? null,
        });
        // Log the send + mark superseded stages as sent (no email).
        const rows = [
          { firm_id: firmId, invoice_id: inv.id, client_id: inv.client_id, type: 'reminder_sent', stage_key: stage.stage_key, stage_name: stage.name, channel: 'email', subject, body, created_by: null },
          ...superseded.map(s => ({ firm_id: firmId, invoice_id: inv.id, client_id: inv.client_id, type: 'reminder_sent', stage_key: s.stage_key, stage_name: s.name, channel: 'email', subject: null, body: '(superseded — a later stage was sent)', created_by: null })),
        ];
        await supabase.from('credit_control_events').insert(rows);
        // Keep the status honest.
        if (inv.status !== 'overdue' && daysOverdue > 0) {
          await supabase.from('invoices').update({ status: 'overdue', updated_at: new Date().toISOString() }).eq('id', inv.id);
        }
        sent++;
      } catch (err) {
        console.error('chase send failed', inv.id, err);
      }
    }
  }

  return { sent, scanned };
}
