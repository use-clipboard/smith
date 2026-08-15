'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { BADGE_REFRESH_EVENT } from '@/lib/notificationTarget';
import { useSearchParams } from 'next/navigation';
import {
  HeartHandshake, Calendar as CalIcon, Inbox, Network, Plus, Loader2,
  Check, X, AlertTriangle, ChevronRight, ChevronDown, Users as UsersIcon, Filter, Activity, Sparkles, ShieldAlert, BookOpen, User as UserIcon, Users2, LayoutDashboard, BookOpenCheck, Edit3, Trash2, UserPlus,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import HrOrgChart from './HrOrgChart';
import HolidayRequestModal from './HolidayRequestModal';
import HolidayDirectEntryModal from './HolidayDirectEntryModal';
import AbsenceTab from './AbsenceTab';
import AiAdviceTab from './AiAdviceTab';
import ConfidentialTab from './ConfidentialTab';
import EmploymentRightsTab from './EmploymentRightsTab';
import ProfileTab from './ProfileTab';
import TeamProfilesTab from './TeamProfilesTab';
import OverviewTab from './OverviewTab';
import HolidayCalendarView from './HolidayCalendarView';
import HolidayTrackerView from './HolidayTrackerView';
import JoinerWizardModal from './JoinerWizardModal';
import ManagerBriefingsTab from './ManagerBriefingsTab';

type TopTab = 'overview' | 'holidays' | 'people' | 'resources';
type HolidaysSub = 'mine' | 'calendar' | 'tracker' | 'approvals' | 'team' | 'absence';
type PeopleSub = 'profile' | 'team-profiles' | 'orgchart';
type ResourcesSub = 'advice' | 'briefings' | 'confidential' | 'rights';

const RESOURCES_SUBS: ResourcesSub[] = ['advice', 'briefings', 'confidential', 'rights'];

/** Read the requested top tab + section from the URL. Prefers the live
 *  `window.location` (set via history.replaceState when HR is opened as an
 *  in-app tab from an email link) and falls back to the Next.js search params
 *  for SSR / full-page loads (e.g. following the link from a real inbox). */
function readInitialHrNav(params: { get(key: string): string | null }): { tab: string | null; section: string | null } {
  let tab: string | null = null;
  let section: string | null = null;
  if (typeof window !== 'undefined') {
    const sp = new URLSearchParams(window.location.search);
    tab = sp.get('tab');
    section = sp.get('section');
  }
  return { tab: tab ?? params.get('tab'), section: section ?? params.get('section') };
}

export interface TeamMember {
  id: string;
  full_name: string | null;
  email: string;
  role: 'admin' | 'staff';
  department_id: string | null;
  manager_id: string | null;
  job_title: string | null;
  job_description: string | null;
  employment_start_date: string | null;
  holiday_entitlement_days_override: number | null;
  /** When true and `employment_start_date` falls inside the firm's current
   *  holiday window, balance/tracker views show the prorated this-year
   *  entitlement instead of the full annual figure. The flag is a no-op
   *  once the year rolls over (start date is no longer in window). */
  pro_rata_first_year: boolean;
  date_of_birth: string | null;
  show_birthday_to_team: boolean;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  parent_department_id: string | null;
  color: string | null;
  display_order: number | null;
}

export interface HolidayRow {
  id: string;
  user_id: string;
  manager_id: string | null;
  start_date: string;
  start_half: 'full' | 'morning' | 'afternoon';
  end_date: string;
  end_half: 'full' | 'morning' | 'afternoon';
  total_days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  source: 'request' | 'direct';
  rejection_reason: string | null;
  pushed_to_calendar: boolean;
  is_bank_holiday: boolean;
  bank_holiday_title: string | null;
  decided_at: string | null;
  created_at: string;
  requester: { id: string; full_name: string | null; email: string } | null;
  manager: { id: string; full_name: string | null; email: string } | null;
}

export interface BalanceInfo {
  user_id: string;
  year: { start: string; end: string; reset_month: number; reset_day: number };
  /** Effective entitlement for the CURRENT holiday year. Equals the annual
   *  figure unless the user is a first-year pro-rata starter. */
  entitlement: number;
  /** Full annual entitlement (override or firm default). Independent of
   *  pro-rata. */
  annual_entitlement?: number;
  /** True when the entitlement above has been reduced from the annual
   *  figure because of the first-year pro-rata flag. */
  pro_rated?: boolean;
  used: number;
  pending: number;
  remaining: number;
}

const HALF_LABEL: Record<string, string> = { full: '', morning: 'Morning only', afternoon: 'Afternoon only' };

function fmtSpan(h: HolidayRow): string {
  const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  const start = fmt(h.start_date);
  const end = h.start_date === h.end_date ? null : fmt(h.end_date);
  let s = end ? `${start} → ${end}` : start;
  if (h.start_date === h.end_date && h.start_half !== 'full') s += ` · ${HALF_LABEL[h.start_half]}`;
  if (h.start_date !== h.end_date && (h.start_half !== 'full' || h.end_half !== 'full')) {
    const parts: string[] = [];
    if (h.start_half !== 'full') parts.push(`from ${h.start_half}`);
    if (h.end_half !== 'full') parts.push(`to ${h.end_half}`);
    s += ` · ${parts.join(', ')}`;
  }
  return s;
}

const STATUS_BADGE: Record<HolidayRow['status'], string> = {
  pending:   'bg-amber-100 text-amber-700',
  approved:  'bg-emerald-100 text-emerald-700',
  rejected:  'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

export default function HrClient() {
  const params = useSearchParams();
  const initialNav = readInitialHrNav(params);
  const initialTopTab = (initialNav.tab as TopTab) || 'overview';
  const initialResourcesSub = RESOURCES_SUBS.includes(initialNav.section as ResourcesSub)
    ? (initialNav.section as ResourcesSub)
    : 'advice';
  const [topTab, setTopTab] = useState<TopTab>(initialTopTab);
  const [holidaysSub, setHolidaysSub] = useState<HolidaysSub>('mine');
  const [peopleSub, setPeopleSub] = useState<PeopleSub>('profile');
  const [resourcesSub, setResourcesSub] = useState<ResourcesSub>(initialResourcesSub);

  // Respond to a deep-link fired when the HR tab is opened from an in-app link
  // (e.g. the manager-briefing email button) while HR is ALREADY open — it
  // stays mounted across tab switches, so it won't re-read the URL on its own.
  useEffect(() => {
    function onDeepLink(e: Event) {
      const detail = (e as CustomEvent).detail as { tab?: string | null; section?: string | null };
      if (detail?.tab) setTopTab(detail.tab as TopTab);
      if (detail?.section && RESOURCES_SUBS.includes(detail.section as ResourcesSub)) {
        setResourcesSub(detail.section as ResourcesSub);
        if (!detail.tab) setTopTab('resources');
      }
    }
    window.addEventListener('smith:hr-deeplink', onDeepLink);
    return () => window.removeEventListener('smith:hr-deeplink', onDeepLink);
  }, []);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const [userRole, setUserRole] = useState<'admin' | 'staff'>('staff');
  const [quickRequestOpen, setQuickRequestOpen] = useState(false);
  const [joinerWizardOpen, setJoinerWizardOpen] = useState(false);
  const [badges, setBadges] = useState<{
    pendingApprovals: number;
    holidayDecisions: number;
    newBriefings: number;
    newDisclosures: number;
  }>({ pendingApprovals: 0, holidayDecisions: 0, newBriefings: 0, newDisclosures: 0 });

  const refreshBadges = useCallback(() => {
    fetch('/api/hr/badge-counts')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        setBadges({
          pendingApprovals: d.pendingApprovals ?? 0,
          holidayDecisions: d.holidayDecisions ?? 0,
          newBriefings: d.newBriefings ?? 0,
          newDisclosures: d.newDisclosures ?? 0,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshBadges();
    // Realtime: a notification change (via the provider) or an in-tool approval
    // fires this event; the 2-min poll is just a fallback.
    const id = setInterval(refreshBadges, 2 * 60 * 1000);
    window.addEventListener(BADGE_REFRESH_EVENT, refreshBadges);
    return () => { clearInterval(id); window.removeEventListener(BADGE_REFRESH_EVENT, refreshBadges); };
  }, [refreshBadges]);

  // Mark relevant notifications as read when the user opens the sub-tab that surfaces them
  useEffect(() => {
    if (topTab !== 'holidays' || holidaysSub !== 'mine') return;
    fetch('/api/notifications?types=hr_holiday_decided,hr_holiday_cancelled', { method: 'PATCH' })
      .finally(refreshBadges);
  }, [topTab, holidaysSub, refreshBadges]);
  useEffect(() => {
    if (topTab !== 'resources' || resourcesSub !== 'briefings') return;
    fetch('/api/notifications?types=hr_briefing_published', { method: 'PATCH' })
      .finally(refreshBadges);
  }, [topTab, resourcesSub, refreshBadges]);
  useEffect(() => {
    if (topTab !== 'resources' || resourcesSub !== 'confidential') return;
    fetch('/api/notifications?types=hr_disclosure_filed,hr_disclosure_replied', { method: 'PATCH' })
      .finally(refreshBadges);
  }, [topTab, resourcesSub, refreshBadges]);

  const reloadTeam = useCallback(async () => {
    const [tRes, dRes] = await Promise.all([
      fetch('/api/hr/team').then(r => r.ok ? r.json() : { members: [] }),
      fetch('/api/hr/departments').then(r => r.ok ? r.json() : { departments: [] }),
    ]);
    setTeam(tRes.members ?? []);
    setDepartments(dRes.departments ?? []);
  }, []);

  // Merge a freshly-saved member back into the team list so the profile
  // header, list rows, and any subject-prop consumers reflect the new value
  // immediately — no page refresh needed. The sections call this with the
  // row the PATCH response returns.
  const patchMemberInState = useCallback((updated: Partial<TeamMember> & { id: string }) => {
    setTeam(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } as TeamMember : m));
  }, []);

  // Determine if the current user manages anyone, so we can show the Approvals tab.
  const isManagerOfSomeone = useMemo(
    () => !!userId && team.some(m => m.manager_id === userId),
    [team, userId],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/users/me').then(r => r.ok ? r.json() : null),
      fetch('/api/hr/team').then(r => r.ok ? r.json() : { members: [] }),
      fetch('/api/hr/departments').then(r => r.ok ? r.json() : { departments: [] }),
    ]).then(([me, t, d]) => {
      if (cancelled) return;
      if (me) {
        setUserId(me.userId ?? '');
        setUserRole(me.userRole === 'admin' ? 'admin' : 'staff');
      }
      setTeam(t.members ?? []);
      setDepartments(d.departments ?? []);
    }).finally(() => { if (!cancelled) setLoadingTeam(false); });
    return () => { cancelled = true; };
  }, []);

  const showManagerActions = isManagerOfSomeone || userRole === 'admin';
  const headerPill = (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 glass-solid rounded-full border border-[var(--border)] px-2 py-1 shadow-sm">
        <Tooltip label="Calendar view">
          <button
            onClick={() => { setTopTab('holidays'); setHolidaysSub('calendar'); }}
            aria-label="Calendar view"
            className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
          >
            <CalIcon size={15} />
          </button>
        </Tooltip>
        {showManagerActions && (
          <Tooltip label="Holiday approvals">
            <button
              onClick={() => { setTopTab('holidays'); setHolidaysSub('approvals'); }}
              aria-label="Holiday approvals"
              className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
            >
              <Inbox size={15} />
            </button>
          </Tooltip>
        )}
        {showManagerActions && (
          <Tooltip label="Record absence">
            <button
              onClick={() => { setTopTab('holidays'); setHolidaysSub('absence'); }}
              aria-label="Record absence"
              className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
            >
              <Activity size={15} />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Team holidays">
          <button
            onClick={() => { setTopTab('holidays'); setHolidaysSub(showManagerActions ? 'team' : 'mine'); }}
            aria-label="Team holidays"
            className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
          >
            <UsersIcon size={15} />
          </button>
        </Tooltip>
        {userRole === 'admin' && (
          <Tooltip label="Add a new joiner">
            <button
              onClick={() => setJoinerWizardOpen(true)}
              aria-label="Add a new joiner"
              className="p-1.5 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
            >
              <UserPlus size={15} />
            </button>
          </Tooltip>
        )}
      </div>
      <Tooltip label="Request holiday">
        <button
          onClick={() => setQuickRequestOpen(true)}
          aria-label="Request holiday"
          className="p-2.5 rounded-full bg-[var(--accent)] text-white hover:opacity-90 transition-opacity shadow-sm"
        >
          <Plus size={16} />
        </button>
      </Tooltip>
    </div>
  );

  return (
    <ToolLayout
      title="HR"
      description="Holiday requests, team structure, and the firm org chart."
      icon={HeartHandshake}
      iconColor="#9333EA"
      wide
    >
      {/* Top-level tabs (underline style) with the action pill in line on the right */}
      <div className="flex items-end justify-between gap-3 mb-5 border-b border-[var(--border)]">
        <div className="flex items-center flex-wrap">
          <TabBtn active={topTab === 'overview'}  onClick={() => setTopTab('overview')}  icon={LayoutDashboard} label="Overview" />
          <TabBtn active={topTab === 'holidays'}  onClick={() => setTopTab('holidays')}  icon={CalIcon}         label="Holidays & Absence" badge={badges.pendingApprovals + badges.holidayDecisions} />
          <TabBtn active={topTab === 'people'}    onClick={() => setTopTab('people')}    icon={UsersIcon}       label="People" />
          <TabBtn active={topTab === 'resources'} onClick={() => setTopTab('resources')} icon={BookOpenCheck}   label="Resources" badge={badges.newBriefings + badges.newDisclosures} />
        </div>
        {userId && <div className="pb-2 shrink-0">{headerPill}</div>}
      </div>

      {/* Sub-tabs */}
      {topTab === 'holidays' && (
        <div className="flex flex-wrap gap-2 mb-5">
          <SubTabBtn active={holidaysSub === 'mine'}     onClick={() => setHolidaysSub('mine')}     icon={CalIcon}  label="My Holidays" badge={badges.holidayDecisions} />
          <SubTabBtn active={holidaysSub === 'calendar'} onClick={() => setHolidaysSub('calendar')} icon={CalIcon}  label="Calendar" />
          <SubTabBtn active={holidaysSub === 'tracker'}  onClick={() => setHolidaysSub('tracker')}  icon={LayoutDashboard} label="Tracker" />
          {(isManagerOfSomeone || userRole === 'admin') && (
            <SubTabBtn active={holidaysSub === 'approvals'} onClick={() => setHolidaysSub('approvals')} icon={Inbox} label="Approvals" badge={badges.pendingApprovals} />
          )}
          {(isManagerOfSomeone || userRole === 'admin') && (
            <SubTabBtn active={holidaysSub === 'team'} onClick={() => setHolidaysSub('team')} icon={UsersIcon} label="Team Holidays" />
          )}
          <SubTabBtn active={holidaysSub === 'absence'} onClick={() => setHolidaysSub('absence')} icon={Activity} label="Absence" />
        </div>
      )}
      {topTab === 'people' && (
        <div className="flex flex-wrap gap-2 mb-5">
          <SubTabBtn active={peopleSub === 'profile'} onClick={() => setPeopleSub('profile')} icon={UserIcon} label="My Profile" />
          {(isManagerOfSomeone || userRole === 'admin') && (
            <SubTabBtn active={peopleSub === 'team-profiles'} onClick={() => setPeopleSub('team-profiles')} icon={Users2} label="Team Profiles" />
          )}
          <SubTabBtn active={peopleSub === 'orgchart'} onClick={() => setPeopleSub('orgchart')} icon={Network} label="Org Chart" />
        </div>
      )}
      {topTab === 'resources' && (
        <div className="flex flex-wrap gap-2 mb-5">
          <SubTabBtn active={resourcesSub === 'advice'}       onClick={() => setResourcesSub('advice')}       icon={Sparkles}    label="AI HR Advice" />
          <SubTabBtn active={resourcesSub === 'briefings'}    onClick={() => setResourcesSub('briefings')}    icon={BookOpenCheck} label="Manager Briefings" badge={badges.newBriefings} />
          <SubTabBtn active={resourcesSub === 'confidential'} onClick={() => setResourcesSub('confidential')} icon={ShieldAlert} label="Confidential" badge={badges.newDisclosures} />
          <SubTabBtn active={resourcesSub === 'rights'}       onClick={() => setResourcesSub('rights')}       icon={BookOpen}    label="Employment Rights" />
        </div>
      )}

      {/* Content */}
      {!userId && topTab !== 'resources' && <Loader />}

      {topTab === 'overview' && userId && (
        <OverviewTab
          userId={userId}
          userRole={userRole}
          team={team}
          isManagerOfSomeone={isManagerOfSomeone}
          onJumpTo={(top, sub) => {
            setTopTab(top);
            if (top === 'holidays' && sub) setHolidaysSub(sub as HolidaysSub);
            if (top === 'people' && sub) setPeopleSub(sub as PeopleSub);
            if (top === 'resources' && sub) setResourcesSub(sub as ResourcesSub);
          }}
          onRequestHoliday={() => setQuickRequestOpen(true)}
        />
      )}

      {topTab === 'holidays' && userId && (
        <>
          {holidaysSub === 'mine'      && <MyHolidaysTab userId={userId} />}
          {holidaysSub === 'calendar'  && <HolidayCalendarView team={team} userId={userId} userRole={userRole} />}
          {holidaysSub === 'tracker'   && <HolidayTrackerView team={team} departments={departments} userId={userId} userRole={userRole} />}
          {holidaysSub === 'approvals' && <ApprovalsTab userId={userId} />}
          {holidaysSub === 'team'      && <TeamHolidaysTab userId={userId} userRole={userRole} team={team} />}
          {holidaysSub === 'absence'   && <AbsenceTab userId={userId} userRole={userRole} team={team} />}
        </>
      )}

      {topTab === 'people' && userId && (
        <>
          {peopleSub === 'profile'       && <ProfileTab userId={userId} viewerId={userId} viewerRole={userRole} team={team} onMemberUpdated={patchMemberInState} />}
          {peopleSub === 'team-profiles' && <TeamProfilesTab viewerId={userId} viewerRole={userRole} team={team} onMemberUpdated={patchMemberInState} />}
          {peopleSub === 'orgchart'      && (loadingTeam ? <Loader /> : <HrOrgChart team={team} departments={departments} />)}
        </>
      )}

      {topTab === 'resources' && (
        <>
          {resourcesSub === 'advice'       && <AiAdviceTab />}
          {resourcesSub === 'briefings'    && <ManagerBriefingsTab isAdmin={userRole === 'admin'} />}
          {resourcesSub === 'confidential' && userId && <ConfidentialTab userId={userId} team={team} />}
          {resourcesSub === 'rights'       && <EmploymentRightsTab />}
        </>
      )}

      <HolidayRequestModal
        isOpen={quickRequestOpen}
        onClose={() => setQuickRequestOpen(false)}
        onSaved={() => { setQuickRequestOpen(false); setTopTab('holidays'); setHolidaysSub('mine'); }}
      />

      <JoinerWizardModal
        isOpen={joinerWizardOpen}
        onClose={() => setJoinerWizardOpen(false)}
        onCreated={() => { setJoinerWizardOpen(false); void reloadTeam(); setTopTab('people'); setPeopleSub('team-profiles'); }}
        team={team}
        departments={departments}
      />
    </ToolLayout>
  );
}

function SubTabBtn({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string; badge?: number }) {
  const badgeLabel = badge != null && badge > 99 ? '99+' : String(badge ?? 0);
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/30'
          : 'bg-white border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
      }`}
    >
      <Icon size={12} />
      {label}
      {badge != null && badge > 0 && (
        <span className={`ml-1 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--accent)] text-white'}`}>
          {badgeLabel}
        </span>
      )}
    </button>
  );
}

function TabBtn({ active, onClick, label, badge }: { active: boolean; onClick: () => void; icon?: React.ElementType; label: string; badge?: number }) {
  const badgeLabel = badge != null && badge > 99 ? '99+' : String(badge ?? 0);
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors ${
        active
          ? 'border-[var(--accent)] text-[var(--accent)]'
          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center bg-[var(--accent)] text-white">
          {badgeLabel}
        </span>
      )}
    </button>
  );
}

function Loader() {
  return <div className="text-center py-12 text-sm text-[#5b21b6]"><Loader2 size={18} className="animate-spin inline mr-1.5" />Loading…</div>;
}

// ── My Holidays ────────────────────────────────────────────────────────
function MyHolidaysTab({ userId }: { userId: string }) {
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [toilBalance, setToilBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestOpen, setRequestOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [hRes, bRes, tRes] = await Promise.all([
        fetch(`/api/hr/holidays?scope=mine`),
        fetch(`/api/hr/holidays/balance?userId=${userId}`),
        fetch(`/api/hr/personnel/toil?userId=${userId}`),
      ]);
      setHolidays((await hRes.json()).holidays ?? []);
      setBalance(await bRes.json());
      // TOIL is optional — if the table doesn't exist yet (migration not run),
      // hide the card rather than failing the whole page.
      if (tRes.ok) {
        const t = await tRes.json();
        setToilBalance(typeof t.balance === 'number' ? t.balance : 0);
      } else {
        setToilBalance(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  async function handleCancel(id: string) {
    if (!confirm('Cancel this holiday?')) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/holidays/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Cancel failed');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cancel failed');
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-5">
      {/* Balance strip */}
      {balance && (
        <div className={`grid grid-cols-2 ${toilBalance != null ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3`}>
          <BalanceCard label="Entitlement" value={balance.entitlement} suffix="days" tone="accent" />
          <BalanceCard label="Used" value={balance.used} suffix="days" tone="emerald" />
          <BalanceCard label="Pending" value={balance.pending} suffix="days" tone="amber" />
          <BalanceCard label="Remaining" value={balance.remaining} suffix="days" tone="bold" />
          {toilBalance != null && <BalanceCard label="TOIL" value={toilBalance} suffix="hours" tone="purple" />}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">
          {balance ? `Holiday year ${formatYearWindow(balance.year)}` : ''}
        </p>
        <button onClick={() => setRequestOpen(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus size={14} /> Request holiday
        </button>
      </div>

      {error && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}</div>}

      {/* List — current year, then collapsible out-of-year */}
      <MyHolidaysList
        holidays={holidays}
        balance={balance}
        loading={loading}
        renderActions={h => (
          (h.status === 'pending' || h.status === 'approved') ? (
            <button onClick={() => void handleCancel(h.id)} disabled={busyId === h.id} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">
              {busyId === h.id ? <Loader2 size={11} className="animate-spin inline" /> : 'Cancel'}
            </button>
          ) : null
        )}
      />

      <HolidayRequestModal
        isOpen={requestOpen}
        onClose={() => setRequestOpen(false)}
        onSaved={() => { setRequestOpen(false); void load(); }}
      />
    </div>
  );
}

function MyHolidaysList({ holidays, balance, loading, renderActions }: {
  holidays: HolidayRow[];
  balance: BalanceInfo | null;
  loading: boolean;
  renderActions?: (h: HolidayRow) => React.ReactNode;
}) {
  const [showOther, setShowOther] = useState(false);
  // year.end is exclusive (next year's start). A holiday belongs to the current year
  // if its date range overlaps [year.start, year.end).
  const currentYear = balance?.year;
  const inYear = useMemo(() => holidays.filter(h =>
    !currentYear || (h.end_date >= currentYear.start && h.start_date < currentYear.end)
  ), [holidays, currentYear]);
  const otherYear = useMemo(() => holidays.filter(h =>
    currentYear && !(h.end_date >= currentYear.start && h.start_date < currentYear.end)
  ), [holidays, currentYear]);

  return (
    <div className="space-y-3">
      <HolidayList
        holidays={inYear}
        loading={loading}
        emptyText="No holidays booked in the current holiday year."
        showRequester={false}
        renderActions={renderActions}
      />
      {otherYear.length > 0 && (
        <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
          <button
            onClick={() => setShowOther(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--bg-nav-hover)] transition-colors"
          >
            {showOther ? <ChevronDown size={13} className="text-[var(--accent)]" /> : <ChevronRight size={13} className="text-gray-400" />}
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              {otherYear.length} holiday{otherYear.length === 1 ? '' : 's'} from other holiday years
            </span>
          </button>
          {showOther && (
            <div className="border-t border-gray-100">
              <HolidayList
                holidays={otherYear}
                loading={false}
                emptyText=""
                showRequester={false}
                renderActions={renderActions}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatYearWindow(year: { start: string; end: string }): string {
  const fmt = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const endIncl = new Date(year.end + 'T12:00:00Z'); endIncl.setUTCDate(endIncl.getUTCDate() - 1);
  return `${fmt(year.start)} – ${endIncl.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function BalanceCard({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone: 'accent' | 'emerald' | 'amber' | 'bold' | 'purple' }) {
  const map: Record<typeof tone, string> = {
    accent:  'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/20',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    bold:    'bg-gray-900 text-white border-gray-900',
    purple:  'bg-purple-50 text-purple-700 border-purple-200',
  };
  return (
    <div className={`rounded-xl border p-3 ${map[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}<span className="text-xs font-medium ml-1 opacity-70">{suffix}</span></p>
    </div>
  );
}

// ── Approvals (manager) ────────────────────────────────────────────────
function ApprovalsTab({ userId }: { userId: string }) {
  const [pending, setPending] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [defaultPushToCalendar, setDefaultPushToCalendar] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [hRes, sRes] = await Promise.all([
      fetch('/api/hr/holidays?scope=team&status=pending'),
      fetch('/api/hr/settings'),
    ]);
    setPending((await hRes.json()).holidays ?? []);
    const settings = (await sRes.json()).settings;
    setDefaultPushToCalendar(!!settings?.push_to_calendar_default);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function handleApprove(id: string, push: boolean) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/holidays/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', push_to_calendar: push }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Approve failed');
      await load();
      window.dispatchEvent(new Event(BADGE_REFRESH_EVENT)); // drop the badge (tool + sidebar) now
    } catch (e) { alert(e instanceof Error ? e.message : 'Approve failed'); }
    finally { setBusyId(null); }
  }

  async function handleReject(id: string, reason: string) {
    if (!reason.trim()) { alert('Please give a reason for the rejection.'); return; }
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/holidays/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejection_reason: reason }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Reject failed');
      await load();
      window.dispatchEvent(new Event(BADGE_REFRESH_EVENT)); // drop the badge (tool + sidebar) now
    } catch (e) { alert(e instanceof Error ? e.message : 'Reject failed'); }
    finally { setBusyId(null); }
  }

  if (loading) return <Loader />;

  if (pending.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-[var(--border)]">
        <Inbox size={28} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-[var(--text-muted)]">No holiday requests waiting on you.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map(h => (
        <ApprovalRow
          key={h.id}
          holiday={h}
          busy={busyId === h.id}
          defaultPushToCalendar={defaultPushToCalendar}
          onApprove={push => void handleApprove(h.id, push)}
          onReject={reason => void handleReject(h.id, reason)}
        />
      ))}
    </div>
  );
}

function ApprovalRow({ holiday, busy, defaultPushToCalendar, onApprove, onReject }: {
  holiday: HolidayRow;
  busy: boolean;
  defaultPushToCalendar: boolean;
  onApprove: (push: boolean) => void;
  onReject: (reason: string) => void;
}) {
  const [pushToCal, setPushToCal] = useState(defaultPushToCalendar);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const r = holiday.requester;
  const name = r?.full_name ?? r?.email ?? 'Team member';

  useEffect(() => {
    if (!r?.id) { setBalanceLoading(false); return; }
    let cancelled = false;
    setBalanceLoading(true);
    fetch(`/api/hr/holidays/balance?userId=${r.id}`)
      .then(res => (res.ok ? res.json() : null))
      .then((b: BalanceInfo | null) => { if (!cancelled) setBalance(b); })
      .catch(() => { /* balance is best-effort — approval still works without it */ })
      .finally(() => { if (!cancelled) setBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [r?.id]);

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white ${avatarColour(r?.id ?? 'x')}`}>
          {initials(r?.full_name ?? null, r?.email ?? '?')}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{name}</p>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">{fmtSpan(holiday)} · <span className="font-medium">{holiday.total_days} day{holiday.total_days === 1 ? '' : 's'}</span></p>
          {holiday.reason && <p className="text-xs text-[var(--text-muted)] mt-1.5 italic">&ldquo;{holiday.reason}&rdquo;</p>}
        </div>
      </div>

      <ApprovalBalanceStrip loading={balanceLoading} balance={balance} requestDays={holiday.total_days} />

      {!rejecting ? (
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
          <Tooltip label="Push approved holiday to the team member's Google Calendar (if connected)">
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
              <input type="checkbox" checked={pushToCal} onChange={e => setPushToCal(e.target.checked)} className="rounded" />
              Add to {name.split(' ')[0]}&apos;s calendar
            </label>
          </Tooltip>
          <div className="flex items-center gap-2">
            <button onClick={() => setRejecting(true)} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">Reject</button>
            <button onClick={() => onApprove(pushToCal)} disabled={busy} className="btn-primary text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Approve
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pt-1 border-t border-gray-100">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Rejection reason (will be shared with {name.split(' ')[0]})</label>
          <textarea
            value={rejectionReason}
            onChange={e => setRejectionReason(e.target.value)}
            rows={2}
            placeholder="e.g. We have a major filing deadline that week. Please pick another date."
            className="input-base text-sm w-full"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setRejecting(false)} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">Cancel</button>
            <button onClick={() => onReject(rejectionReason)} disabled={busy || !rejectionReason.trim()} className="btn-primary text-sm disabled:opacity-50 inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}Confirm reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact entitlement summary shown on each approval so the manager can see,
// at a glance, how much of the holiday year the requester has already used,
// their full allowance, and what would be left if this request is approved.
function ApprovalBalanceStrip({ loading, balance, requestDays }: {
  loading: boolean;
  balance: BalanceInfo | null;
  requestDays: number;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-gray-50/70 px-3 py-2 text-xs text-[var(--text-muted)] inline-flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Loading holiday balance…
      </div>
    );
  }
  if (!balance) return null;

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const remainingNow = balance.entitlement - balance.used;      // before this request
  const afterApproval = remainingNow - requestDays;             // if this is approved
  const overBooked = afterApproval < 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-gray-50/70 px-3 py-2">
      <div className="flex items-center gap-5">
        <BalanceStat label="Used" value={fmt(balance.used)} />
        <BalanceStat label="Allowance" value={fmt(balance.entitlement)} />
        <BalanceStat label="Remaining" value={fmt(remainingNow)} tone={remainingNow <= 0 ? 'amber' : 'default'} />
      </div>
      <p className={`mt-1.5 text-[11px] ${overBooked ? 'text-red-600 font-medium' : 'text-[var(--text-muted)]'}`}>
        {overBooked
          ? `Approving this would put ${balance.entitlement > 0 ? 'them' : 'the team member'} ${fmt(Math.abs(afterApproval))} day${Math.abs(afterApproval) === 1 ? '' : 's'} over their allowance.`
          : `Approving this leaves ${fmt(afterApproval)} day${afterApproval === 1 ? '' : 's'} for the rest of the holiday year.`}
        {balance.pro_rated && ' Allowance is pro-rated for their first year.'}
      </p>
    </div>
  );
}

function BalanceStat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'amber' }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className={`text-lg font-bold leading-tight ${tone === 'amber' ? 'text-amber-700' : 'text-[var(--text-primary)]'}`}>
        {value}<span className="text-[10px] font-medium ml-0.5 text-[var(--text-muted)]">days</span>
      </p>
    </div>
  );
}

// ── Team Holidays (manager view: all of own team) ──────────────────────
function TeamHolidaysTab({ userId, userRole, team }: { userId: string; userRole: 'admin' | 'staff'; team: TeamMember[] }) {
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | HolidayRow['status']>('all');
  const [directOpen, setDirectOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('scope', 'team');
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const res = await fetch(`/api/hr/holidays?${params.toString()}`);
    setHolidays((await res.json()).holidays ?? []);
    setLoading(false);
  }, [statusFilter]);
  useEffect(() => { void load(); }, [load]);

  // Direct-entry candidates: people the caller manages (or all firm if admin).
  const directCandidates = useMemo(() => {
    if (userRole === 'admin') return team.filter(m => m.id !== userId);
    return team.filter(m => m.manager_id === userId);
  }, [team, userId, userRole]);

  function canManage(h: HolidayRow): boolean {
    return userRole === 'admin' || h.manager?.id === userId;
  }

  async function handleDelete(h: HolidayRow) {
    const who = h.requester?.full_name ?? h.requester?.email ?? 'this person';
    if (!confirm(`Delete ${who}'s holiday on ${h.start_date}? This removes it permanently.`)) return;
    setBusyId(h.id);
    try {
      const res = await fetch(`/api/hr/holidays/${h.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[var(--text-muted)]" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | HolidayRow['status'])} className="input-base text-sm h-8">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {directCandidates.length > 0 && (
          <button onClick={() => setDirectOpen(true)} className="btn-secondary inline-flex items-center gap-2 text-sm">
            <Plus size={13} /> Record holiday directly
          </button>
        )}
      </div>

      <HolidayList
        holidays={holidays}
        loading={loading}
        emptyText="No holidays in this view yet."
        showRequester
        renderActions={h => canManage(h) ? (
          <div className="flex items-center gap-1">
            <Tooltip label="Edit dates / reason">
              <button
                onClick={() => setEditing(h)}
                disabled={busyId === h.id}
                aria-label="Edit"
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"
              >
                <Edit3 size={13} />
              </button>
            </Tooltip>
            <Tooltip label="Delete this holiday">
              <button
                onClick={() => void handleDelete(h)}
                disabled={busyId === h.id}
                aria-label="Delete"
                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {busyId === h.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              </button>
            </Tooltip>
          </div>
        ) : null}
      />

      <HolidayDirectEntryModal
        isOpen={directOpen}
        onClose={() => setDirectOpen(false)}
        onSaved={() => { setDirectOpen(false); void load(); }}
        candidates={directCandidates}
      />

      {editing && (
        <EditHolidayModal
          holiday={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

// ── Generic holiday list ───────────────────────────────────────────────
function HolidayList({
  holidays, loading, emptyText, showRequester, renderActions,
}: {
  holidays: HolidayRow[];
  loading: boolean;
  emptyText: string;
  showRequester: boolean;
  renderActions?: (h: HolidayRow) => React.ReactNode;
}) {
  if (loading) return <Loader />;
  if (holidays.length === 0) {
    return (
      <div className="text-center py-10 bg-white rounded-xl border border-[var(--border)]">
        <CalIcon size={24} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
      {holidays.map(h => (
        <div key={h.id} className="px-4 py-3 flex items-center gap-3">
          {showRequester && h.requester && (
            <Tooltip label={h.requester.full_name ?? h.requester.email}>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarColour(h.requester.id)}`}>
                {initials(h.requester.full_name, h.requester.email)}
              </div>
            </Tooltip>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {showRequester && h.requester && (
                <span className="text-sm font-medium text-[var(--text-primary)]">{h.requester.full_name ?? h.requester.email}</span>
              )}
              <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_BADGE[h.status]}`}>
                {h.status}
              </span>
              {h.source === 'direct' && !h.is_bank_holiday && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">recorded</span>}
              {h.is_bank_holiday && (
                <Tooltip label={h.bank_holiday_title ?? 'Bank holiday'}>
                  <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">Bank holiday</span>
                </Tooltip>
              )}
              {h.pushed_to_calendar && !h.is_bank_holiday && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">on calendar</span>}
            </div>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">{fmtSpan(h)} · <span className="font-medium">{h.total_days}</span> day{h.total_days === 1 ? '' : 's'}</p>
            {h.reason && <p className="text-xs text-[var(--text-muted)] mt-0.5 italic truncate">&ldquo;{h.reason}&rdquo;</p>}
            {h.rejection_reason && <p className="text-xs text-red-600 mt-0.5">Reason: {h.rejection_reason}</p>}
          </div>
          {renderActions && <div className="shrink-0">{renderActions(h)}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Edit holiday (manager / admin) ─────────────────────────────────────
function EditHolidayModal({ holiday, onClose, onSaved }: {
  holiday: HolidayRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [startDate, setStartDate] = useState(holiday.start_date);
  const [startHalf, setStartHalf] = useState<'full' | 'morning' | 'afternoon'>(holiday.start_half);
  const [endDate, setEndDate] = useState(holiday.end_date);
  const [endHalf, setEndHalf] = useState<'full' | 'morning' | 'afternoon'>(holiday.end_half);
  const [reason, setReason] = useState(holiday.reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/hr/holidays/${holiday.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          start_half: startHalf,
          end_date: endDate,
          end_half: endHalf,
          reason: reason.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  const who = holiday.requester?.full_name ?? holiday.requester?.email ?? 'Team member';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Edit holiday — {who}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Start date</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-base text-sm w-full" />
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Start half</span>
              <select value={startHalf} onChange={e => setStartHalf(e.target.value as 'full' | 'morning' | 'afternoon')} className="input-base text-sm w-full">
                <option value="full">Full day</option>
                <option value="morning">From morning</option>
                <option value="afternoon">From afternoon</option>
              </select>
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">End date</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-base text-sm w-full" />
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">End half</span>
              <select value={endHalf} onChange={e => setEndHalf(e.target.value as 'full' | 'morning' | 'afternoon')} className="input-base text-sm w-full">
                <option value="full">Full day</option>
                <option value="morning">To morning</option>
                <option value="afternoon">To afternoon</option>
              </select>
            </label>
          </div>
          <label className="text-xs block">
            <span className="block mb-1 text-[var(--text-muted)]">Reason</span>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="input-base text-sm w-full" />
          </label>
          {error && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />{error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={saving} className="btn-secondary text-sm disabled:opacity-50">Cancel</button>
            <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm disabled:opacity-50 inline-flex items-center gap-1.5">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
