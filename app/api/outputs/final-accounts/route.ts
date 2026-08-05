import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { logAudit } from '@/lib/audit/log';

const SaveSchema = z.object({
  // When present, update this existing run (Save & continue) instead of inserting a new one.
  outputId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  businessName: z.string().optional().default(''),
  businessType: z.string().optional().default(''),
  isVatRegistered: z.boolean().optional().default(false),
  periodStart: z.string().optional().default(''),
  periodEnd: z.string().optional().default(''),
  relevantContext: z.string().optional().default(''),
  preparerName: z.string().optional().default(''),
  reviewerName: z.string().optional().default(''),
  reviewPoints: z.array(z.record(z.string(), z.unknown())).default([]),
  workingPapers: z.array(z.record(z.string(), z.unknown())).default([]),
  sourceFilenames: z.array(z.string()).default([]),
  // Per-point reviewed/ignored statuses, keyed by review-point index.
  pointStatuses: z.record(z.string(), z.string()).optional().default({}),
  // Append-only audit trail of status changes (who marked what, when).
  statusHistory: z.array(z.record(z.string(), z.unknown())).optional().default([]),
});

// POST /api/outputs/final-accounts — save a Final Accounts Review run to the history dashboard.
// Stores the full reviewPoints[] and workingPapers[] so the dashboard can rebuild the PDF
// and the user can re-open the run in the tool to make further edits.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof SaveSchema>;
  try {
    body = SaveSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 });
  }

  const supabase = createClient();

  const resultData = {
    // Inputs (so we can re-open the tool with full context)
    businessName: body.businessName,
    businessType: body.businessType,
    isVatRegistered: body.isVatRegistered,
    relevantContext: body.relevantContext,
    preparerName: body.preparerName,
    reviewerName: body.reviewerName,
    clientCode: body.clientCode ?? null,
    // Period — saved using dateFrom/dateTo keys so the existing list endpoint
    // (which projects period_from/period_to from those keys) works unchanged.
    dateFrom: body.periodStart || '',
    dateTo: body.periodEnd || '',
    periodStart: body.periodStart || '',
    periodEnd: body.periodEnd || '',
    // Outputs (so we can rebuild the PDF and re-edit the working papers)
    reviewPoints: body.reviewPoints,
    workingPapers: body.workingPapers,
    // Per-point reviewed/ignored resolution, so progress survives reopen.
    pointStatuses: body.pointStatuses ?? {},
    // Resolution audit trail.
    statusHistory: body.statusHistory ?? [],
  };

  // Shared columns. source_filenames is only overwritten when we actually have
  // some — a re-opened run has no files in memory, so don't clobber the originals.
  const cols: Record<string, unknown> = {
    client_id: body.clientId ?? null,
    client_name: body.clientName ?? body.businessName ?? null,
    target_software: body.businessType || null, // double-duty: filter by business type
    transaction_count: body.reviewPoints.length, // # column on the dashboard
    result_data: resultData,
  };
  if (body.sourceFilenames.length > 0) cols.source_filenames = body.sourceFilenames;

  // Save & continue: update the existing run when an id is supplied.
  if (body.outputId) {
    const { data, error } = await supabase
      .from('outputs')
      .update(cols)
      .eq('id', body.outputId)
      .eq('firm_id', ctx.firmId)
      .select('id')
      .maybeSingle();
    if (!error && data) return NextResponse.json({ id: data.id });
    // Otherwise fall through and insert a fresh row (e.g. the row was deleted).
  }

  const { data, error } = await supabase
    .from('outputs')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      feature: 'final_accounts_review',
      source_filenames: body.sourceFilenames,
      ...cols,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/final-accounts]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  await logAudit({
    firmId: ctx.firmId, tool: 'final_accounts_review', action: 'created',
    entityId: data.id, entityLabel: body.clientName ?? null, clientId: body.clientId ?? null,
    actorId: ctx.userId, summary: 'Created an accounts review',
  });

  return NextResponse.json({ id: data.id });
}
