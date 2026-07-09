import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { buildApprovalEmailHtml } from '@/lib/accounts-studio/approvalEmail';
import type { Engagement } from '@/components/features/accounts-studio/types';

// POST /api/accounts-studio/engagements/[id]/send-approval
// Emails the accounts to the client for approval (via the preparer's Gmail),
// records a tokened accounts_studio_approvals row, and sets the engagement's
// approvalStatus -> 'sent'. `prepare_only` (Email Triage) skips the Gmail send
// and returns the rendered email for the in-app compose window.

const BodySchema = z.object({
  recipient_email: z.string().email(),
  cover_note:      z.string().nullable().optional(),
  pdf_base64:      z.string().nullable().optional(),
  summary_lines:   z.array(z.object({ label: z.string(), value: z.string() })).nullable().optional(),
  prepare_only:    z.boolean().optional(),
});

const genToken = () => randomBytes(24).toString('base64url');

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { recipient_email, cover_note, pdf_base64, summary_lines, prepare_only } = parsed.data;

  const supabase = createClient();
  const service  = createServiceClient();

  // ── Load the engagement (firm-scoped) ──────────────────────────────────────
  const { data: row } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Accounts not found' }, { status: 404 });
  const e = (row.data ?? {}) as Engagement;

  // ── Preparer's Gmail connection ────────────────────────────────────────────
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (!prepare_only && (!connection?.refresh_token || !connection.google_email)) {
    return NextResponse.json({ error: 'Gmail not connected. Connect your Gmail in the Email Triage tool, then try again.' }, { status: 400 });
  }

  // ── Firm + preparer names ──────────────────────────────────────────────────
  const { data: firm } = await supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle();
  const { data: me }   = await supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const firmName = firm?.name ?? 'Your accountant';
  const preparerName = me?.full_name?.trim() || me?.email?.split('@')[0] || 'Your accountant';

  // ── Void any pending prior approval for this engagement ─────────────────────
  await service.from('accounts_studio_approvals')
    .update({ voided_at: new Date().toISOString() })
    .eq('engagement_id', params.id)
    .is('approved_at', null).is('changes_requested_at', null).is('voided_at', null);

  const token = genToken();
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '');
  const approvalUrl = `${siteBase}/accounts-studio/approve/${token}`;

  const subject = `Please approve the accounts for ${e.companyName} — year ended ${e.periodEnd}`;
  const html = buildApprovalEmailHtml({
    firmName, companyName: e.companyName, periodEndUk: e.periodEnd, preparerName,
    coverNote: cover_note, approvalUrl, summary: summary_lines ?? [],
  });

  // ── Insert the approval row ────────────────────────────────────────────────
  const { data: approval, error: insErr } = await service
    .from('accounts_studio_approvals')
    .insert({ engagement_id: params.id, firm_id: ctx.firmId, token, sent_by: ctx.userId, recipient_email, cover_note: cover_note ?? null })
    .select('id')
    .single();
  if (insErr || !approval) {
    console.error('[accounts-studio send-approval] insert', insErr);
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 });
  }

  const attachmentFilename = `Accounts_${(e.companyName || 'client').replace(/\s+/g, '_')}_${e.periodEnd}.pdf`;

  // ── Send via Gmail (unless prepare_only) ───────────────────────────────────
  if (!prepare_only && connection) {
    try {
      const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
      const attachments = pdf_base64 ? [{ filename: attachmentFilename, mimeType: 'application/pdf', data: Buffer.from(pdf_base64, 'base64') }] : [];
      const raw = buildRawMessage({ from: connection.google_email, to: [recipient_email], subject, htmlBody: html, attachments });
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    } catch (err) {
      console.error('[accounts-studio send-approval] gmail', err);
      await service.from('accounts_studio_approvals').delete().eq('id', approval.id);
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send via Gmail' }, { status: 502 });
    }
  }

  // ── Advance engagement status → 'sent' (never regress approved/submitted) ───
  if (e.approvalStatus !== 'approved' && e.approvalStatus !== 'submitted') {
    const nextData = { ...e, approvalStatus: 'sent', sentAt: new Date().toISOString() };
    await supabase.from('accounts_studio_engagements')
      .update({ data: nextData, updated_at: new Date().toISOString() })
      .eq('id', params.id).eq('firm_id', ctx.firmId);
  }

  return NextResponse.json({ ok: true, approvalUrl, senderEmail: connection?.google_email, subject, htmlBody: html, attachmentFilename });
}
