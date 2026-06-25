import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  raUsersName: z.string().optional().default(''),
  raClientName: z.string().optional().default(''),
  raClientCode: z.string().optional().default(''),
  raClientType: z.string().optional().default(''),
  answers: z.record(z.string(), z.object({ answer: z.boolean(), comment: z.string() })).default({}),
  report: z.object({
    overallRiskLevel: z.enum(['Low', 'Medium', 'High']),
    riskJustification: z.string(),
    summaryOfAnswers: z.array(z.object({
      questionId: z.string(),
      question: z.string(),
      answer: z.string(),
      userComment: z.string(),
    })).default([]),
    suggestedControls: z.string(),
    trainingSuggestions: z.string(),
  }),
});

// POST /api/outputs/risk-assessment — save a Risk Assessment run to history.
// Stores the inputs (so re-open hydrates the questionnaire) plus the full
// report (so re-download rebuilds the same PDF and the dashboard can show
// the risk level + summary).
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
      client_name: body.clientName ?? body.raClientName ?? null,
      feature: 'risk_assessment',
      // Use target_software to surface the risk level on list rows without
      // having to read result_data on every row. Values: Low / Medium / High.
      target_software: body.report.overallRiskLevel,
      // # questions answered — useful as a sanity column on the dashboard
      transaction_count: Object.keys(body.answers).length,
      source_filenames: [],
      result_data: {
        // Inputs (for re-open)
        raUsersName: body.raUsersName,
        raClientName: body.raClientName,
        raClientCode: body.raClientCode,
        raClientType: body.raClientType,
        answers: body.answers,
        clientCode: body.clientCode ?? null,
        // Outputs (for re-download)
        report: body.report,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/risk-assessment]', error);
    return NextResponse.json({ error: 'Failed to save assessment' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
