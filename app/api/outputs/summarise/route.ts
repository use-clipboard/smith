import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { logAudit } from '@/lib/audit/log';

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  documents: z.array(z.record(z.string(), z.unknown())).default([]),
  groupBy: z.enum(['none', 'entity', 'category']).default('none'),
  dateFrom: z.string().optional().default(''),
  dateTo: z.string().optional().default(''),
  sourceFilenames: z.array(z.string()).default([]),
});

// POST /api/outputs/summarise — save a Summarise run to the history dashboard
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
      feature: 'summarise',
      target_software: null,
      transaction_count: body.documents.length,
      source_filenames: body.sourceFilenames,
      result_data: {
        documents: body.documents,
        groupBy: body.groupBy,
        clientCode: body.clientCode ?? null,
        // Period — saved under standard keys so the existing list endpoint
        // exposes them as period_from / period_to.
        dateFrom: body.dateFrom || '',
        dateTo: body.dateTo || '',
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/summarise]', error);
    return NextResponse.json({ error: 'Failed to save summary' }, { status: 500 });
  }

  await logAudit({
    firmId: ctx.firmId,
    tool: 'summarise',
    action: 'created',
    entityId: data.id,
    entityLabel: body.clientName ?? null,
    clientId: body.clientId ?? null,
    actorId: ctx.userId,
    summary: 'Created a summary',
  });

  return NextResponse.json({ id: data.id });
}
