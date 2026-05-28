'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Calendar as CalIcon, Inbox, Cake, PartyPopper, Plane, Loader2, ChevronRight, ShieldCheck, Clock, FileWarning, X,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import type { TeamMember, HolidayRow, BalanceInfo } from './HrClient';

interface Props {
  userId: string;
  userRole: 'admin' | 'staff';
  team: TeamMember[];
  isManagerOfSomeone: boolean;
  onJumpTo: (top: 'holidays' | 'people' | 'resources', sub?: string) => void;
}

interface ProbationLite { id: string; user_id: string; end_date: string | null; status: string }
interface RtwLite { id: string; user_id: string; expiry_date: string | null }

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const fmtDay = (iso: string): string => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const isOnDate = (h: HolidayRow, iso: string): boolean => h.start_date <= iso && h.end_date >= iso;

export default function OverviewTab({ userId, userRole, team, isManagerOfSomeone, onJumpTo }: Props) {
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [toilBalance, setToilBalance] = useState<number | null>(null);
  const [myHolidays, setMyHolidays] = useState<HolidayRow[]>([]);
  const [teamHolidays, setTeamHolidays] = useState<HolidayRow[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const isAdmin = userRole === 'admin';
  const showManagerCards = isAdmin || isManagerOfSomeone;

  const load = useCallback(async () => {
    setLoading(true);
    const promises: Promise<unknown>[] = [
      fetch(`/api/hr/holidays/balance?userId=${userId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/hr/personnel/toil?userId=${userId}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/hr/holidays?scope=mine`).then(r => r.ok ? r.json() : { holidays: [] }),
    ];
    // Firm-wide approved holidays — used to render "who's out today / next 7 days"
    promises.push(fetch(`/api/hr/holidays?scope=firm`).then(r => r.ok ? r.json() : { holidays: [] }));
    if (showManagerCards) {
      promises.push(fetch(`/api/hr/holidays?scope=team&status=pending`).then(r => r.ok ? r.json() : { holidays: [] }));
    }
    const results = await Promise.all(promises);
    const [b, t, m, firmApproved, teamPending] = results as [
      BalanceInfo | null,
      { balance?: number } | null,
      { holidays?: HolidayRow[] },
      { holidays?: HolidayRow[] } | undefined,
      { holidays?: HolidayRow[] } | undefined,
    ];
    setBalance(b);
    setToilBalance(t && typeof t.balance === 'number' ? t.balance : null);
    setMyHolidays(m.holidays ?? []);
    setTeamHolidays(firmApproved?.holidays ?? []);
    setPendingCount(teamPending?.holidays?.length ?? 0);
    setLoading(false);
  }, [userId, showManagerCards]);

  useEffect(() => { void load(); }, [load]);

  // ── Derived data ────────────────────────────────────────────────────
  const today = todayIso();
  const in14 = addDays(today, 14);
  const in7 = addDays(today, 7);

  const me = team.find(m => m.id === userId);
  const myUpcoming = useMemo(() =>
    myHolidays
      .filter(h => h.status !== 'cancelled' && h.status !== 'rejected' && h.end_date >= today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .slice(0, 3),
    [myHolidays, today],
  );

  const outToday = useMemo(() =>
    teamHolidays.filter(h => isOnDate(h, today) && h.user_id !== userId),
    [teamHolidays, today, userId],
  );
  const outThisWeek = useMemo(() => {
    const seen = new Set<string>();
    const outTodayIds = new Set(outToday.map(h => h.user_id));
    const tomorrow = addDays(today, 1);
    return teamHolidays
      .filter(h => h.user_id !== userId && !outTodayIds.has(h.user_id))
      .filter(h => h.end_date >= tomorrow && h.start_date <= in7)
      .filter(h => { if (seen.has(h.user_id)) return false; seen.add(h.user_id); return true; })
      .slice(0, 8);
  }, [teamHolidays, today, in7, userId, outToday]);

  // Birthdays + anniversaries in the next 12 months, sorted by date. The
  // dashboard card shows the next two weeks (events14); the "See all"
  // lightbox renders the full 12-month list.
  const allUpcomingEvents = useMemo(() => {
    type Evt = { kind: 'birthday' | 'anniversary'; user: TeamMember; date: string; years?: number };
    const list: Evt[] = [];
    for (const m of team) {
      if (m.id === userId) continue; // don't list self
      if (m.show_birthday_to_team && m.date_of_birth) {
        const next = nextOccurrence(m.date_of_birth);
        if (next) list.push({ kind: 'birthday', user: m, date: next });
      }
      if (m.employment_start_date) {
        const next = nextOccurrence(m.employment_start_date);
        if (next) {
          const years = parseInt(next.slice(0, 4), 10) - parseInt(m.employment_start_date.slice(0, 4), 10);
          if (years > 0) list.push({ kind: 'anniversary', user: m, date: next, years });
        }
      }
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [team, userId]);

  const events = useMemo(
    () => allUpcomingEvents.filter(e => e.date <= in14).slice(0, 6),
    [allUpcomingEvents, in14],
  );

  const [showAllEvents, setShowAllEvents] = useState(false);

  if (loading && !balance) {
    return <div className="text-center py-12 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin inline mr-1.5" />Loading dashboard…</div>;
  }

  return (
    <div className="space-y-5">
      {/* Welcome + balance strip */}
      <div className="bg-gradient-to-br from-[var(--accent-light)] to-white border border-[var(--border)] rounded-2xl p-5">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Hi {(me?.full_name ?? '').split(' ')[0] || 'there'}
        </h2>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">Here's what's happening across your HR space today.</p>
        {balance && (
          <div className={`grid grid-cols-2 sm:grid-cols-${toilBalance != null ? 5 : 4} gap-3 mt-4`}>
            <BalanceCard
              label={balance.pro_rated ? 'Entitlement (pro-rata)' : 'Entitlement'}
              value={balance.entitlement}
              suffix="days"
              tone="white"
              hint={balance.pro_rated && balance.annual_entitlement != null
                ? `Pro-rated for your first holiday year — your full annual entitlement is ${balance.annual_entitlement} days.`
                : undefined}
            />
            <BalanceCard label="Used" value={balance.used} suffix="days" tone="emerald" />
            <BalanceCard label="Pending" value={balance.pending} suffix="days" tone="amber" />
            <BalanceCard label="Remaining" value={balance.remaining} suffix="days" tone="bold" />
            {toilBalance != null && <BalanceCard label="TOIL" value={toilBalance} suffix="hours" tone="purple" />}
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* My next holidays */}
        <DashCard title="My upcoming holidays" icon={Plane} cta={{ label: 'See all', onClick: () => onJumpTo('holidays', 'mine') }}>
          {myUpcoming.length === 0 ? (
            <EmptyMini msg="No holidays booked." action={{ label: 'Request one', onClick: () => onJumpTo('holidays', 'mine') }} />
          ) : (
            <ul className="space-y-2">
              {myUpcoming.map(h => (
                <li key={h.id} className="flex items-center gap-2 text-sm flex-wrap">
                  <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${h.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{h.status}</span>
                  <span className="flex-1 min-w-0 truncate">
                    {fmtDay(h.start_date)}{h.start_date !== h.end_date ? ` → ${fmtDay(h.end_date)}` : ''} · <span className="font-medium">{h.total_days} day{h.total_days === 1 ? '' : 's'}</span>
                  </span>
                  {h.is_bank_holiday && (
                    <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700" title={h.bank_holiday_title ?? 'Bank holiday'}>
                      Bank holiday
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        {/* Who's out today/this week */}
        <DashCard title="Who's out" icon={UsersAvatarsIcon} cta={{ label: 'Calendar', onClick: () => onJumpTo('holidays', 'calendar') }}>
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Today</p>
              {outToday.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic">No-one out today.</p>
              ) : (
                <PersonChips holidays={outToday} team={team} />
              )}
            </div>
            {outThisWeek.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Next 7 days</p>
                <PersonChips holidays={outThisWeek} team={team} showSpan />
              </div>
            )}
          </div>
        </DashCard>

        {/* Birthdays + anniversaries */}
        <DashCard
          title="Coming up"
          icon={PartyPopper}
          cta={allUpcomingEvents.length > 0 ? { label: 'See all', onClick: () => setShowAllEvents(true) } : undefined}
        >
          {events.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic">No birthdays or work anniversaries in the next two weeks.</p>
          ) : (
            <ul className="space-y-2">
              {events.map((e, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarColour(e.user.id)}`}>
                    {initials(e.user.full_name, e.user.email)}
                  </div>
                  <span className="flex-1 min-w-0 truncate">
                    {e.kind === 'birthday' ? <Cake size={12} className="inline text-pink-500 mr-1" /> : <span className="mr-1">🎉</span>}
                    <span className="font-medium">{e.user.full_name?.split(' ')[0] ?? e.user.email}</span>
                    <span className="text-[var(--text-muted)]"> · {e.kind === 'birthday' ? 'birthday' : `${e.years}-year`}</span>
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{fmtDay(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </DashCard>

        {/* Manager: pending approvals */}
        {showManagerCards && (
          <DashCard
            title="Approvals"
            icon={Inbox}
            cta={{ label: 'Review', onClick: () => onJumpTo('holidays', 'approvals') }}
            tone={pendingCount > 0 ? 'amber' : undefined}
          >
            {pendingCount === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic">Nothing waiting on you. ✨</p>
            ) : (
              <p className="text-sm">
                <span className="text-2xl font-bold text-amber-700">{pendingCount}</span>
                <span className="ml-2 text-[var(--text-secondary)]">holiday request{pendingCount === 1 ? '' : 's'} need a decision.</span>
              </p>
            )}
          </DashCard>
        )}

        {/* Manager: probation reviews due / RTW expiring */}
        {showManagerCards && <PersonnelAlertsCard team={team} userId={userId} userRole={userRole} onJumpTo={onJumpTo} />}
      </div>

      {showAllEvents && (
        <UpcomingEventsLightbox
          events={allUpcomingEvents}
          onClose={() => setShowAllEvents(false)}
        />
      )}
    </div>
  );
}

// ── Upcoming events lightbox (12-month birthdays + work anniversaries) ──
function UpcomingEventsLightbox({
  events, onClose,
}: {
  events: Array<{ kind: 'birthday' | 'anniversary'; user: TeamMember; date: string; years?: number }>;
  onClose: () => void;
}) {
  // Close on Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group events by month label ("Jun 2026") so a long list scans more
  // easily than a flat alternating birthday/anniversary stream.
  const groups: Array<{ label: string; items: typeof events }> = [];
  for (const e of events) {
    const label = new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-[var(--border)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="inline-flex items-center gap-2">
            <PartyPopper size={15} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Birthdays & work anniversaries · next 12 months
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-all"
          >
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3 scrollbar-thin flex-1">
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)] italic">
              No birthdays or work anniversaries in the next 12 months.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map(g => (
                <div key={g.label}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                    {g.label}
                  </p>
                  <ul className="space-y-1.5">
                    {g.items.map((e, i) => (
                      <li key={`${e.user.id}-${e.kind}-${i}`} className="flex items-center gap-3 text-sm py-1.5">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 ${avatarColour(e.user.id)}`}>
                          {initials(e.user.full_name, e.user.email)}
                        </div>
                        <span className="flex-1 min-w-0 truncate">
                          {e.kind === 'birthday'
                            ? <Cake size={12} className="inline text-pink-500 mr-1" />
                            : <span className="mr-1">🎉</span>}
                          <span className="font-medium text-[var(--text-primary)]">{e.user.full_name ?? e.user.email}</span>
                          <span className="text-[var(--text-muted)]"> · {e.kind === 'birthday' ? 'birthday' : `${e.years}-year anniversary`}</span>
                        </span>
                        <span className="text-xs text-[var(--text-muted)] tabular-nums shrink-0">{fmtDay(e.date)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Smaller bits ───────────────────────────────────────────────────────
function UsersAvatarsIcon({ size = 16 }: { size?: number }) {
  return <Plane size={size} className="rotate-45" />;
}

function DashCard({ title, icon: Icon, cta, tone, children }: {
  title: string;
  icon: React.ElementType;
  cta?: { label: string; onClick: () => void };
  tone?: 'amber';
  children: React.ReactNode;
}) {
  const border = tone === 'amber' ? 'border-amber-300 bg-amber-50/40' : 'border-[var(--border)] bg-white';
  return (
    <div className={`rounded-xl border ${border} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Icon size={14} className="text-[var(--accent)]" />{title}
        </div>
        {cta && (
          <button onClick={cta.onClick} className="text-[11px] text-[var(--accent)] hover:underline inline-flex items-center gap-0.5">
            {cta.label}<ChevronRight size={11} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyMini({ msg, action }: { msg: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="text-xs text-[var(--text-muted)] italic">
      {msg}
      {action && <> <button onClick={action.onClick} className="ml-1 not-italic text-[var(--accent)] hover:underline">{action.label} →</button></>}
    </div>
  );
}

function PersonChips({ holidays, team, showSpan }: { holidays: HolidayRow[]; team: TeamMember[]; showSpan?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {holidays.map(h => {
        const member = team.find(m => m.id === h.user_id);
        const name = member?.full_name?.split(' ')[0] ?? member?.email ?? 'Someone';
        return (
          <Tooltip key={h.id} label={`${member?.full_name ?? member?.email ?? ''} — ${fmtDay(h.start_date)}${h.start_date !== h.end_date ? ` → ${fmtDay(h.end_date)}` : ''}`}>
            <div className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full pr-2.5 py-0.5 pl-0.5">
              <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${avatarColour(h.user_id)}`}>
                {initials(member?.full_name ?? null, member?.email ?? '?')}
              </div>
              <span className="text-xs font-medium">{name}</span>
              {showSpan && <span className="text-[10px] text-[var(--text-muted)]">{fmtDay(h.start_date)}</span>}
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function BalanceCard({ label, value, suffix, tone, hint }: { label: string; value: number; suffix: string; tone: 'white' | 'emerald' | 'amber' | 'bold' | 'purple'; hint?: string }) {
  const map: Record<typeof tone, string> = {
    white:   'bg-white text-[var(--accent)] border-white/60',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    bold:    'bg-gray-900 text-white border-gray-900',
    purple:  'bg-purple-50 text-purple-700 border-purple-200',
  };
  return (
    <div className={`rounded-xl border p-3 ${map[tone]}`} title={hint}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}<span className="text-xs font-medium ml-1 opacity-70">{suffix}</span></p>
      {hint && <p className="text-[10px] mt-1 opacity-75 leading-snug">{hint}</p>}
    </div>
  );
}

function PersonnelAlertsCard({ team, userId, userRole, onJumpTo }: {
  team: TeamMember[]; userId: string; userRole: 'admin' | 'staff'; onJumpTo: Props['onJumpTo'];
}) {
  const [probationItems, setProbationItems] = useState<Array<{ user: TeamMember; end_date: string }>>([]);
  const [rtwItems, setRtwItems] = useState<Array<{ user: TeamMember; expiry_date: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const targets = userRole === 'admin' ? team : team.filter(m => m.manager_id === userId);
    const horizon = addDays(todayIso(), 60);
    const today = todayIso();

    Promise.all(targets.map(async u => {
      const [pRes, rRes] = await Promise.all([
        fetch(`/api/hr/personnel/probation?userId=${u.id}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/hr/personnel/right-to-work?userId=${u.id}`).then(r => r.ok ? r.json() : null),
      ]);
      const probation: ProbationLite | null = pRes?.record ?? null;
      const rtw: RtwLite | null = rRes?.record ?? null;
      return { user: u, probation, rtw };
    })).then(rows => {
      if (cancelled) return;
      const probDue: Array<{ user: TeamMember; end_date: string }> = [];
      const rtwExp: Array<{ user: TeamMember; expiry_date: string }> = [];
      for (const r of rows) {
        if (r.probation && r.probation.status === 'active' && r.probation.end_date && r.probation.end_date >= today && r.probation.end_date <= horizon) {
          probDue.push({ user: r.user, end_date: r.probation.end_date });
        }
        if (r.rtw && r.rtw.expiry_date && r.rtw.expiry_date >= today && r.rtw.expiry_date <= horizon) {
          rtwExp.push({ user: r.user, expiry_date: r.rtw.expiry_date });
        }
      }
      setProbationItems(probDue.sort((a, b) => a.end_date.localeCompare(b.end_date)));
      setRtwItems(rtwExp.sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [team, userId, userRole]);

  const total = probationItems.length + rtwItems.length;

  return (
    <DashCard title="Action items" icon={FileWarning} tone={total > 0 ? 'amber' : undefined} cta={{ label: 'Team Profiles', onClick: () => onJumpTo('people', 'team-profiles') }}>
      {loading ? (
        <p className="text-xs text-[var(--text-muted)]"><Loader2 size={11} className="inline animate-spin mr-1" />Checking…</p>
      ) : total === 0 ? (
        <p className="text-xs text-[var(--text-muted)] italic">Nothing needs attention in the next 60 days.</p>
      ) : (
        <div className="space-y-2">
          {probationItems.slice(0, 3).map(p => (
            <div key={p.user.id} className="flex items-center gap-2 text-xs">
              <ShieldCheck size={12} className="text-amber-600" />
              <span className="font-medium">{p.user.full_name?.split(' ')[0] ?? p.user.email}</span>
              <span className="text-[var(--text-muted)]">probation ends {fmtDay(p.end_date)}</span>
            </div>
          ))}
          {rtwItems.slice(0, 3).map(r => (
            <div key={r.user.id} className="flex items-center gap-2 text-xs">
              <Clock size={12} className="text-amber-600" />
              <span className="font-medium">{r.user.full_name?.split(' ')[0] ?? r.user.email}</span>
              <span className="text-[var(--text-muted)]">RTW doc expires {fmtDay(r.expiry_date)}</span>
            </div>
          ))}
          {total > 6 && <p className="text-[11px] text-[var(--text-muted)] italic">+{total - 6} more</p>}
        </div>
      )}
    </DashCard>
  );
}

// Get the next future occurrence of a M-D from today (handles year wrap).
function nextOccurrence(iso: string): string | null {
  if (!iso) return null;
  const today = new Date();
  const month = parseInt(iso.slice(5, 7), 10) - 1;
  const day = parseInt(iso.slice(8, 10), 10);
  if (isNaN(month) || isNaN(day)) return null;
  const thisYear = new Date(today.getFullYear(), month, day);
  const candidate = thisYear < today
    ? new Date(today.getFullYear() + 1, month, day)
    : thisYear;
  return candidate.toISOString().slice(0, 10);
}
