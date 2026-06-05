import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { computeVatReturn } from '@/lib/bookkeeping/vatReturn';
import { recordVatFiling } from '@/lib/bookkeeping/recordVatFiling';
import { isHmrcConfigured } from '@/lib/hmrc/config';
import { getConnectionForBook, hmrcRequest } from '@/lib/hmrc/api';
import { buildFraudHeaders } from '@/lib/hmrc/fraudHeaders';

// ── POST /api/bookkeeping/books/[id]/mtd/submit ──────────────────────────────
// Submits a VAT return to HMRC and files it in SMITH in one step. The 9-box
// figures are RECOMPUTED server-side (never trust the client) so HMRC gets the
// authoritative numbers, then the SAME recordVatFiling() used by "Mark as filed"
// posts the VAT-clearing journal, writes the filing row (with the HMRC receipt)
// and advances the VAT lock. `finalised` is the user's legal declaration.
//
// Submission is irreversible (sandbox: it's against a test user, so safe).

const Body = z.object({
  periodKey: z.string().min(1),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  finalised: z.literal(true),
  lockPeriod: z.boolean().default(true),
  postJournal: z.boolean().default(true),
  fraudData: z.any().optional(),
});

const r2 = (n: number) => +Number(n).toFixed(2);
function hmrcError(json: unknown): string {
  const j = json as { message?: string; errors?: { message?: string }[] } | null;
  if (j?.errors?.length) return j.errors.map(e => e.message).filter(Boolean).join('; ') || 'HMRC rejected the submission.';
  return j?.message || 'HMRC rejected the submission.';
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isHmrcConfigured()) return NextResponse.json({ error: 'HMRC is not configured.' }, { status: 400 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Confirm the figures are final and try again.', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const service = createServiceClient();

  const { data: book } = await supabase
    .from('bookkeeping_books').select('id, firm_id, vat_registered, vat_scheme, vat_number').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!book.vat_registered) return NextResponse.json({ error: 'This book is not VAT-registered.' }, { status: 400 });

  const vrn = (book.vat_number ?? '').replace(/\s/g, '');
  if (!/^\d{9}$/.test(vrn)) return NextResponse.json({ error: 'Set a valid 9-digit VAT number first.' }, { status: 400 });

  const conn = await getConnectionForBook(service, ctx.firmId, params.id);
  if (!conn) return NextResponse.json({ error: 'Connect HMRC first.' }, { status: 400 });

  // Recompute the authoritative figures server-side.
  let figures;
  try { figures = await computeVatReturn(supabase, params.id, body.periodFrom, body.periodTo); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not compute the return.' }, { status: 500 }); }

  const payload = {
    periodKey: body.periodKey,
    vatDueSales: r2(figures.box1),
    vatDueAcquisitions: r2(figures.box2),
    totalVatDue: r2(figures.box3),
    vatReclaimedCurrPeriod: r2(figures.box4),
    netVatDue: r2(Math.abs(figures.box5)),
    totalValueSalesExVAT: Math.round(figures.box6),
    totalValuePurchasesExVAT: Math.round(figures.box7),
    totalValueGoodsSuppliedExVAT: Math.round(figures.box8),
    totalAcquisitionsExVAT: Math.round(figures.box9),
    finalised: true,
  };

  const fraudHeaders = body.fraudData ? buildFraudHeaders(req, body.fraudData) : {};
  const result = await hmrcRequest(conn, `/organisations/vat/${vrn}/returns`, { method: 'POST', body: payload, fraudHeaders });
  if (result.status !== 200 && result.status !== 201) {
    return NextResponse.json({ error: hmrcError(result.json), status: result.status, detail: result.json }, { status: 502 });
  }
  const receipt = result.json as { processingDate?: string; formBundleNumber?: string; paymentIndicator?: string; chargeRefNumber?: string };

  // File it in SMITH (journal + row + lock) via the shared recorder — same as
  // "Mark as filed", tagged as an MTD submission with the HMRC receipt.
  try {
    const filing = await recordVatFiling(
      supabase, { userId: ctx.userId }, params.id, body.periodFrom, body.periodTo, figures, book.vat_scheme,
      {
        submissionMethod: 'mtd_api',
        hmrcReference: receipt.formBundleNumber ?? null,
        submittedAtIso: receipt.processingDate ?? new Date().toISOString(),
        lockPeriod: body.lockPeriod,
        postJournal: body.postJournal,
        notes: `Submitted to HMRC via MTD (${process.env.HMRC_ENV === 'production' ? 'production' : 'sandbox'}). Period key ${body.periodKey}.`,
      },
    );
    return NextResponse.json({ ok: true, receipt, vat_return: filing.filed, journal_warning: filing.journalWarning });
  } catch (e) {
    // HMRC has the submission — surface success even if local recording failed.
    console.error('[hmrc] submission succeeded but filing in SMITH failed', e);
    return NextResponse.json({ ok: true, receipt, warning: 'Submitted to HMRC, but recording it in SMITH failed — note the receipt below.' });
  }
}
