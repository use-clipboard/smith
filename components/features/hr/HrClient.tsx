'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  HeartHandshake, Calendar as CalIcon, Inbox, Network, Plus, Loader2,
  Check, X, AlertTriangle, ChevronRight, Users as UsersIcon, Filter, Activity, Sparkles, ShieldAlert, BookOpen, User as UserIcon, Users2,
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

type Tab = 'mine' | 'approvals' | 'team' | 'absence' | 'advice' | 'confidential' | 'rights' | 'orgchart' | 'profile' | 'team-profiles';

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
  decided_at: string | null;
  created_at: string;
  requester: { id: string; full_name: string | null; email: string } | null;
  manager: { id: string; full_name: string | null; email: string } | null;
}

export interface BalanceInfo {
  user_id: string;
  year: { start: string; end: string; reset_month: number; reset_day: number };
  entitlement: number;
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
  const initialTab = (params.get('tab') as Tab) || 'mine';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [userId, setUserId] = useState<string>('');
  const [userRole, setUserRole] = useState<'admin' | 'staff'>('staff');

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

  return (
    <ToolLayout
      title="HR"
      description="Holiday requests, team structure, and the firm org chart."
      icon={HeartHandshake}
      iconColor="#9333EA"
      wide
    >
      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        <TabBtn active={tab === 'mine'}     onClick={() => setTab('mine')}     icon={CalIcon}  label="My Holidays" />
        <TabBtn active={tab === 'profile'}  onClick={() => setTab('profile')}  icon={UserIcon} label="My Profile" />
        {(isManagerOfSomeone || userRole === 'admin') && (
          <TabBtn active={tab === 'approvals'} onClick={() => setTab('approvals')} icon={Inbox} label="Approvals" />
        )}
        {(isManagerOfSomeone || userRole === 'admin') && (
          <TabBtn active={tab === 'team'} onClick={() => setTab('team')} icon={UsersIcon} label="Team Holidays" />
        )}
        {(isManagerOfSomeone || userRole === 'admin') && (
          <TabBtn active={tab === 'team-profiles'} onClick={() => setTab('team-profiles')} icon={Users2} label="Team Profiles" />
        )}
        <TabBtn active={tab === 'absence'}     onClick={() => setTab('absence')}     icon={Activity}    label="Absence" />
        <TabBtn active={tab === 'advice'}      onClick={() => setTab('advice')}      icon={Sparkles}    label="AI HR Advice" />
        <TabBtn active={tab === 'confidential'} onClick={() => setTab('confidential')} icon={ShieldAlert} label="Confidential" />
        <TabBtn active={tab === 'rights'}      onClick={() => setTab('rights')}      icon={BookOpen}    label="Employment Rights" />
        <TabBtn active={tab === 'orgchart'}    onClick={() => setTab('orgchart')}    icon={Network}     label="Org Chart" />
      </div>

      {/* Wait for /api/users/me to resolve before mounting tabs that need userId */}
      {!userId && tab !== 'orgchart' && tab !== 'advice' && tab !== 'rights' && <Loader />}{/* rights/advice/orgchart don't need userId */}
      {userId && tab === 'mine'      && <MyHolidaysTab userId={userId} />}
      {userId && tab === 'profile'   && <ProfileTab userId={userId} viewerId={userId} viewerRole={userRole} team={team} />}
      {userId && tab === 'team-profiles' && <TeamProfilesTab viewerId={userId} viewerRole={userRole} team={team} />}
      {userId && tab === 'approvals' && <ApprovalsTab userId={userId} />}
      {userId && tab === 'team'      && <TeamHolidaysTab userId={userId} userRole={userRole} team={team} />}
      {userId && tab === 'absence'      && <AbsenceTab userId={userId} userRole={userRole} team={team} />}
      {tab === 'advice'                  && <AiAdviceTab />}
      {userId && tab === 'confidential' && <ConfidentialTab userId={userId} team={team} />}
      {tab === 'rights'                  && <EmploymentRightsTab />}
      {tab === 'orgchart'                && (loadingTeam ? <Loader /> : <HrOrgChart team={team} departments={departments} />)}
    </ToolLayout>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-[var(--accent)] text-white'
          : 'bg-white border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function Loader() {
  return <div className="text-center py-12 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin inline mr-1.5" />Loading…</div>;
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

      {/* List */}
      <HolidayList
        holidays={holidays}
        loading={loading}
        emptyText="No holidays booked yet."
        showRequester={false}
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
  const r = holiday.requester;
  const name = r?.full_name ?? r?.email ?? 'Team member';

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

// ── Team Holidays (manager view: all of own team) ──────────────────────
function TeamHolidaysTab({ userId, userRole, team }: { userId: string; userRole: 'admin' | 'staff'; team: TeamMember[] }) {
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | HolidayRow['status']>('all');
  const [directOpen, setDirectOpen] = useState(false);

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

      <HolidayList holidays={holidays} loading={loading} emptyText="No holidays in this view yet." showRequester />

      <HolidayDirectEntryModal
        isOpen={directOpen}
        onClose={() => setDirectOpen(false)}
        onSaved={() => { setDirectOpen(false); void load(); }}
        candidates={directCandidates}
      />
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
              {h.source === 'direct' && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">recorded</span>}
              {h.pushed_to_calendar && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">on calendar</span>}
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
