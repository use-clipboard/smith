import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { createNotification } from '@/lib/notifications';
import { buildApprovalEmailHtml } from '@/lib/accounts-studio/approvalEmail';
import { logTaxAudit } from '@/lib/tax-studio/audit';
import { computeSa100Full } from '@/components/features/tax-studio/calc';
import type { Sa100Income } from '@/components/features/tax-studio/types';

// PUBLIC (no auth — the token is the access). Service-role.
export const dynamic = 'force-dynamic';

interface ApprovalRow {
  id: string; return_id: string; firm_id: string; sent_by: string | null;
  expires_at: string | null; approved_at: string | null; changes_requested_at: string | null;
  changes_note: string | null; voided_at: string | null;
}

async function load(token: string) {
  const service = createServiceClient();
  const { data } = await service
    .from('tax_studio_return_approvals')
    .select('id, return_id, firm_id, sent_by, expires_at, approved_at, changes_requested_at, changes_note, voided_at')
    .eq('token', token).maybeSingle();
  return { service, row: data as ApprovalRow | null };
}

function paymentSchedule(balancing: number, poaEach: number, taxYear: string) {
  const startYear = parseInt(taxYear.slice(0, 4), 10);
  const dueYear = Number.isNaN(startYear) ? 2027 : startYear + 2;
  return { balancing, poaEach, janTotal: balancing + poaEach, julTotal: poaEach, janDate: `31 January ${dueYear}`, julDate: `31 July ${dueYear}` };
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { service, row } = await load(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded by a newer one — please use the latest email.' }, { status: 410 });

  const { data: ret } = await service.from('tax_studio_returns').select('data').eq('id', row.return_id).maybeSingle();
  const d = (ret?.data ?? null) as Record<string, unknown> | null;
  if (!d) return NextResponse.json({ error: 'Return not found' }, { status: 404 });

  if (!d.approvalStatus) {
    await service.from('tax_studio_returns').update({ data: { ...d, approvalStatus: 'sent', sentAt: (d.sentAt as string) ?? new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', row.return_id);
    d.approvalStatus = 'sent';
  }

  const income = (d.income ?? {}) as Sa100Income;
  const taxYear = (d.taxYear as string) ?? '';
  const c = computeSa100Full(income, taxYear);
  const pay = paymentSchedule(c.balancingPayment, c.paymentOnAccount, taxYear);
  const { data: firm } = await service.from('firms').select('name').eq('id', row.firm_id).maybeSingle();

  return NextResponse.json({
    expired: row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false,
    alreadyResponded: !!(row.approved_at || row.changes_requested_at),
    approvedAt: row.approved_at, changesRequestedAt: row.changes_requested_at, changesNote: row.changes_note,
    clientName: d.clientName ?? 'Client', taxYear, entityLabel: d.entityLabel ?? 'Individual', firmName: firm?.name ?? '',
    figures: {
      totalIncome: c.totalIncome, personalAllowance: c.personalAllowance, taxableIncome: c.taxableIncome,
      incomeTax: c.incomeTax, class4Nic: c.class4Nic, studentLoan: c.studentLoan, hicbc: c.hicbc,
      capitalGainsTax: c.capitalGainsTax, totalDue: c.totalDue, balancingPayment: c.balancingPayment,
      employment: c.employmentIncome, trade: c.tradeProfit, property: c.propertyProfit,
      savings: c.savingsIncome, dividends: c.dividendIncome, other: c.otherIncome,
    },
    payments: pay,
  });
}

const PostSchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  name: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { action, name, note } = parsed.data;
  if (action === 'approve' && !name?.trim()) return NextResponse.json({ error: 'Please type your full name to sign.' }, { status: 400 });

  const { service, row } = await load(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded.' }, { status: 410 });
  if (row.approved_at || row.changes_requested_at) return NextResponse.json({ error: 'This return has already been responded to.' }, { status: 409 });
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'This approval link has expired. Please contact your accountant.' }, { status: 410 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 500);
  const now = new Date().toISOString();

  const rowPatch = action === 'approve'
    ? { approved_at: now, approved_by_name: name!.trim(), responded_ip: ip, responded_user_agent: ua }
    : { changes_requested_at: now, changes_note: note ?? null, responded_ip: ip, responded_user_agent: ua };
  const { error: upErr } = await service.from('tax_studio_return_approvals').update(rowPatch).eq('id', row.id);
  if (upErr) { console.error('[tax-studio approve] update', upErr); return NextResponse.json({ error: 'Failed to record response' }, { status: 500 }); }

  const { data: ret } = await service.from('tax_studio_returns').select('data').eq('id', row.return_id).maybeSingle();
  const d = (ret?.data ?? {}) as Record<string, unknown>;
  if (d.approvalStatus === 'sent') {
    const nextData = action === 'approve'
      ? { ...d, approvalStatus: 'approved', approvedAt: now, approvedByName: name!.trim() }
      : { ...d, approvalStatus: 'rejected', rejectedAt: now, changesNote: note ?? undefined };
    await service.from('tax_studio_returns').update({ data: nextData, updated_at: now }).eq('id', row.return_id);
  }

  const clientName = (d.clientName as string) ?? 'Client';
  const taxYear = (d.taxYear as string) ?? '';
  await logTaxAudit({
    firmId: row.firm_id, returnId: row.return_id, clientId: (d.clientId as string | null) ?? null, clientName,
    actorId: null, action: action === 'approve' ? 'approved' : 'reviewed',
    summary: action === 'approve' ? `Approved by ${name?.trim() || 'the client'}` : `Changes requested${note?.trim() ? `: ${note.trim()}` : ''}`,
  });

  if (row.sent_by) {
    try {
      await createNotification({
        userId: row.sent_by, firmId: row.firm_id,
        type: action === 'approve' ? 'tax_studio_approved' : 'tax_studio_changes_requested',
        title: action === 'approve' ? `${clientName} approved their ${taxYear} tax return` : `${clientName} — changes requested (${taxYear})`,
        body: action === 'approve' ? `Approved by ${name!.trim()}.` : (note ?? 'No note provided.'),
        data: { return_id: row.return_id, action, task_link: '/tax-studio' },
      });
    } catch (err) { console.error('[tax-studio approve] notify', err); }

    try {
      const { data: prep } = await service.from('users').select('email').eq('id', row.sent_by).maybeSingle();
      const { data: conn } = await service.from('email_connections').select('refresh_token, google_email').eq('user_id', row.sent_by).maybeSingle();
      const { data: firm } = await service.from('firms').select('name').eq('id', row.firm_id).maybeSingle();
      if (prep?.email && conn?.refresh_token && conn?.google_email) {
        const subject = action === 'approve' ? `${clientName} ${taxYear} tax return approved` : `${clientName} — ${taxYear} changes requested`;
        const bodyText = action === 'approve'
          ? `${clientName} (${name!.trim()}) has approved their ${taxYear} Self Assessment return. You can now submit it to HMRC.`
          : `${clientName} has requested changes to their ${taxYear} Self Assessment return.\n\nTheir note: ${note ?? 'No note provided.'}`;
        const html = buildApprovalEmailHtml({ firmName: firm?.name ?? '', bodyText, approvalUrl: `${(process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/tax-studio` });
        const { gmail } = await getRefreshedGmailClient(conn.refresh_token);
        const raw = buildRawMessage({ from: conn.google_email, to: [prep.email], subject, htmlBody: html });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      }
    } catch (err) { console.error('[tax-studio approve] preparer email (non-fatal)', err); }
  }

  return NextResponse.json({ ok: true, action });
}
