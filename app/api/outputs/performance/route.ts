import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const SaveSchema = z.object({
  // When present, update this existing run (Save & continue) instead of inserting.
  outputId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  paBusinessName: z.string().optional().default(''),
  paBusinessType: z.string().optional().default(''),
  paBusinessTrade: z.string().optional().default(''),
  paTradingLocation: z.string().optional().default(''),
  paRelevantInfo: z.string().optional().default(''),
  paAnalysisPeriod: z.string().optional().default(''),
  paAnalysisPeriodDescription: z.string().optional().default(''),
  selectedSections: z.array(z.string()).default([]),
  reportHtml: z.string().optional().default(''),
  editorHtml: z.string().optional().default(''),
  titlePageHtml: z.string().optional().default(''),
  themeColor: z.string().optional().default(''),
  sourceFilenames: z.array(z.string()).default([]),
  // KPI / benchmark chart data (raw JSON string from the AI).
  chartDataJson: z.string().optional().default(''),
});

// POST /api/outputs/performance — save a Performance Analysis run to history
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
    // Inputs (so re-open hydrates the form)
    paBusinessName: body.paBusinessName,
    paBusinessType: body.paBusinessType,
    paBusinessTrade: body.paBusinessTrade,
    paTradingLocation: body.paTradingLocation,
    paRelevantInfo: body.paRelevantInfo,
    paAnalysisPeriod: body.paAnalysisPeriod,
    paAnalysisPeriodDescription: body.paAnalysisPeriodDescription,
    selectedSections: body.selectedSections,
    clientCode: body.clientCode ?? null,
    dateFrom: '',
    dateTo: '',
    // Outputs (so re-open / re-download work)
    reportHtml: body.reportHtml,
    editorHtml: body.editorHtml,
    titlePageHtml: body.titlePageHtml,
    themeColor: body.themeColor,
    chartDataJson: body.chartDataJson,
  };

  // Shared columns. source_filenames only overwritten when we actually have some.
  const cols: Record<string, unknown> = {
    client_id: body.clientId ?? null,
    client_name: body.clientName ?? body.paBusinessName ?? null,
    target_software: body.paAnalysisPeriod || null, // period type slot
    transaction_count: body.selectedSections.length, // # sections column
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
    // Otherwise fall through to insert a fresh row.
  }

  const { data, error } = await supabase
    .from('outputs')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      feature: 'performance_analysis',
      source_filenames: body.sourceFilenames,
      ...cols,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/performance]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
