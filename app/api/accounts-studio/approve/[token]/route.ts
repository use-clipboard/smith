import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { createNotification } from '@/lib/notifications';
import { getAccountsStudioFirmSettings } from '@/lib/accounts-studio/firmSettings';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { buildApprovalEmailHtml } from '@/lib/accounts-studio/approvalEmail';
import { logAuditEvent } from '@/lib/accounts-studio/audit';
import { resolveNotifyRecipients } from '@/lib/notifyExtras';
import type { Engagement } from '@/components/features/accounts-studio/types';

// PUBLIC (no auth — the token is the access). Uses the service-role client.
// GET  → engagement summary + rendered accounts pack HTML for the client to view.
// POST → { action: 'approve'|'request_changes', name?, note? }.

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
function composeAccountantDetails(name: string, address: string, details: string): string | null {
  const n = name.trim();
  const lines = address.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (n || lines.length) return (n ? `<p style="margin:0;font-weight:600">${esc(n)}</p>` : '') + lines.map(l => `<p style="margin:0">${esc(l)}</p>`).join('');
  return details.trim() || null;
}

interface ApprovalRow {
  id: string; engagement_id: string; firm_id: string; token: string; sent_by: string | null;
  expires_at: string | null; approved_at: string | null; changes_requested_at: string | null;
  changes_note: string | null; voided_at: string | null;
}

async function load(token: string) {
  const service = createServiceClient();
  const { data } = await service
    .from('accounts_studio_approvals')
    .select('id, engagement_id, firm_id, token, sent_by, expires_at, approved_at, changes_requested_at, changes_note, voided_at')
    .eq('token', token).maybeSingle();
  return { service, row: data as ApprovalRow | null };
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { service, row } = await load(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded by a newer one — please use the latest email.' }, { status: 410 });

  const { data: eng } = await service
    .from('accounts_studio_engagements').select('data').eq('id', row.engagement_id).maybeSingle();
  const e = (eng?.data ?? null) as Engagement | null;
  if (!e) return NextResponse.json({ error: 'Accounts not found' }, { status: 404 });

  // The client has opened the link → the email was definitely sent. Flip to
  // 'sent' if it hasn't been already (fallback for a missed compose-sent event).
  if (!e.approvalStatus) {
    const withSent: Engagement = { ...e, approvalStatus: 'sent', sentAt: e.sentAt ?? new Date().toISOString() };
    await service.from('accounts_studio_engagements').update({ data: withSent, updated_at: new Date().toISOString() }).eq('id', row.engagement_id);
    e.approvalStatus = 'sent';
  }

  const { data: firm } = await service.from('firms').select('name').eq('id', row.firm_id).maybeSingle();
  const settings = await getAccountsStudioFirmSettings(service, row.firm_id);
  const packHtml = buildAccountsPackHtml(e, {
    firmName: firm?.name ?? null,
    accountantDetails: composeAccountantDetails(settings.accountantName, settings.accountantAddress, settings.accountantDetails),
    accountantsReport: settings.accountantsReport || null,
    comparatives: e.showComparatives ?? true,
    amended: e.amended ?? false,
  });

  return NextResponse.json({
    expired: row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false,
    alreadyResponded: !!(row.approved_at || row.changes_requested_at),
    approvedAt: row.approved_at, changesRequestedAt: row.changes_requested_at, changesNote: row.changes_note,
    companyName: e.companyName, periodEnd: e.periodEnd, framework: e.framework, firmName: firm?.name ?? '',
    amended: e.amended ?? false,
    packHtml,
  });
}

// ── POST ─────────────────────────────────────────────────────────────────────
const PostSchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  name:   z.string().max(200).nullable().optional(),
  note:   z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { action, name, note } = parsed.data;
  if (action === 'approve' && !name?.trim()) return NextResponse.json({ error: 'Please type your full name to sign.' }, { status: 400 });

  const { service, row } = await load(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded.' }, { status: 410 });
  if (row.approved_at || row.changes_requested_at) return NextResponse.json({ error: 'These accounts have already been responded to.' }, { status: 409 });
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'This approval link has expired. Please contact your accountant.' }, { status: 410 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 500);
  const now = new Date().toISOString();

  const rowPatch = action === 'approve'
    ? { approved_at: now, approved_by_name: name!.trim(), responded_ip: ip, responded_user_agent: ua }
    : { changes_requested_at: now, changes_note: note ?? null, responded_ip: ip, responded_user_agent: ua };
  const { error: upErr } = await service.from('accounts_studio_approvals').update(rowPatch).eq('id', row.id);
  if (upErr) { console.error('[accounts-studio approve] update', upErr); return NextResponse.json({ error: 'Failed to record response' }, { status: 500 }); }

  // Advance the engagement status (only from 'sent' → never regress a submitted set).
  const { data: eng } = await service.from('accounts_studio_engagements').select('data').eq('id', row.engagement_id).maybeSingle();
  const e = (eng?.data ?? {}) as Engagement;
  if (e.approvalStatus === 'sent') {
    const nextData: Engagement = action === 'approve'
      ? { ...e, approvalStatus: 'approved', approvedAt: now, approvedByName: name!.trim() }
      : { ...e, approvalStatus: 'rejected', rejectedAt: now, changesNote: note ?? undefined };
    await service.from('accounts_studio_engagements').update({ data: nextData, updated_at: now }).eq('id', row.engagement_id);
  }

  // Audit — the actor is the client (no user id); record their typed name.
  await logAuditEvent({
    firmId: row.firm_id,
    engagementId: row.engagement_id,
    clientId: e.clientId ?? null,
    companyName: e.companyName ?? null,
    actorId: null,
    actorName: name?.trim() || 'Client',
    action: action === 'approve' ? 'client_approved' : 'client_rejected',
    summary: action === 'approve'
      ? `Approved by ${name?.trim() || 'the client'}`
      : `Changes requested${note?.trim() ? `: ${note.trim()}` : ''}`,
  });

  // Notify the preparer (in-app + best-effort email via their Gmail), plus any
  // additional team members the firm configured in Accounts Studio settings.
  if (row.sent_by) {
    let extras: { id: string; email: string; fullName: string | null }[] = [];
    try {
      const settings = await getAccountsStudioFirmSettings(service, row.firm_id);
      extras = await resolveNotifyRecipients(row.firm_id, settings.notifyUserIds, row.sent_by);
    } catch { /* extras are optional */ }

    const notif = {
      firmId: row.firm_id,
      type: action === 'approve' ? 'accounts_studio_approved' : 'accounts_studio_changes_requested',
      title: action === 'approve'
        ? `${e.companyName} accounts approved by the client`
        : `${e.companyName} — client requested changes`,
      body: action === 'approve' ? `Approved by ${name!.trim()}.` : (note ?? 'No note provided.'),
      data: { engagement_id: row.engagement_id, action, task_link: '/accounts-studio' },
    };
    for (const userId of [row.sent_by, ...extras.map(u => u.id)]) {
      try { await createNotification({ userId, ...notif }); }
      catch (err) { console.error('[accounts-studio approve] notify', err); }
    }

    try {
      const { data: prep } = await service.from('users').select('email, full_name').eq('id', row.sent_by).maybeSingle();
      const { data: conn } = await service.from('email_connections').select('refresh_token, google_email').eq('user_id', row.sent_by).maybeSingle();
      const { data: firm } = await service.from('firms').select('name').eq('id', row.firm_id).maybeSingle();
      if (prep?.email && conn?.refresh_token && conn?.google_email) {
        const subject = action === 'approve' ? `${e.companyName} accounts approved` : `${e.companyName} — changes requested`;
        const bodyText = action === 'approve'
          ? `${e.companyName} — the client (${name!.trim()}) has approved the statutory accounts for the year ended ${e.periodEnd}. You can now mark them as submitted.`
          : `${e.companyName} — the client has requested changes to the statutory accounts for the year ended ${e.periodEnd}.\n\nTheir note: ${note ?? 'No note provided.'}`;
        const html = buildApprovalEmailHtml({
          firmName: firm?.name ?? '', bodyText,
          approvalUrl: `${(process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')}/accounts-studio`,
        });
        const { gmail } = await getRefreshedGmailClient(conn.refresh_token);
        const raw = buildRawMessage({ from: conn.google_email, to: [prep.email, ...extras.map(u => u.email)], subject, htmlBody: html });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      }
    } catch (err) { console.error('[accounts-studio approve] preparer email (non-fatal)', err); }
  }

  return NextResponse.json({ ok: true, action });
}
