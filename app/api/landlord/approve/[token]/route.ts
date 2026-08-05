import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { renderTemplate, buildEmailHtml, formatDateUkForTemplate, formatDateTimeUkForTemplate } from '@/lib/mtdIt/emailTemplates';
import { ensureLandlordFirmSettings } from '@/lib/landlord/firmSettings';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit/log';
import { computeRentComputation, type LandlordEntityType } from '@/utils/landlordComputation';
import { personShareRows, personShareAdjustments } from '@/utils/landlordAllocation';
import type { LandlordProperty, PropertyOwner, LandlordIncomeTransaction, LandlordExpenseTransaction, LandlordAdjustment } from '@/types';

// PUBLIC endpoints (no auth — the token is the access).
// GET  /api/landlord/approve/[token] → what the client needs to review
// POST /api/landlord/approve/[token] → { action: 'approve' | 'request_changes', note? }

// Local copy so this route doesn't pull the xlsx-heavy export module server-side.
function inRange(date: string | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!date) return true;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

interface ResultData {
  income?: (LandlordIncomeTransaction & { _forceInclude?: boolean })[];
  expenses?: (LandlordExpenseTransaction & { _forceInclude?: boolean })[];
  adjustments?: LandlordAdjustment[];
  dateFrom?: string;
  dateTo?: string;
  entityType?: LandlordEntityType;
  useAllowance?: boolean;
  broughtForwardLoss?: number;
  personSettings?: Record<string, { entityType?: LandlordEntityType; useAllowance?: boolean; broughtForwardLoss?: number }>;
}

async function loadApproval(token: string) {
  const service = createServiceClient();
  const { data } = await service
    .from('landlord_approvals')
    .select(`
      id, output_id, token, person_key, person_name, sent_by, sent_at, expires_at,
      recipient_email, cover_note, approved_at, changes_requested_at, changes_note, voided_at,
      outputs!inner(id, firm_id, client_id, client_name, result_data, clients(id, name, client_ref), firms!inner(name))
    `)
    .eq('token', token)
    .maybeSingle();
  return { service, row: data };
}

type OutputRow = {
  id?: string; firm_id?: string; client_id?: string | null; client_name?: string | null;
  result_data?: ResultData;
  clients?: { id?: string; name?: string; client_ref?: string | null };
  firms?: { name?: string };
};

/** The client's saved property register + owners (for the per-person split). */
async function loadRegister(service: ReturnType<typeof createServiceClient>, clientId: string): Promise<LandlordProperty[]> {
  const { data: props } = await service
    .from('mtd_it_properties')
    .select('id, client_id, address, ownership_pct, property_type, use_type, active')
    .eq('client_id', clientId);
  if (!props || props.length === 0) return [];
  const { data: owners } = await service
    .from('property_owners')
    .select('id, property_id, owner_client_id, owner_name, share_pct')
    .in('property_id', props.map(p => p.id as string));
  return props.map(p => ({
    id: p.id as string,
    client_id: p.client_id as string,
    address: p.address as string,
    ownership_pct: Number(p.ownership_pct),
    property_type: p.property_type as 'uk' | 'foreign',
    use_type: (p.use_type as 'residential' | 'commercial' | null) ?? null,
    active: p.active as boolean,
    owners: ((owners ?? []) as PropertyOwner[]).filter(o => o.property_id === p.id).map(o => ({ ...o, share_pct: Number(o.share_pct) })),
  }));
}

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { service, row } = await loadApproval(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded by a newer one — please use the latest email.' }, { status: 410 });

  const out = (row as unknown as { outputs?: OutputRow }).outputs ?? {};
  const rd = out.result_data ?? {};
  const from = rd.dateFrom ?? '';
  const to = rd.dateTo ?? '';

  const income = (rd.income ?? []).filter(r => inRange(r.Date, from, to) || r._forceInclude === true);
  const expenses = (rd.expenses ?? []).filter(r => inRange(r.DueDate, from, to) || r._forceInclude === true);

  // Per-individual: scale every row to their share FIRST, then run the ordinary
  // computation on their own reliefs — the allowance, losses and finance-cost
  // restriction are personal, so a share of the portfolio's answer would be wrong.
  // These must match the figures in the PDF they were sent.
  let scopedIncome = income;
  let scopedExpenses = expenses;
  let scopedAdjustments = rd.adjustments ?? [];
  let scopedOpts = {
    entityType: rd.entityType ?? 'individual',
    useAllowance: rd.useAllowance ?? false,
    broughtForwardLoss: rd.broughtForwardLoss ?? 0,
  };

  if (row.person_key) {
    const register = out.clients?.id ? await loadRegister(service, out.clients.id) : [];
    const primary = { id: out.clients?.id ?? null, name: out.clients?.name ?? out.client_name ?? 'This client' };
    scopedIncome     = personShareRows(income, register, primary, row.person_key);
    scopedExpenses   = personShareRows(expenses, register, primary, row.person_key);
    scopedAdjustments = personShareAdjustments(scopedAdjustments, register, primary, row.person_key);
    const ps = rd.personSettings?.[row.person_key];
    scopedOpts = {
      entityType: ps?.entityType ?? 'individual',
      useAllowance: ps?.useAllowance ?? false,
      broughtForwardLoss: ps?.broughtForwardLoss ?? 0,
    };
  }

  const c = computeRentComputation(scopedIncome, scopedExpenses, scopedAdjustments, scopedOpts);
  const totals = { income: c.totalIncome, expenses: c.totalExpenses, net: c.netProfit };

  return NextResponse.json({
    expired: row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false,
    already_responded: !!(row.approved_at || row.changes_requested_at),
    approved_at: row.approved_at,
    changes_requested_at: row.changes_requested_at,
    changes_note: row.changes_note,
    client_name: out.clients?.name ?? out.client_name ?? '',
    client_code: out.clients?.client_ref ?? '',
    firm_name: out.firms?.name ?? '',
    person_name: row.person_name,
    period_from: from,
    period_to: to,
    totals,
    expires_at: row.expires_at,
  });
}

// ── POST ────────────────────────────────────────────────────────────────
const PostSchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  note: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { action, note } = parsed.data;

  const { service, row } = await loadApproval(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded.' }, { status: 410 });
  if (row.approved_at || row.changes_requested_at) {
    return NextResponse.json({ error: 'This computation has already been responded to.' }, { status: 409 });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This approval link has expired. Please contact your accountant.' }, { status: 410 });
  }

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500);
  const now = new Date().toISOString();

  const patch = action === 'approve'
    ? { approved_at: now, responded_ip: ip, responded_user_agent: userAgent }
    : { changes_requested_at: now, changes_note: note ?? null, responded_ip: ip, responded_user_agent: userAgent };

  const { error: upErr } = await service.from('landlord_approvals').update(patch).eq('id', row.id);
  if (upErr) {
    console.error('POST /api/landlord/approve/[token]', upErr);
    return NextResponse.json({ error: 'Failed to record response' }, { status: 500 });
  }

  const out = (row as unknown as { outputs?: OutputRow }).outputs ?? {};
  const clientName = out.clients?.name ?? out.client_name ?? '';
  const who = row.person_name || clientName;

  // ── Audit trail (best-effort) ────────────────────────────────────────
  if (out.firm_id) {
    await logAudit({
      firmId: out.firm_id,
      tool: 'landlord_analysis',
      action: action === 'approve' ? 'client_approved' : 'client_rejected',
      entityId: row.output_id,
      entityLabel: clientName,
      clientId: out.clients?.id,
      actorId: null,
      actorName: who || 'Client',
      summary: action === 'approve'
        ? `Approved by ${who || 'Client'}`
        : `Changes requested: ${note ?? 'No note provided.'}`,
    });
  }

  // ── Notify the preparer (in-app + best-effort email) ─────────────────
  if (row.sent_by) {
    if (out.firm_id) {
      try {
        await createNotification({
          userId: row.sent_by,
          firmId: out.firm_id,
          type: action === 'approve' ? 'landlord_approved' : 'landlord_changes_requested',
          title: action === 'approve'
            ? `${who} has approved the property income computation`
            : `${who} has requested changes to the property income computation`,
          body: action === 'approve'
            ? `${clientName} (${out.clients?.client_ref ?? '—'}) — approved.`
            : (note ?? 'No note provided.'),
          data: {
            client_id: out.clients?.id,
            output_id: row.output_id,
            approval_id: row.id,
            action,
            task_link: '/landlord',
          },
        });
      } catch (e) {
        console.error('createNotification (landlord approval)', e);
      }
    }

    try {
      const { data: preparer } = await service.from('users').select('id, email, full_name').eq('id', row.sent_by).maybeSingle();
      const { data: conn } = await service.from('email_connections').select('refresh_token, google_email').eq('user_id', row.sent_by).maybeSingle();

      if (preparer?.email && conn?.refresh_token && conn?.google_email && out.firm_id) {
        const settings = await ensureLandlordFirmSettings(out.firm_id);
        const rd = out.result_data ?? {};
        const vars = {
          client_name: clientName,
          client_code: out.clients?.client_ref ?? '',
          person_name: who,
          period_from: rd.dateFrom ? formatDateUkForTemplate(rd.dateFrom) : '',
          period_to: rd.dateTo ? formatDateUkForTemplate(rd.dateTo) : '',
          firm_name: out.firms?.name ?? '',
          preparer_name: preparer.full_name?.trim() || preparer.email.split('@')[0],
          approved_at: formatDateTimeUkForTemplate(now),
          responded_at: formatDateTimeUkForTemplate(now),
          changes_note: note ?? '',
        };
        const tpl = action === 'approve'
          ? { subject: settings.preparer_approved_subject, body: settings.preparer_approved_body }
          : { subject: settings.preparer_changes_subject, body: settings.preparer_changes_body };
        const subject = renderTemplate(tpl.subject, vars);
        const html = buildEmailHtml({ firmName: out.firms?.name ?? '', subject, bodyText: renderTemplate(tpl.body, vars) });
        const { gmail } = await getRefreshedGmailClient(conn.refresh_token);
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: buildRawMessage({ from: conn.google_email, to: [preparer.email], subject, htmlBody: html }) },
        });
      }
    } catch (e) {
      // Non-fatal — the in-app notification fired and the row records the truth.
      console.error('preparer notification email failed (non-fatal):', e);
    }
  }

  return NextResponse.json({ ok: true, action });
}
