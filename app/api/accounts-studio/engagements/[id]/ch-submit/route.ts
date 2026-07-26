import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { isChGatewayConfigured, CH_XMLGW_ENV } from '@/lib/companiesHouse/config';
import { buildSubmissionEnvelope, submitToGateway } from '@/lib/companiesHouse/gateway';
import { buildIxbrlFromEngagement, chCompanyType } from '@/lib/accounts-studio/ixbrlFromEngagement';
import { getAccountsStudioFirmSettings } from '@/lib/accounts-studio/firmSettings';
import type { Engagement } from '@/components/features/accounts-studio/types';

export const dynamic = 'force-dynamic';

const Body = z.object({
  // Per-company authentication code — required by Companies House for the filing.
  companyAuthCode: z.string().min(1, 'Enter the company authentication code.').max(64),
  // Optional overrides for fields we otherwise derive.
  companyType: z.string().max(16).optional(),
  contactName: z.string().max(120).optional(),
  contactNumber: z.string().max(60).optional(),
  // Audit details from the filing panel (override the stored engagement so a
  // pending autosave can't stale them).
  audited: z.boolean().optional(),
  auditorName: z.string().max(200).optional(),
  auditFirm: z.string().max(200).optional(),
  auditReportDate: z.string().max(20).optional(),
});

/** ISO or dd-mm-yyyy → yyyy-mm-dd. */
function isoDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.trim());
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
}

// POST /api/accounts-studio/engagements/[id]/ch-submit
// Files the engagement's iXBRL accounts to the Companies House XML Gateway.
// In the test environment this is free to run and iterate; in live it requires
// the client to have approved. The iXBRL is (re)generated server-side from the
// stored statements so the filed document always matches what was prepared.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });
  if (!isChGatewayConfigured()) {
    return NextResponse.json({ error: 'Companies House filing is not set up. Add the XML Gateway presenter credentials first.' }, { status: 400 });
  }

  let input: z.infer<typeof Body>;
  try { input = Body.parse(await req.json()); }
  catch (e) {
    const msg = e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Invalid request.') : 'Invalid request.';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Load the engagement (RLS-scoped to the firm).
  const supabase = createClient();
  const { data: row } = await supabase
    .from('accounts_studio_engagements')
    .select('id, client_id, data')
    .eq('id', params.id).eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Accounts not found.' }, { status: 404 });

  const e = { ...(row.data as Engagement), id: row.id as string };

  // Filing details are accounts data captured earlier in the flow — the
  // registration number on Import Data, the employee count on Notes &
  // Disclosures — never entered at filing time.
  if (!e.companyNumber?.trim()) {
    return NextResponse.json({ error: 'No company registration number — set it on the Import Data step first.' }, { status: 400 });
  }
  if (e.averageEmployees == null) {
    return NextResponse.json({ error: 'Average number of employees is not set — enter it in Notes & Disclosures → Employees.' }, { status: 400 });
  }

  if (CH_XMLGW_ENV === 'live' && e.approvalStatus !== 'approved') {
    return NextResponse.json({ error: 'The client must approve the accounts before they can be filed.' }, { status: 409 });
  }

  // Firm-level filing metadata: an accountant's report means audit-exempt WITH
  // report (else without). Best-effort — defaults to no report on any failure.
  let hasAccountantsReport = false;
  try {
    const settings = await getAccountsStudioFirmSettings(supabase, ctx.firmId);
    hasAccountantsReport = !!(settings?.accountantsReport && settings.accountantsReport.trim());
  } catch { /* default: no accountant's report */ }

  // Audit details from the filing panel win over the stored engagement (avoids a
  // pending-autosave race). Only applied when the filing is marked audited.
  if (input.audited) {
    e.audited = true;
    if (input.auditorName !== undefined) e.auditorName = input.auditorName;
    if (input.auditFirm !== undefined) e.auditFirm = input.auditFirm;
    if (input.auditReportDate !== undefined) e.auditReportDate = input.auditReportDate;
  }

  const ixbrl = buildIxbrlFromEngagement(e, { hasAccountantsReport });
  if (!ixbrl) return NextResponse.json({ error: 'Prepare the accounts (import a trial balance) before filing.' }, { status: 400 });

  // Allocate a unique, incremental submission number. The same value doubles as
  // the GovTalk TransactionID (the CHMD5 nonce) — both must be unique + numeric,
  // and one monotonic source guarantees it. Uses the service client so the
  // SECURITY DEFINER sequence function + audit insert don't depend on RLS.
  const service = createServiceClient();
  const { data: seq, error: seqErr } = await service.rpc('next_ch_submission_number');
  if (seqErr || seq == null) {
    return NextResponse.json({ error: 'Could not allocate a submission number.' }, { status: 500 });
  }
  // FormSubmission requires SubmissionNumber to be EXACTLY 6 chars → zero-pad.
  // (Ceiling 999999 submissions per presenter — years away for this firm.) The
  // raw numeric value is the GovTalk TransactionID / CHMD5 nonce (unique+numeric).
  const submissionNumber = String(seq).padStart(6, '0');
  const transactionId = String(seq);

  // CompanyNumber is xs:integer in the schema ("digits only") — strip any
  // jurisdiction prefix (SC/NI/OC…); the prefix is conveyed by CompanyType.
  const companyNumberDigits = e.companyNumber.trim().replace(/\D/g, '');

  const dateSigned = isoDate(e.approvedAt) ?? isoDate(e.periodEnd) ?? new Date().toISOString().slice(0, 10);
  const companyType = input.companyType?.trim() || chCompanyType(e.entityType, e.companyNumber);
  // Filename max 32 chars. Keep it meaningful but hard-cap.
  const filename = `accounts-${companyNumberDigits || 'draft'}.xhtml`.slice(0, 32);

  const envelope = buildSubmissionEnvelope({
    ixbrl,
    companyNumber: companyNumberDigits,
    companyName: e.companyName,
    companyType,
    companyAuthCode: input.companyAuthCode.trim(),
    submissionNumber,
    transactionId,
    contactName: input.contactName?.trim() || e.preparedBy || 'Accounts',
    contactNumber: input.contactNumber?.trim() || '',
    dateSigned,
    filename,
  });

  const result = await submitToGateway(envelope);

  // Audit every attempt — success or rejection — with the raw response and the
  // exact iXBRL filed, so a rejection's reasons are always inspectable.
  await service.from('ch_gateway_submissions').insert({
    firm_id: ctx.firmId,
    engagement_id: row.id,
    client_id: (row.client_id as string | null) ?? e.clientId ?? null,
    submission_number: seq,
    transaction_id: transactionId,
    company_number: companyNumberDigits,
    company_name: e.companyName,
    is_test: CH_XMLGW_ENV !== 'live',
    status: result.status,
    correlation_id: result.correlationId,
    gateway_status_code: result.httpStatus,
    gateway_response: result.raw || null,
    error_message: result.ok ? null : result.message,
    ixbrl,
    submitted_by: ctx.userId,
  });

  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    message: result.message,
    submissionNumber,
    correlationId: result.correlationId,
    isTest: CH_XMLGW_ENV !== 'live',
  }, { status: result.ok ? 200 : 502 });
}
