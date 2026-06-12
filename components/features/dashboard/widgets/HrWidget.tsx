'use client';

import { useEffect, useState } from 'react';
import { HeartHandshake, Cake, PartyPopper } from 'lucide-react';
import { WidgetCard, StatRow, WidgetLoading, useOpenTool } from './shared';

interface Upcoming { id: string; name: string; kind: 'birthday' | 'anniversary'; days: number; years?: number; }

interface Member {
  id: string;
  full_name: string;
  date_of_birth: string | null;       // YYYY-MM-DD (year may be masked to 1900); null if hidden
  employment_start_date: string | null;
}

interface State {
  remaining: number | null;
  myPending: number;
  toApprove: number;
  upcoming: Upcoming[];
}

/** Days until the next MM-DD occurrence (0..) plus the calendar year it lands in. */
function nextOccurrence(month: number, day: number): { days: number; year: number } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = new Date(today.getFullYear(), month - 1, day);
  if (d < today) d = new Date(today.getFullYear() + 1, month - 1, day);
  return { days: Math.round((d.getTime() - today.getTime()) / 86_400_000), year: d.getFullYear() };
}

function buildUpcoming(members: Member[]): Upcoming[] {
  const out: Upcoming[] = [];
  for (const m of members) {
    if (m.date_of_birth) {
      const [, mm, dd] = m.date_of_birth.split('-').map(Number);
      if (mm && dd) {
        const { days } = nextOccurrence(mm, dd);
        if (days <= 30) out.push({ id: `${m.id}-b`, name: m.full_name, kind: 'birthday', days });
      }
    }
    if (m.employment_start_date) {
      const [sy, mm, dd] = m.employment_start_date.split('-').map(Number);
      if (mm && dd) {
        const { days, year } = nextOccurrence(mm, dd);
        const years = year - sy;
        if (days <= 30 && years >= 1) out.push({ id: `${m.id}-a`, name: m.full_name, kind: 'anniversary', days, years });
      }
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

function whenLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

export default function HrWidget() {
  const openTool = useOpenTool();
  const [s, setS] = useState<State | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/hr/holidays/balance').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/hr/holidays?scope=mine&status=pending').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/hr/holidays?scope=team&status=pending').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/hr/team').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([bal, mine, team, roster]) => {
      if (!active) return;
      setS({
        remaining: typeof bal?.remaining === 'number' ? bal.remaining : null,
        myPending: (mine?.holidays ?? []).length,
        toApprove: (team?.holidays ?? []).length,
        upcoming: buildUpcoming((roster?.members ?? []) as Member[]),
      });
    });
    return () => { active = false; };
  }, []);

  return (
    <WidgetCard
      icon={<HeartHandshake size={15} className="text-[var(--accent)]" />}
      title="HR"
      onViewAll={() => openTool('hr', 'HR', '/hr', HeartHandshake)}
    >
      {!s ? (
        <WidgetLoading />
      ) : (
        <div className="h-full flex gap-4">
          {/* Left: my numbers */}
          <div className="w-[44%] shrink-0 flex flex-col justify-center gap-2">
            <div className="rounded-lg px-3 py-2.5 bg-white/40">
              <p className="text-xs text-[var(--text-secondary)]">Holidays left</p>
              <p className="text-2xl font-bold text-[var(--accent)] leading-tight">
                {s.remaining ?? '—'}
                {s.remaining !== null && <span className="text-xs font-medium text-[var(--text-muted)] ml-1">days</span>}
              </p>
            </div>
            <StatRow label="My requests pending" value={s.myPending} color="#f59e0b" />
            <StatRow label="To approve" value={s.toApprove} color="#4F46E5" />
          </div>

          {/* Right: upcoming birthdays / anniversaries */}
          <div className="flex-1 min-w-0 border-l border-[var(--border-card)] pl-4 flex flex-col">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2 shrink-0">
              Next 30 days
            </p>
            {s.upcoming.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center">
                <p className="text-xs text-[var(--text-muted)]">No birthdays or anniversaries.</p>
              </div>
            ) : (
              <ul className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-2 -mx-1 px-1">
                {s.upcoming.map(u => (
                  <li key={u.id} className="flex items-center gap-2.5">
                    {u.kind === 'birthday'
                      ? <Cake size={14} className="text-pink-500 shrink-0" />
                      : <PartyPopper size={14} className="text-amber-500 shrink-0" />}
                    <span className="text-sm text-[var(--text-primary)] truncate flex-1">
                      {u.name}
                      {u.kind === 'anniversary' && u.years && (
                        <span className="text-xs text-[var(--text-muted)]"> · {u.years}yr</span>
                      )}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] shrink-0">{whenLabel(u.days)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
