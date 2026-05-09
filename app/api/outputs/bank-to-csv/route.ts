import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  transactions: z.array(z.record(z.unknown())).default([]),
  sourceFilenames: z.array(z.string()).default([]),
});

// POST /api/outputs/bank-to-csv — save a Bank to CSV run to the history dashboard
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
      feature: 'bank_to_csv',
      target_software: null,
      transaction_count: body.transactions.length,
      source_filenames: body.sourceFilenames,
      result_data: {
        transactions: body.transactions,
        clientCode: body.clientCode ?? null,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/bank-to-csv]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
