import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/ch-secretarial/summary
// Aggregates the firm's cached Companies House data into a flat, date-sorted
// list of upcoming statutory deadlines (accounts, confirmation statement, ECCTA
// identity verification) for the Compliance dashboard widget.

interface CHCompany {
  companyName?: string;
  accountsNextDue?: string | null;
  accountsOverdue?: boolean;
  csNextDue?: string | null;
  csOverdue?: boolean;
  nearestOfficerIdvDue?: string | null;
  nearestPscIdvDue?: string | null;
}

interface Deadline {
  company: string;
  type: 'Accounts' | 'Confirmation' | 'Officer IDV' | 'PSC IDV';
  dueDate: string;       // YYYY-MM-DD
  daysUntil: number;     // negative if overdue
  overdue: boolean;
}

function daysBetween(todayMs: number, iso: string): number {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - todayMs) / 86_400_000);
}

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createServiceClient();
  const { data: cache } = await supabase
    .from('ch_cache')
    .select('companies, refreshed_at')
    .eq('firm_id', ctx.firmId)
    .single();

  const companies = (cache?.companies as CHCompany[] | null) ?? [];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const HORIZON = 90; // days

  const deadlines: Deadline[] = [];
  const push = (company: string, type: Deadline['type'], iso: string | null | undefined) => {
    if (!iso) return;
    const daysUntil = daysBetween(todayMs, iso);
    const overdue = daysUntil < 0;
    // Keep overdue items + anything within the horizon.
    if (overdue || daysUntil <= HORIZON) {
      deadlines.push({ company: company || 'Unknown company', type, dueDate: iso, daysUntil, overdue });
    }
  };

  for (const c of companies) {
    push(c.companyName ?? '', 'Accounts', c.accountsNextDue);
    push(c.companyName ?? '', 'Confirmation', c.csNextDue);
    push(c.companyName ?? '', 'Officer IDV', c.nearestOfficerIdvDue);
    push(c.companyName ?? '', 'PSC IDV', c.nearestPscIdvDue);
  }

  deadlines.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const overdueCount = deadlines.filter(d => d.overdue).length;
  const dueSoonCount = deadlines.filter(d => !d.overdue && d.daysUntil <= 30).length;

  return NextResponse.json({
    deadlines: deadlines.slice(0, 50),
    overdueCount,
    dueSoonCount,
    companies: companies.length,
    lastRefreshedAt: cache?.refreshed_at ?? null,
  });
}
