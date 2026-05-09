import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const MAX_ANALYSES = 5;
const MAX_DOCS = 300;

interface PastDoc {
  detectedDate: string;
  entityName: string;
  detailedCategory: string;
  totalGrossAmount: number;
}

// GET /api/summarise/client-context?clientId=<uuid>
//
// Pulls the client's most recent saved Summarise runs and returns a compact
// list of past documents the AI can use as reference: which entityName to
// reuse, which detailedCategory has been chosen for similar suppliers, etc.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ docCount: 0, analysisCount: 0, pastDocuments: [] });
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from('outputs')
    .select('id, result_data, created_at')
    .eq('feature', 'summarise')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(MAX_ANALYSES);

  if (error) {
    console.error('[GET /api/summarise/client-context]', error);
    return NextResponse.json({ docCount: 0, analysisCount: 0, pastDocuments: [] });
  }

  const analyses = data ?? [];
  if (analyses.length === 0) {
    return NextResponse.json({ docCount: 0, analysisCount: 0, pastDocuments: [] });
  }

  const pastDocuments: PastDoc[] = [];
  for (const a of analyses) {
    const rd = (a.result_data ?? {}) as { documents?: Record<string, unknown>[] };
    if (Array.isArray(rd.documents)) {
      for (const d of rd.documents) {
        pastDocuments.push({
          detectedDate: String(d.detectedDate ?? ''),
          entityName: String(d.entityName ?? ''),
          detailedCategory: String(d.detailedCategory ?? ''),
          totalGrossAmount: Number(d.totalGrossAmount ?? 0),
        });
        if (pastDocuments.length >= MAX_DOCS) break;
      }
    }
    if (pastDocuments.length >= MAX_DOCS) break;
  }

  return NextResponse.json({
    docCount: pastDocuments.length,
    analysisCount: analyses.length,
    pastDocuments,
  });
}
