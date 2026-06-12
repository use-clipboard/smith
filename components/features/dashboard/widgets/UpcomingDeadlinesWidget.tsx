'use client';

/**
 * UpcomingDeadlinesWidget — a single date-sorted list of the firm's real
 * statutory deadlines, each with a stacked calendar-date chip (MON / DD) and a
 * colour-coded "days until" pill.
 *
 * Sources (merged, module-gated — only fetched when the tool is on):
 *   • Companies House — /api/ch-secretarial/summary (accounts, confirmation,
 *     officer/PSC IDV per client)
 *   • MTD IT          — /api/mtd-it/dashboard-summary (current-quarter deadline,
 *     shown only while submissions are still outstanding)
 *
 * No fabricated rows: deadline types we don't actually track (e.g. VAT) are
 * simply absent until there's a data source for them.
 */

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';
import { useModules } from '@/components/ui/ModulesProvider';
import { useDashboardData, type DeadlineItem as Deadline } from '@/components/features/dashboard/DashboardDataProvider';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Whole days from local midnight today to the given YYYY-MM-DD (negative = past). */
function daysUntil(iso: string): number {
  const [y, mo, d] = iso.split('-').map(Number);
  const target = new Date(y, mo - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const CH_TYPE_LABEL: Record<string, string> = {
  'Accounts': 'Accounts filing',
  'Confirmation': 'Confirmation statement',
  'Officer IDV': 'Officer ID verification',
  'PSC IDV': 'PSC ID verification',
};

/** Pill styling by urgency. */
function pill(days: number): { cls: string; label: string } {
  if (days < 0) return { cls: 'bg-red-50 text-red-700 border-red-200', label: `${Math.abs(days)}d over` };
  if (days === 0) return { cls: 'bg-red-50 text-red-700 border-red-200', label: 'today' };
  const label = days === 1 ? '1 day' : `${days} days`;
  if (days <= 2) return { cls: 'bg-red-50 text-red-700 border-red-200', label };
  if (days <= 7) return { cls: 'bg-amber-50 text-amber-700 border-amber-200', label };
  return { cls: 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--border-card)]', label };
}

export default function UpcomingDeadlinesWidget() {
  const openTool = useOpenTool();
  const { isModuleActive } = useModules();
  const hasCh = isModuleActive('ch-secretarial');
  const hasMtd = isModuleActive('mtd-it');
  const shared = useDashboardData();

  const [own, setOwn] = useState<Deadline[] | null>(null);

  // The shared provider already merges CH + MTD deadlines; only self-fetch when
  // the widget is rendered without a provider.
  useEffect(() => {
    if (shared) return;
    let active = true;
    async function load() {
      const out: Deadline[] = [];
      await Promise.all([
        hasCh && fetch('/api/ch-secretarial/summary')
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            (d?.deadlines ?? []).forEach((dl: { company: string; type: string; dueDate: string }, i: number) => {
              out.push({
                id: `ch-${i}-${dl.company}-${dl.type}`,
                title: CH_TYPE_LABEL[dl.type] ?? dl.type,
                subtitle: dl.company,
                dateISO: dl.dueDate,
                days: daysUntil(dl.dueDate),
              });
            });
          }).catch(() => {}),
        hasMtd && fetch('/api/mtd-it/dashboard-summary')
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (d?.deadline && (d?.outstanding ?? 0) > 0) {
              out.push({
                id: 'mtd-deadline',
                title: 'MTD IT submission',
                subtitle: `${d.outstanding} outstanding · Q${d.quarter} ${d.monthsLabel}`,
                dateISO: d.deadline,
                days: daysUntil(d.deadline),
              });
            }
          }).catch(() => {}),
      ]);
      out.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      if (active) setOwn(out);
    }
    load();
    return () => { active = false; };
  }, [shared, hasCh, hasMtd]);

  const items = shared ? shared.deadlines : own;

  return (
    <WidgetCard
      icon={<CalendarClock size={15} className="text-[var(--accent)]" />}
      title="Upcoming Deadlines"
      onViewAll={() => openTool('ch-secretarial', 'CH Secretarial', '/ch-secretarial', CalendarClock)}
    >
      {items === null ? (
        <WidgetLoading />
      ) : items.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
          <CalendarClock size={20} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">No statutory deadlines coming up.</p>
        </div>
      ) : (
        <ul className="h-full overflow-y-auto scrollbar-thin space-y-2 -mx-1 px-1">
          {items.map(it => {
            const [y, mo, d] = it.dateISO.split('-').map(Number);
            const p = pill(it.days);
            return (
              <li key={it.id} className="flex items-center gap-2.5">
                {/* Stacked calendar-date chip — thin stroke + coloured month stripe */}
                <div className="w-9 shrink-0 rounded-md border border-[rgba(15,23,42,0.12)] bg-white/70 text-center overflow-hidden shadow-sm">
                  <div className="text-[8px] font-bold uppercase tracking-wider text-[var(--accent)] bg-[var(--accent-light)] leading-none py-[3px]">{MONTHS[mo - 1]}</div>
                  <div className="text-base font-bold text-[var(--text-primary)] leading-none py-1">{d}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{it.title}</p>
                  <p className="text-[11px] text-[var(--text-muted)] truncate">{it.subtitle}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${p.cls}`}>
                  {p.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
