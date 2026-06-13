'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';
import { useDashboardData } from '@/components/features/dashboard/DashboardDataProvider';

interface CalEvent { id: string; title: string; start: string; }
interface Resp { events: CalEvent[]; connected: boolean; }

function timeOf(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarWidget() {
  const openTool = useOpenTool();
  const shared = useDashboardData();
  const [own, setOwn] = useState<Resp | null>(null);

  // Prefer the shared provider; only self-fetch if rendered without it.
  useEffect(() => {
    if (shared) return;
    let active = true;
    fetch('/api/calendar/reminders')
      .then(r => r.ok ? r.json() : { events: [], connected: false })
      .then(d => { if (active) setOwn({ events: d.events ?? [], connected: d.connected ?? false }); })
      .catch(() => { if (active) setOwn({ events: [], connected: false }); });
    return () => { active = false; };
  }, [shared]);

  const data = shared ? shared.calendar : own;

  return (
    <WidgetCard
      icon={<CalendarDays size={15} className="text-[var(--accent)]" />}
      title="Today's Calendar"
      onViewAll={() => openTool('google-calendar', 'Calendar', '/calendar', CalendarDays)}
    >
      {!data ? (
        <WidgetLoading />
      ) : !data.connected ? (
        <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
          <CalendarDays size={20} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">Connect your calendar to see today&apos;s events.</p>
        </div>
      ) : data.events.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
          <CalendarDays size={20} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">Nothing on for the next 24 hours.</p>
        </div>
      ) : (
        <ul className="h-full overflow-y-auto scrollbar-thin space-y-2.5 -mx-1 px-1">
          {data.events.map(e => (
            <li key={e.id} className="flex items-center gap-3">
              <div className="w-12 shrink-0 flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                <Clock size={11} /> {timeOf(e.start)}
              </div>
              <span className="text-sm text-[var(--text-primary)] truncate">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
