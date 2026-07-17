import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient, buildRawMessage } from '@/lib/gmail';
import { round2, shareAdjustedGbp } from '@/lib/mtdIt/amounts';
import { isEntryFlagged, reflagStoredRows, type FlaggableEntry } from '@/lib/mtdIt/flags';
import type { ValuableEntry } from '@/lib/mtdIt/amounts';
import { getQuarterDates, taxYearLabel } from '@/lib/mtdIt/quarters';
import { renderTemplate, buildEmailHtml, formatDateUkForTemplate, formatDateTimeUkForTemplate } from '@/lib/mtdIt/emailTemplates';
import { ensureMtdItFirmSettings } from '@/lib/mtdIt/firmSettings';
import { createNotification } from '@/lib/notifications';

// PUBLIC endpoints (no auth — token is the access).
// GET  /api/mtd-it/approve/[token]   → summary of the quarter for the client to review
// POST /api/mtd-it/approve/[token]   → { action: 'approve' | 'request_changes', note? }

// Helper: load + validate token. Returns the joined approval+quarter+client
// row, or a NextResponse error to bail with.
async function loadApproval(token: string) {
  const service = createServiceClient();
  const { data } = await service
    .from('mtd_it_quarter_approvals')
    .select(`
      id, quarter_id, token, sent_by, sent_at, expires_at, recipient_email, cover_note,
      approved_at, changes_requested_at, changes_note, voided_at,
      mtd_it_quarters!inner(
        id, tax_year, quarter, status, consolidated, fx_rates, streams_snapshot,
        clients!inner(id, name, client_ref, mtd_it_quarter_type, firm_id, firms!inner(name))
      )
    `)
    .eq('token', token)
    .maybeSingle();
  return { service, row: data };
}

function pickQuarterContext(row: NonNullable<Awaited<ReturnType<typeof loadApproval>>['row']>) {
  type FirmRow    = { name?: string };
  type ClientRow  = { id?: string; name?: string; client_ref?: string | null; mtd_it_quarter_type?: 'calendar' | 'standard'; firm_id?: string; firms?: FirmRow };
  type QuarterRow = { id?: string; tax_year?: number; quarter?: 1 | 2 | 3 | 4; status?: string; streams_snapshot?: Record<string, boolean> | null; clients?: ClientRow };
  const quarter = (row as unknown as { mtd_it_quarters?: QuarterRow }).mtd_it_quarters ?? {};
  const client  = quarter.clients ?? {};
  const firm    = client.firms ?? {};
  return { quarter, client, firm };
}

/** The entry columns this page needs: enough to derive flags and to value the
 *  row at the client's share. */
type SummaryRow = FlaggableEntry & ValuableEntry & { entry_type: string };

// ── GET ─────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { service, row } = await loadApproval(params.token);
  if (!row) return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: 'This approval link has been superseded by a newer one — please use the latest email.' }, { status: 410 });

  const { quarter, client, firm } = pickQuarterContext(row);
  const now = Date.now();
  const expired = row.expires_at ? new Date(row.expires_at).getTime() < now : false;

  const taxYear = Number(quarter.tax_year ?? 2026);
  const qNum    = Number(quarter.quarter ?? 1) as 1 | 2 | 3 | 4;
  const range   = getQuarterDates(taxYear, qNum, client.mtd_it_quarter_type ?? 'calendar');

  // Aggregate entries by stream + type for the summary table on the page.
  const { data: entries } = await service
    .from('mtd_it_entries')
    .select('stream, entry_type, entry_date, supplier, gross_amount, currency, fx_rate, gbp_amount, share_pct, flagged_reason, flag_dismissed')
    .eq('quarter_id', quarter.id ?? '');

  // Derive flags the same way the reviewer's screen does, rather than trusting
  // the stored flagged_reason — otherwise this page can show money that the
  // filing excludes (or exclude money it files). See lib/mtdIt/flags.
  const reflagged = reflagStoredRows((entries ?? []) as unknown as SummaryRow[], range.from, range.to);

  // Only summarise streams that are still ACTIVE on the quarter. A stream the
  // user toggled off (e.g. added UK Rental then removed it) leaves its entries
  // in the table — they must NOT show on the client's approval page, which has
  // to match the figures in the email / PDF (those are built from the active
  // streams). `streams_snapshot` is the source of truth for what's in scope.
  const streamsSnapshot = quarter.streams_snapshot ?? null;
  const totals: Record<string, { income: number; expense: number }> = {};
  for (const e of reflagged) {
    if (isEntryFlagged(e)) continue;
    const s = e.stream as string;
    if (streamsSnapshot && !streamsSnapshot[s]) continue;
    if (!totals[s]) totals[s] = { income: 0, expense: 0 };
    // The client approves the figures we file, so this must be the client's
    // SHARE — same rule as the P&L, the PDF and computeUpdate. See amounts.ts.
    const amount = round2(shareAdjustedGbp(e, {}));
    if (e.entry_type === 'income')  totals[s].income  += amount;
    if (e.entry_type === 'expense') totals[s].expense += amount;
  }

  return NextResponse.json({
    expired,
    already_responded: !!(row.approved_at || row.changes_requested_at),
    approved_at:          row.approved_at,
    changes_requested_at: row.changes_requested_at,
    changes_note:         row.changes_note,
    client_name:  client.name ?? '',
    client_code:  client.client_ref ?? '',
    firm_name:    firm.name ?? '',
    tax_year_label: taxYearLabel(taxYear),
    quarter_label:  `Q${qNum}`,
    period_from:    range.from,
    period_to:      range.to,
    totals,
    expires_at:     row.expires_at,
  });
}

// ── POST ────────────────────────────────────────────────────────────────
const PostSchema = z.object({
  action: z.enum(['approve', 'request_changes']),
  note:   z.string().max(2000).nullable().optional(),
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
    return NextResponse.json({ error: 'This quarter has already been responded to.' }, { status: 409 });
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This approval link has expired. Please contact your accountant.' }, { status: 410 });
  }

  // Capture lightweight audit
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 500);

  const now = new Date().toISOString();
  const patch = action === 'approve'
    ? { approved_at: now, responded_ip: ip, responded_user_agent: userAgent }
    : { changes_requested_at: now, changes_note: note ?? null, responded_ip: ip, responded_user_agent: userAgent };

  const { error: upErr } = await service
    .from('mtd_it_quarter_approvals')
    .update(patch)
    .eq('id', row.id);
  if (upErr) {
    console.error('POST /api/mtd-it/approve/[token]', upErr);
    return NextResponse.json({ error: 'Failed to record response' }, { status: 500 });
  }

  const { quarter, client, firm } = pickQuarterContext(row);

  // Flip quarter status (only on approve — changes_requested keeps 'sent').
  // Guard with `.eq('status', 'sent')` so the status only ever moves forward:
  // a stale approval link clicked after the quarter was already submitted (or
  // re-approved) must never drag it back to 'approved'. The approval row's
  // approved_at is still stamped above for the audit trail either way.
  if (action === 'approve' && quarter.id) {
    await service
      .from('mtd_it_quarters')
      .update({ status: 'approved', updated_at: now })
      .eq('id', quarter.id)
      .eq('status', 'sent');
  }

  // ── Notify the preparer (email via their Gmail + in-app notification) ─
  if (row.sent_by) {
    // 1. In-app notification
    if (client.firm_id) {
      try {
        await createNotification({
          userId: row.sent_by,
          firmId: client.firm_id,
          type:   action === 'approve' ? 'mtd_it_approved' : 'mtd_it_changes_requested',
          title:  action === 'approve'
            ? `${client.name} (${client.client_ref ?? '—'}) has approved MTD IT`
            : `${client.name} (${client.client_ref ?? '—'}) has requested changes`,
          body:   action === 'approve'
            ? `Approved Q${quarter.quarter} ${taxYearLabel(Number(quarter.tax_year ?? 2026))}.`
            : (note ?? 'No note provided.'),
          data: {
            client_id:  client.id,
            quarter_id: quarter.id,
            approval_id: row.id,
            action,
            // Deep-link the bell notification straight to the quarter. On
            // approve we add ?submit=1 so it opens the review with the Submit-
            // to-HMRC modal ready; on a change request it just opens the quarter
            // so the preparer can make the edits.
            task_link: action === 'approve'
              ? `/mtd-it/${client.id}/${quarter.tax_year}/${quarter.quarter}?submit=1`
              : `/mtd-it/${client.id}/${quarter.tax_year}/${quarter.quarter}`,
          },
        });
      } catch (e) {
        console.error('createNotification (mtd_it approval)', e);
      }
    }

    // 2. Email to the preparer (best-effort via their Gmail)
    try {
      const { data: preparer } = await service
        .from('users')
        .select('id, email, full_name')
        .eq('id', row.sent_by)
        .maybeSingle();
      const { data: conn } = await service
        .from('email_connections')
        .select('refresh_token, google_email')
        .eq('user_id', row.sent_by)
        .maybeSingle();

      if (preparer?.email && conn?.refresh_token && conn?.google_email && client.firm_id) {
        const settings = await ensureMtdItFirmSettings(client.firm_id);
        const taxYear  = Number(quarter.tax_year ?? 2026);
        const qNum     = Number(quarter.quarter ?? 1) as 1 | 2 | 3 | 4;
        const range    = getQuarterDates(taxYear, qNum, client.mtd_it_quarter_type ?? 'calendar');
        const vars = {
          client_name:    client.name ?? '',
          client_code:    client.client_ref ?? '',
          quarter_label:  `Q${qNum}`,
          tax_year_label: taxYearLabel(taxYear),
          period_from:    formatDateUkForTemplate(range.from),
          period_to:      formatDateUkForTemplate(range.to),
          firm_name:      firm.name ?? '',
          preparer_name:  preparer.full_name?.trim() || preparer.email.split('@')[0],
          approved_at:    formatDateTimeUkForTemplate(now),
          responded_at:   formatDateTimeUkForTemplate(now),
          changes_note:   note ?? '',
        };
        const tpl = action === 'approve'
          ? { subject: settings.preparer_approved_subject, body: settings.preparer_approved_body }
          : { subject: settings.preparer_changes_subject,  body: settings.preparer_changes_body  };
        const subject = renderTemplate(tpl.subject, vars);
        const html = buildEmailHtml({
          firmName: firm.name ?? '',
          subject,
          bodyText: renderTemplate(tpl.body, vars),
        });
        const { gmail } = await getRefreshedGmailClient(conn.refresh_token);
        const raw = buildRawMessage({
          from: conn.google_email,
          to: [preparer.email],
          subject,
          htmlBody: html,
        });
        await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      }
    } catch (e) {
      // Non-fatal — the in-app notification already fired, and the approval
      // row records the truth. We log but don't return an error to the client.
      console.error('preparer notification email failed (non-fatal):', e);
    }
  }

  return NextResponse.json({ ok: true, action });
}
