import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const SaveSchema = z.object({
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
  reviewPoints: z.array(z.record(z.unknown())).default([]),
  workingPapers: z.array(z.record(z.unknown())).default([]),
  sourceFilenames: z.array(z.string()).default([]),
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

  const { data, error } = await supabase
    .from('outputs')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      client_id: body.clientId ?? null,
      client_name: body.clientName ?? body.businessName ?? null,
      feature: 'final_accounts_review',
      target_software: body.businessType || null, // double-duty: lets us filter by business type
      transaction_count: body.reviewPoints.length, // for the # column on the dashboard
      source_filenames: body.sourceFilenames,
      result_data: {
        // Inputs (so we can re-open the tool with full context)
        businessName: body.businessName,
        businessType: body.businessType,
        isVatRegistered: body.isVatRegistered,
        relevantContext: body.relevantContext,
        preparerName: body.preparerName,
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
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/final-accounts]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
