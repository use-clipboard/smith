import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const PersonSettingsSchema = z.object({
  entityType: z.enum(['individual', 'company']).default('individual'),
  useAllowance: z.boolean().default(false),
  broughtForwardLoss: z.number().default(0),
});

const SaveSchema = z.object({
  /** Set to overwrite an existing run (re-saving before an approval send) rather
   *  than creating a duplicate history row. */
  id: z.string().uuid().optional(),
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
  /** Per-owner reliefs, keyed by person key. The allowance, losses and the
   *  finance-cost restriction are personal, so each owner can differ. */
  personSettings: z.record(z.string(), PersonSettingsSchema).optional().default({}),
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

  const row = {
    client_id: body.clientId ?? null,
    client_name: body.clientName ?? null,
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
      personSettings: body.personSettings,
      notes: body.notes,
      clientCode: body.clientCode ?? null,
    },
  };

  // Re-saving an existing run — keep the id so approvals stay attached to it.
  if (body.id) {
    const { data: existing } = await supabase
      .from('outputs')
      .select('id, firm_id')
      .eq('id', body.id)
      .eq('feature', 'landlord_analysis')
      .maybeSingle();
    if (!existing || existing.firm_id !== ctx.firmId) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    const { error } = await supabase.from('outputs').update(row).eq('id', body.id);
    if (error) {
      console.error('[POST /api/outputs/landlord] update', error);
      return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
    }
    return NextResponse.json({ id: body.id });
  }

  const { data, error } = await supabase
    .from('outputs')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      feature: 'landlord_analysis',
      target_software: null,
      ...row,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/landlord]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
