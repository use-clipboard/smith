import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  income: z.array(z.record(z.string(), z.unknown())).default([]),
  expenses: z.array(z.record(z.string(), z.unknown())).default([]),
  adjustments: z.array(z.record(z.string(), z.unknown())).default([]),
  flaggedIncome: z.array(z.record(z.string(), z.unknown())).default([]),
  flaggedExpenses: z.array(z.record(z.string(), z.unknown())).default([]),
  dateFrom: z.string().optional().default(''),
  dateTo: z.string().optional().default(''),
  entityType: z.enum(['individual', 'company']).optional().default('individual'),
  useAllowance: z.boolean().optional().default(false),
  broughtForwardLoss: z.number().optional().default(0),
  notes: z.string().optional().default(''),
  sourceFilenames: z.array(z.string()).default([]),
});

// POST /api/outputs/landlord — save a Landlord Analysis run to the history dashboard
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
      client_name: body.clientName ?? null,
      feature: 'landlord_analysis',
      target_software: null,
      transaction_count: body.income.length + body.expenses.length,
      source_filenames: body.sourceFilenames,
      result_data: {
        income: body.income,
        expenses: body.expenses,
        adjustments: body.adjustments,
        flaggedIncome: body.flaggedIncome,
        flaggedExpenses: body.flaggedExpenses,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
        entityType: body.entityType,
        useAllowance: body.useAllowance,
        broughtForwardLoss: body.broughtForwardLoss,
        notes: body.notes,
        clientCode: body.clientCode ?? null,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/landlord]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
