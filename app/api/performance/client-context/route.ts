import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

const MAX_PAST = 3;
const MAX_TEXT_PER_REPORT = 6000; // chars of stripped text per past report

export interface PastPerformanceAnalysis {
  createdAt: string;
  periodType: string;
  periodDescription: string;
  selectedSections: string[];
  summaryText: string;
}

// Strip HTML tags + collapse whitespace, then cap. Used to give the AI a compact
// text snapshot of a previous report rather than feeding it verbose HTML.
function stripHtml(html: string, cap: number): string {
  if (!html) return '';
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > cap ? text.slice(0, cap) + ' …[truncated]' : text;
}

// GET /api/performance/client-context?clientId=<uuid>
//
// Pulls the client's most recent (up to 3) saved Performance Analyses and
// returns compact summaries the AI can use for context: what periods have
// already been analysed, which sections were used, and a stripped-text version
// of each report so the new analysis can reference past commentary, recurring
// issues, and continuity in narrative.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ analysisCount: 0, pastAnalyses: [] });
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from('outputs')
    .select('id, target_software, result_data, created_at')
    .eq('feature', 'performance_analysis')
    .eq('firm_id', ctx.firmId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(MAX_PAST);

  if (error) {
    console.error('[GET /api/performance/client-context]', error);
    return NextResponse.json({ analysisCount: 0, pastAnalyses: [] });
  }

  const analyses = data ?? [];
  if (analyses.length === 0) {
    return NextResponse.json({ analysisCount: 0, pastAnalyses: [] });
  }

  const pastAnalyses: PastPerformanceAnalysis[] = analyses.map(a => {
    const rd = (a.result_data ?? {}) as {
      paAnalysisPeriodDescription?: string;
      selectedSections?: string[];
      reportHtml?: string;
      editorHtml?: string;
    };
    const html = rd.editorHtml || rd.reportHtml || '';
    return {
      createdAt: a.created_at,
      periodType: a.target_software ?? '',
      periodDescription: rd.paAnalysisPeriodDescription ?? '',
      selectedSections: rd.selectedSections ?? [],
      summaryText: stripHtml(html, MAX_TEXT_PER_REPORT),
    };
  });

  return NextResponse.json({
    analysisCount: pastAnalyses.length,
    pastAnalyses,
  });
}
