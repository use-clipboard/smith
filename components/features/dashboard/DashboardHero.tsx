'use client';

/**
 * DashboardHero — one large "what's on my plate today" panel pinned above the
 * customisable grid. A single card, split by a vertical divider:
 *
 *   • LEFT (Your SMITH Briefing) — a personal roll-up: unread emails, my overdue
 *     tasks, my tasks due this week, HR holidays awaiting my approval, and unread
 *     manager briefings ("readings"). Big clickable tiles + rule-based suggested
 *     actions. Computed, not AI.
 *   • RIGHT — a donut of the same totals (no title) with a colour legend, plus
 *     today's calendar count (shown even at 0, for peace of mind) and a "View all
 *     tasks" shortcut.
 *
 * Scope is deliberately PERSONAL — firm-wide views live in the grid below. Data
 * comes from the shared DashboardDataProvider (one set of calls for the page).
 */

import {
  Sparkles, Mail, CircleAlert, CalendarClock, CalendarDays,
  Plane, BookOpen, ArrowRight, ArrowUpRight, CheckSquare, HeartHandshake, Bell,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useEmailCount } from '@/components/ui/EmailCountProvider';
import { useTasksCount } from '@/components/ui/TasksCountProvider';
import { useNotifications } from '@/components/ui/NotificationsProvider';
import { useTabContext } from '@/components/ui/TabContext';
import { Donut } from '@/components/features/dashboard/widgets/shared';
import { useDashboardData } from '@/components/features/dashboard/DashboardDataProvider';

const C_EMAIL = '#4F46E5'; // indigo
const C_OVER  = '#ef4444'; // red
const C_WEEK  = '#f59e0b'; // amber
const C_HOL   = '#8b5cf6'; // violet — holidays to approve
const C_BRIEF = '#0d9488'; // teal — briefings to read
const C_NOTIF = '#ec4899'; // pink — header notifications
const C_CAL   = '#0ea5e9'; // sky — calendar events

export default function DashboardHero() {
  const { isModuleActive } = useModules();
  const { openTab } = useTabContext();
  const data = useDashboardData();
  const { count: emailCount, mode: emailMode } = useEmailCount();
  const emailTraditional = emailMode === 'traditional';
  const { counts: taskCounts } = useTasksCount();
  const { unreadCount: notifications } = useNotifications();

  const hasEmail = isModuleActive('email-triage');
  const hasTasks = isModuleActive('tasks');
  const hasHr = isModuleActive('hr');

  const loading = !data || data.loading;
  // "Emails to triage" = the shared uncategorised-inbox count from
  // EmailCountProvider (same number as the sidebar badge), NOT Gmail's unread
  // count. Kept null while the (slow) untriaged enumeration is still in flight
  // so the tile shows a loading state rather than flashing a misleading 0.
  const emails   = hasEmail ? emailCount : null;
  // Task counts come from the shared TasksCountProvider (same source as the
  // sidebar badge + Tasks widget). null while loading → tiles show a pulse.
  const overdue  = hasTasks ? (taskCounts?.overdue ?? null) : null;
  const dueWeek  = hasTasks ? (taskCounts?.dueWithin7 ?? null) : null;
  const toApprove = hasHr ? (data?.hr?.holidaysToApprove ?? 0) : null;
  const briefings = hasHr ? (data?.hr?.briefingsToRead ?? 0) : null;
  const calConnected = !!data?.calendar?.connected;
  const eventsToday = data?.calendar?.events?.length ?? 0;
  // Notifications come from the realtime NotificationsProvider (same source as
  // the header bell) so the tile updates the instant one arrives.

  const open = (id: string, title: string, route: string, icon: LucideIcon) =>
    openTab({ id, title, route, icon });
  // Notifications live in the header dropdown (no route) — ask TopBar to open it.
  const openNotifications = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('smith:open-notifications'));
  };

  // Actionable metrics — drive the tiles, the donut and the total.
  const metrics = [
    hasEmail && { key: 'emails',  label: emailTraditional ? 'Unread emails' : 'Emails to triage',   value: emails,    color: C_EMAIL, icon: Mail,         onClick: () => open('email-triage', 'Email', '/email', Mail) },
    { key: 'notifs',  label: 'Notifications',     value: notifications, color: C_NOTIF, icon: Bell,         onClick: openNotifications },
    hasTasks && { key: 'overdue', label: 'My overdue tasks',   value: overdue,   color: C_OVER,  icon: CircleAlert,  onClick: () => open('tasks', 'Tasks', '/tasks', CheckSquare) },
    hasTasks && { key: 'week',    label: 'Due this week',      value: dueWeek,   color: C_WEEK,  icon: CalendarClock, onClick: () => open('tasks', 'Tasks', '/tasks', CheckSquare) },
    hasHr    && { key: 'approve', label: 'Holidays to approve', value: toApprove, color: C_HOL,  icon: Plane,        onClick: () => open('hr', 'HR', '/hr', HeartHandshake) },
    hasHr    && { key: 'brief',   label: 'Briefings to read',  value: briefings, color: C_BRIEF, icon: BookOpen,     onClick: () => open('hr', 'HR', '/hr', HeartHandshake) },
    calConnected && { key: 'events', label: 'Events today',    value: eventsToday, color: C_CAL, icon: CalendarDays, onClick: () => open('google-calendar', 'Calendar', '/calendar', CalendarDays) },
  ].filter(Boolean) as { key: string; label: string; value: number | null; color: string; icon: LucideIcon; onClick: () => void }[];

  const total = metrics.reduce((s, m) => s + (m.value ?? 0), 0);

  // Rule-based suggested actions — top non-zero metrics, max 3.
  const suggestions = [
    (emails ?? 0) > 0    && { label: emailTraditional ? `Read ${emails} unread email${emails === 1 ? '' : 's'}` : `Triage ${emails} email${emails === 1 ? '' : 's'}`, onClick: () => open('email-triage', 'Email', '/email', Mail) },
    notifications > 0    && { label: `Check ${notifications} notification${notifications === 1 ? '' : 's'}`, onClick: openNotifications },
    (overdue ?? 0) > 0   && { label: `Clear ${overdue} overdue task${overdue === 1 ? '' : 's'}`, onClick: () => open('tasks', 'Tasks', '/tasks', CheckSquare) },
    (toApprove ?? 0) > 0 && { label: `Approve ${toApprove} holiday${toApprove === 1 ? '' : 's'}`, onClick: () => open('hr', 'HR', '/hr', HeartHandshake) },
    (briefings ?? 0) > 0 && { label: `Read ${briefings} briefing${briefings === 1 ? '' : 's'}`, onClick: () => open('hr', 'HR', '/hr', HeartHandshake) },
    (dueWeek ?? 0) > 0   && { label: `Plan ${dueWeek} due this week`, onClick: () => open('tasks', 'Tasks', '/tasks', CheckSquare) },
  ].filter(Boolean).slice(0, 3) as { label: string; onClick: () => void }[];

  return (
    <div className="glass rounded-xl p-4 lg:h-[260px]">
      <div className="flex flex-col lg:flex-row gap-4 h-full">
        {/* ── LEFT: Your SMITH Briefing ──────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-2 mb-3 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <Sparkles size={15} className="text-[var(--accent)]" />
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)] shrink-0">Your SMITH Briefing</span>
            {!loading && (
              <span className="ml-2 text-sm font-bold text-[var(--accent)] truncate">
                {total === 0
                  ? "You're all caught up 🎉"
                  : `· ${total} item${total === 1 ? '' : 's'} on your plate`}
              </span>
            )}
          </div>

          {loading ? (
            <HeroSkeleton rows={2} />
          ) : (
            <>
              {metrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  {metrics.map(m => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.key}
                        onClick={m.onClick}
                        className="group text-left rounded-lg px-2.5 py-1.5 bg-white/70 border border-[var(--border-card)] shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-white transition-all duration-150"
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <Icon size={12} style={{ color: m.color }} />
                          <ArrowUpRight size={11} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        {m.value === null ? (
                          <span className="inline-block w-5 h-5 rounded bg-current/15 animate-pulse" style={{ color: m.color }} />
                        ) : (
                          <p className="text-lg font-bold leading-none" style={{ color: m.color }}>{m.value}</p>
                        )}
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 leading-tight">{m.label}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {suggestions.length > 0 && (
                <div className="mt-auto pt-1 shrink-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Suggested actions</p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={s.onClick}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/60 border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
                      >
                        {s.label} <ArrowRight size={11} className="text-[var(--accent)] shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Vertical divider — soft gradient that fades at both ends ────── */}
        <div className="hidden lg:block w-px self-stretch bg-gradient-to-b from-transparent via-[var(--accent)]/35 to-transparent" />

        {/* ── RIGHT: donut (hover segments for labels) ───────────────────── */}
        <div className="lg:w-[170px] shrink-0 flex items-center justify-center">
          {loading ? (
            <HeroSkeleton rows={3} />
          ) : (
            <Donut
              segments={metrics.map(m => ({ value: m.value ?? 0, color: m.color, label: m.label }))}
              centerValue={total}
              centerSub="items"
              size={130}
              thickness={16}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function HeroSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex-1 flex flex-col gap-2.5 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-white/40" />
      ))}
    </div>
  );
}
