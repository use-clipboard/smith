import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const SaveSchema = z.object({
  clientId: z.string().uuid().nullable().optional(),
  clientName: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  emailBody: z.string().default(''),
  sourceFilename: z.string().nullable().optional(),
});

// POST /api/outputs/p32 — save a P32 Summary run to the history dashboard.
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
      feature: 'p32_summary',
      target_software: null,
      transaction_count: body.emailBody.length, // doubles as a "size" indicator on the list
      source_filenames: body.sourceFilename ? [body.sourceFilename] : [],
      result_data: {
        emailBody: body.emailBody,
        clientCode: body.clientCode ?? null,
      },
    })
    .select('id')
    .single();

  if (error) {
    console.error('[POST /api/outputs/p32]', error);
    return NextResponse.json({ error: 'Failed to save P32 summary' }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
