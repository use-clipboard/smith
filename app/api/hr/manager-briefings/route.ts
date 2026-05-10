import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { generateBriefingForFirm } from '@/lib/hrManagerBriefings';
import { sendManagerBriefingEmail } from '@/lib/email';
import { createNotification } from '@/lib/notifications';
import { getManagerRecipientsForFirm } from '@/lib/hrManagerBriefings';

// GET /api/hr/manager-briefings — list past briefings for the firm
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('hr_manager_briefings')
    .select('id, quarter, period_start, period_end, summary, content, status, error_detail, generated_at')
    .eq('firm_id', ctx.firmId)
    .order('generated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ briefings: data ?? [] });
}

// POST /api/hr/manager-briefings — admin-only manual trigger.
// Body { quarter?: string } — defaults to the previous completed quarter.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let quarter: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { quarter?: string };
    quarter = body.quarter;
  } catch { /* empty body is fine */ }

  const result = await generateBriefingForFirm({ firmId: ctx.firmId, quarter });
  if (result.status === 'failed') {
    return NextResponse.json({ error: result.reason ?? 'Generation failed' }, { status: 500 });
  }

  // Notify managers + email if it's a fresh success
  if (result.status === 'success' && result.briefingId) {
    const recipients = await getManagerRecipientsForFirm(ctx.firmId);
    for (const r of recipients) {
      void createNotification({
        userId: r.id,
        firmId: ctx.firmId,
        type: 'hr_briefing_published',
        title: 'New manager briefing',
        body: 'Your quarterly UK employment-law reading is ready.',
        data: { link: '/hr?tab=resources', briefing_id: result.briefingId },
      });
      // Best-effort email; don't fail the request if Resend errors
      void sendManagerBriefingEmail({ to: r.email, briefingId: result.briefingId }).catch(() => {});
    }
  }

  return NextResponse.json(result);
}
