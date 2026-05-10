import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { generateBriefingForFirm, getManagerRecipientsForFirm, previousQuarter } from '@/lib/hrManagerBriefings';
import { sendManagerBriefingEmail } from '@/lib/email';
import { createNotification } from '@/lib/notifications';

// Vercel cron: 1st of Jan/Apr/Jul/Oct at 06:00 UTC.
// Generates the briefing for the just-completed quarter for every firm with HR active.

export const maxDuration = 300; // up to 5 minutes — web-search calls aren't fast

function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[HR Briefings Cron] CRON_SECRET not set — allowing through.');
    return true;
  }
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorisedCron(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const service = createServiceClient();
  const { data: firms, error } = await service
    .from('firms')
    .select('id, name, active_modules');
  if (error) {
    console.error('[HR Briefings Cron] firm fetch failed', error);
    return NextResponse.json({ error: 'Firm fetch failed' }, { status: 500 });
  }

  const { quarter } = previousQuarter();
  const summary: Array<{ firmId: string; status: string; reason?: string }> = [];

  for (const f of firms ?? []) {
    const modules = (f.active_modules as string[] | null) ?? [];
    if (!modules.includes('hr')) continue;
    try {
      const result = await generateBriefingForFirm({ firmId: f.id, quarter });
      summary.push({ firmId: f.id, status: result.status, reason: result.reason });
      if (result.status === 'success' && result.briefingId) {
        const recipients = await getManagerRecipientsForFirm(f.id);
        for (const r of recipients) {
          void createNotification({
            userId: r.id,
            firmId: f.id,
            type: 'hr_briefing_published',
            title: 'New manager briefing',
            body: 'Your quarterly UK employment-law reading is ready.',
            data: { link: '/hr?tab=resources', briefing_id: result.briefingId },
          });
          void sendManagerBriefingEmail({ to: r.email, briefingId: result.briefingId }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[HR Briefings Cron] firm', f.id, e);
      summary.push({ firmId: f.id, status: 'failed', reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, quarter, summary });
}
