import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { logAudit } from '@/lib/audit/log';

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  targetSoftware: z.enum(['vt', 'capium', 'xero', 'quickbooks', 'freeagent', 'sage', 'general', 'smith']),
  transactions: z.array(z.record(z.string(), z.unknown())),
  flaggedEntries: z.array(z.record(z.string(), z.unknown())).default([]),
  sourceFilenames: z.array(z.string()).default([]),
  dateFrom: z.string().optional().default(''),
  dateTo: z.string().optional().default(''),
  /** SMITH format: the bookkeeping book this analysis was coded against — the
   *  authoritative "Send to bookkeeping" target. */
  bookId: z.string().uuid().nullable().optional(),
});

// POST /api/outputs/full-analysis — save a Full Analysis run to the history dashboard
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
      feature: 'full_analysis',
      target_software: body.targetSoftware,
      transaction_count: body.transactions.length,
      source_filenames: body.sourceFilenames,
      result_data: {
        transactions: body.transactions,
        flaggedEntries: body.flaggedEntries,
        clientCode: body.clientCode ?? null,
        dateFrom: body.dateFrom || '',
        dateTo: body.dateTo || '',
        book_id: body.bookId ?? null,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/full-analysis]', error);
    return NextResponse.json({ error: 'Failed to save analysis' }, { status: 500 });
  }

  await logAudit({
    firmId: ctx.firmId, tool: 'full_analysis', action: 'created',
    entityId: data.id, entityLabel: body.clientName ?? null, clientId: body.clientId ?? null,
    actorId: ctx.userId, summary: 'Created a Capture analysis',
  });

  return NextResponse.json({ id: data.id });
}
