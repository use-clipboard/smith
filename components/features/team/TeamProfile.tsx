'use client';

/**
 * TeamProfile — a colleague's profile screen, opened as a named tab when you
 * click their name or avatar anywhere in the app. Data comes from
 * /api/team/[id]/overview (one round-trip). Overview tab is built out; the
 * other tabs are placeholders for now.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Mail, Phone, CalendarDays, MapPin, Building2, Users, CalendarClock, Check,
  Activity, MessageSquare, HeartHandshake, ArrowUpRight, FileBox, Lock, Search,
  FileSearch, ArrowLeftRight, House, ClipboardCheck, Gauge, Receipt, ShieldAlert,
  FileText, MicVocal, type LucideIcon,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import { Donut } from '@/components/features/dashboard/widgets/shared';
import { useChatContext } from '@/components/chat/ChatProvider';
import { useModules } from '@/components/ui/ModulesProvider';
import { useTabContext } from '@/components/ui/TabContext';
import ClientTasksPanel from '@/components/features/tasks/ClientTasksPanel';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { useOpenProfile } from './useOpenProfile';

interface ClientRef { name: string; client_ref?: string | null; status?: string | null }
interface OverviewData {
  profile: {
    id: string; name: string; email: string; avatarUrl: string | null; role: string;
    jobTitle: string | null; phone: string | null; office: string | null; joined: string | null;
    lastSeen: string | null;
    manager: { id: string; name: string; jobTitle: string | null; avatarUrl: string | null } | null;
    department: { name: string; memberCount: number } | null;
  };
  taskSummary: { overdue: number; dueThisWeek: number; later: number; total: number };
  tasksDueWeek: { id: string; title: string; clientId: string | null; due: string }[];
  recentActivity: { id: string; feature: string; created_at: string; clients?: ClientRef | null }[];
  clientsWorkedOn: { clientId: string; name: string; clientRef: string | null; completed: number; tasks: number }[];
  toolsUsed: { feature: string; count: number }[];
  upcomingEvents: { id: string; title: string; start: string; allDay: boolean }[];
  calendarConnected: boolean;
  viewerIsAdmin: boolean;
}

// Lazy-loaded tab list item shapes (from /api/team/[id]/list).
interface TaskItem { id: string; title: string; status: string; due: string | null; clientId: string | null; clientName: string | null }
interface ActivityItem { id: string; feature: string; created_at: string; clients?: ClientRef | null }
interface ClientItem { clientId: string; name: string; clientRef: string | null; status: string; businessType: string | null; email: string | null }
interface DocItem { id: string; file_name: string; document_type: string | null; created_at: string; drive_file_id?: string | null; file_url?: string | null; clients?: ClientRef | null }

const FEATURE_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  full_analysis:         { label: 'Full Analysis',     icon: FileSearch,     color: '#4F46E5' },
  bank_to_csv:           { label: 'Bank to CSV',       icon: ArrowLeftRight, color: '#0891B2' },
  landlord_analysis:     { label: 'Landlord Analysis', icon: House,          color: '#D97706' },
  final_accounts_review: { label: 'Accounts Review',   icon: ClipboardCheck, color: '#7C3AED' },
  performance_analysis:  { label: 'Performance',       icon: Gauge,     color: '#059669' },
  p32_summary:           { label: 'P32 Summary',       icon: Receipt,        color: '#CA8A04' },
  risk_assessment:       { label: 'Risk Assessment',   icon: ShieldAlert,    color: '#DC2626' },
  summarise:             { label: 'Summarise',         icon: FileText,       color: '#475569' },
  meeting_notes:         { label: 'Meeting Notes',     icon: MicVocal,       color: '#7C3AED' },
};
const featureLabel = (f: string) => FEATURE_META[f]?.label ?? f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const featureIcon  = (f: string) => FEATURE_META[f]?.icon ?? Activity;
const featureColor = (f: string) => FEATURE_META[f]?.color ?? '#6B7280';

function fmtJoined(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtDue(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
function fmtEvent(start: string, allDay: boolean): string {
  const d = new Date(start);
  if (allDay) return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const C_OVER = '#ef4444', C_WEEK = '#f59e0b', C_LATER = '#6366f1';
type TabName = 'Overview' | 'Tasks' | 'Activity' | 'Clients' | 'Documents';

export default function TeamProfile({ userId }: { userId: string }) {
  const { openConversationWith, onlineUserIds } = useChatContext();
  const { isModuleActive } = useModules();
  const { open: openCompose } = useComposeWindow();
  const { openInNewTab } = useTabContext();
  const openProfile = useOpenProfile();
  const hasEmail = isModuleActive('email-triage');
  const hasTasks = isModuleActive('tasks');
  const hasCalendar = isModuleActive('google-calendar');
  const hasVault = isModuleActive('document-vault');
  const hasHr = isModuleActive('hr');
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabName>('Overview');
  // Lazy per-tab list data (Tasks / Activity / Clients / Documents).
  const [tabItems, setTabItems] = useState<Record<string, unknown[] | undefined>>({});

  useEffect(() => {
    let active = true;
    setData(null); setError(false); setTabItems({});
    fetch(`/api/team/${userId}/overview`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (active) setData(d as OverviewData); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [userId]);

  // Fetch a content tab's list the first time it's opened. (Tasks uses the rich
  // ClientTasksPanel which self-fetches; Clients is a placeholder — both excluded.)
  useEffect(() => {
    if (tab === 'Overview' || tab === 'Tasks' || tab === 'Clients' || tabItems[tab] !== undefined) return;
    let active = true;
    fetch(`/api/team/${userId}/list?type=${tab.toLowerCase()}`)
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then(d => { if (active) setTabItems(prev => ({ ...prev, [tab]: d.items ?? [] })); })
      .catch(() => { if (active) setTabItems(prev => ({ ...prev, [tab]: [] })); });
    return () => { active = false; };
  }, [tab, userId, tabItems]);

  // Open the HR tool (HR "tab" is an action, not a content panel).
  const openHrTool = () => openInNewTab({ id: 'hr', title: 'HR', route: '/hr', icon: HeartHandshake });

  if (error) {
    return <div className="p-8 text-sm text-[var(--text-muted)]">Couldn&apos;t load this profile.</div>;
  }
  if (!data) {
    return (
      <div className="p-6 sm:p-8 space-y-6 animate-pulse">
        <div className="h-32 rounded-2xl bg-white/40" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-56 rounded-xl bg-white/40" />)}
        </div>
      </div>
    );
  }

  const p = data.profile;
  const roleLabel = p.role === 'admin' ? 'Admin' : 'Member';
  const online = onlineUserIds.has(p.id);
  const ts = data.taskSummary;

  return (
    <div className="p-6 sm:p-8 space-y-4">
      {/* ── Header card ─────────────────────────────────────────────────────── */}
      <div className="glass rounded-2xl p-5 flex flex-col lg:flex-row gap-6">
        <div className="flex items-start gap-5 flex-1 min-w-0">
          <div className="relative shrink-0 w-[84px] h-[84px]">
            <Avatar name={p.name} avatarUrl={p.avatarUrl} size={84} />
            <span className="absolute bottom-0 right-1.5">
              <Tooltip label={online ? 'Online now' : p.lastSeen ? `Last seen ${timeAgo(p.lastSeen)}` : 'Offline'} side="top">
                <span className={`block w-[14px] h-[14px] rounded-full border-2 border-white shadow-sm ${online ? 'bg-emerald-400' : 'bg-gray-300'}`} />
              </Tooltip>
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">{p.name}</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)]">{roleLabel}</span>
              <button
                onClick={() => openConversationWith(p.id)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                <MessageSquare size={13} /> Message {p.name.split(' ')[0]}
              </button>
            </div>
            {p.jobTitle && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{p.jobTitle}</p>}
            <div className="flex items-center gap-x-5 gap-y-1.5 flex-wrap mt-2.5 text-sm text-[var(--text-secondary)]">
              {hasEmail ? (
                <button
                  onClick={() => openCompose({ defaultTo: [{ name: p.name, email: p.email }] })}
                  className="flex items-center gap-1.5 hover:text-[var(--accent)]"
                >
                  <Mail size={14} /> {p.email}
                </button>
              ) : (
                <a href={`mailto:${p.email}`} className="flex items-center gap-1.5 hover:text-[var(--accent)]"><Mail size={14} /> {p.email}</a>
              )}
              {p.phone && <span className="flex items-center gap-1.5"><Phone size={14} /> {p.phone}</span>}
              {p.joined && <span className="flex items-center gap-1.5"><CalendarDays size={14} /> Joined {fmtJoined(p.joined)}</span>}
              {p.office && <span className="flex items-center gap-1.5"><MapPin size={14} /> {p.office}</span>}
            </div>
          </div>
        </div>

        {/* Reporting-to + department cards */}
        <div className="flex gap-4 shrink-0">
          {p.manager && (
            <div className="rounded-xl border border-[var(--border-card)] bg-white/50 p-4 min-w-[180px]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Reporting to</p>
              <div className="flex items-center gap-2.5">
                <Avatar name={p.manager.name} avatarUrl={p.manager.avatarUrl} size={32} userId={p.manager.id} />
                <div className="min-w-0">
                  <button onClick={() => openProfile(p.manager!.id, p.manager!.name)} className="text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--accent)] text-left">{p.manager.name}</button>
                  {p.manager.jobTitle && <p className="text-xs text-[var(--text-muted)] truncate">{p.manager.jobTitle}</p>}
                </div>
              </div>
            </div>
          )}
          {p.department && (
            <div className="rounded-xl border border-[var(--border-card)] bg-white/50 p-4 min-w-[170px]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Department</p>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                  <Building2 size={16} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{p.department.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{p.department.memberCount} team member{p.department.memberCount === 1 ? '' : 's'}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] px-1">
        {(['Overview', 'Tasks', 'Activity', 'Clients', ...(hasVault ? ['Documents'] as TabName[] : [])] as TabName[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t}
          </button>
        ))}
        {/* HR — admins only, opens the HR tool (not a content panel). */}
        {hasHr && data.viewerIsAdmin && (
          <button
            onClick={openHrTool}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
          >
            <HeartHandshake size={14} /> HR <ArrowUpRight size={12} />
          </button>
        )}
      </div>

      {tab === 'Tasks' ? (
        hasTasks
          ? <ClientTasksPanel assigneeId={userId} />
          : <div className="glass rounded-xl p-5 h-[200px]"><EnableTool tool="Tasks" /></div>
      ) : tab === 'Clients' ? (
        <ClientsTab userId={userId} />
      ) : tab !== 'Overview' ? (
        <TabContent tab={tab} items={tabItems[tab]} hasTasks={hasTasks} />
      ) : (
        <>
          {/* Top row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {/* Tasks Overview */}
            <Card title="Tasks Overview">
              {!hasTasks ? <EnableTool tool="Tasks" /> : (
              <div className="flex items-center justify-between gap-6 h-full">
                <Donut
                  segments={[
                    { value: ts.overdue, color: C_OVER, label: 'Overdue' },
                    { value: ts.dueThisWeek, color: C_WEEK, label: 'Due this week' },
                    { value: ts.later, color: C_LATER, label: 'Later' },
                  ]}
                  centerValue={ts.total}
                  centerSub="Total tasks"
                  size={172}
                  thickness={20}
                />
                <ul className="space-y-4 text-sm min-w-[200px]">
                  <LegendRow color={C_OVER} label="Overdue" value={ts.overdue} total={ts.total} />
                  <LegendRow color={C_WEEK} label="Due this week" value={ts.dueThisWeek} total={ts.total} />
                  <LegendRow color={C_LATER} label="Later" value={ts.later} total={ts.total} />
                </ul>
              </div>
              )}
            </Card>

            {/* Tasks Due This Week */}
            <Card title="Tasks Due This Week">
              {!hasTasks ? <EnableTool tool="Tasks" /> : data.tasksDueWeek.length === 0 ? (
                <Empty icon={<CalendarClock size={20} />} text="Nothing due this week." />
              ) : (
                <ul className="space-y-2.5">
                  {data.tasksDueWeek.map(t => (
                    <li key={t.id} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                        <ClipboardCheck size={13} className="text-[var(--accent)]" />
                      </div>
                      <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{t.title}</p>
                      <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtDue(t.due)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Upcoming Events — next 7 days from their connected calendar */}
            <Card title="Upcoming Events">
              {!hasCalendar ? (
                <EnableTool tool="Google Calendar" />
              ) : !data.calendarConnected ? (
                <Empty icon={<CalendarDays size={20} />} text="Calendar not connected." />
              ) : data.upcomingEvents.length === 0 ? (
                <Empty icon={<CalendarDays size={20} />} text="Nothing in the next 7 days." />
              ) : (
                <ul className="space-y-3">
                  {data.upcomingEvents.map(e => (
                    <li key={e.id} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                        <CalendarDays size={13} className="text-[var(--accent)]" />
                      </div>
                      <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{e.title}</p>
                      <span className="text-xs text-[var(--text-muted)] shrink-0 whitespace-nowrap">{fmtEvent(e.start, e.allDay)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            {/* Recent Activity */}
            <Card title="Recent Activity">
              {data.recentActivity.length === 0 ? (
                <Empty icon={<Activity size={20} />} text="No recent activity." />
              ) : (
                <ul className="space-y-3">
                  {data.recentActivity.map(o => {
                    const Icon = featureIcon(o.feature); const color = featureColor(o.feature);
                    return (
                      <li key={o.id} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                          <Icon size={13} style={{ color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{featureLabel(o.feature)}</p>
                          <p className="text-xs text-[var(--text-muted)] truncate">
                            {o.clients?.name ?? 'No client'} · {timeAgo(o.created_at)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {/* Clients Worked On — steps completed in the last 7 days */}
            <Card title="Clients Worked On" subtitle="Last 7 days">
              {!hasTasks ? <EnableTool tool="Tasks" /> : data.clientsWorkedOn.length === 0 ? (
                <Empty icon={<Users size={20} />} text="No client work completed this week." />
              ) : (
                <ul className="space-y-2.5">
                  {data.clientsWorkedOn.map(c => (
                    <li key={c.clientId}>
                      <Link href={`/clients/${c.clientId}`} className="flex items-center gap-3 group">
                        <Avatar name={c.name} size={28} />
                        <p className="flex-1 min-w-0 text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)]">{c.name}</p>
                        <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
                          <Check size={11} /> {c.tasks} task{c.tasks === 1 ? '' : 's'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Tools Used */}
            <Card title="Tools Used" subtitle="This month">
              {data.toolsUsed.length === 0 ? (
                <Empty icon={<Activity size={20} />} text="No tools used this month." />
              ) : (
                <ul className="space-y-2.5">
                  {data.toolsUsed.map(t => {
                    const Icon = featureIcon(t.feature); const color = featureColor(t.feature);
                    return (
                      <li key={t.feature} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                          <Icon size={13} style={{ color }} />
                        </div>
                        <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{featureLabel(t.feature)}</p>
                        <span className="text-xs text-[var(--text-muted)] shrink-0">{t.count} time{t.count === 1 ? '' : 's'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// All Overview panels share one fixed height with an internally-scrolling body,
// so a packed panel and a near-empty one line up instead of stretching the grid.
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-5 h-[340px] flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        {subtitle && <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-1 px-1">
        {children}
      </div>
    </div>
  );
}

function LegendRow({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <li className="flex items-center gap-2">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="ml-auto font-semibold text-[var(--text-primary)]">{value}</span>
      <span className="text-xs text-[var(--text-muted)]">({pct}%)</span>
    </li>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center py-8 gap-2 text-center">
      <div className="text-[var(--text-muted)] opacity-40">{icon}</div>
      <p className="text-xs text-[var(--text-muted)]">{text}</p>
    </div>
  );
}

/** Shown in a panel/tab whose data needs a firm module that isn't switched on. */
function EnableTool({ tool }: { tool: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center py-8 gap-2 text-center">
      <Lock size={20} className="text-[var(--text-muted)] opacity-40" />
      <p className="text-xs text-[var(--text-muted)]">
        Please enable the <span className="font-medium text-[var(--text-secondary)]">{tool}</span> tool.
      </p>
    </div>
  );
}

// ─── Tab content (lazy lists behind Tasks / Activity / Clients / Documents) ───

const CLIENT_TYPE_LABELS: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership', limited_company: 'Limited Company',
  individual: 'Individual', trust: 'Trust', charity: 'Charity', rental_landlord: 'Rental Landlord',
};
const STATUS_LABELS: Record<string, string> = { active: 'Active', hold: 'On Hold', inactive: 'Inactive' };

/**
 * ClientsTab — the clients this team member is the account manager for, shown as
 * a searchable / filterable table (name, code, status, business type, email).
 * Self-fetches /api/team/[id]/list?type=clients.
 */
function ClientsTab({ userId }: { userId: string }) {
  const [items, setItems] = useState<ClientItem[] | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    let active = true;
    setItems(null);
    fetch(`/api/team/${userId}/list?type=clients`)
      .then(r => (r.ok ? r.json() : { items: [] }))
      .then(d => { if (active) setItems((d.items ?? []) as ClientItem[]); })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [userId]);

  if (items === null) {
    return <div className="glass rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">Loading…</div>;
  }

  const typesPresent = [...new Set(items.map(c => c.businessType).filter(Boolean) as string[])].sort();
  const q = search.trim().toLowerCase();
  const filtered = items.filter(c => {
    if (statusFilter && (c.status ?? '').toLowerCase() !== statusFilter) return false;
    if (typeFilter && (c.businessType ?? '') !== typeFilter) return false;
    if (q) {
      const hay = `${c.name} ${c.clientRef ?? ''} ${c.email ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="glass rounded-xl p-5">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Client Manager Of</h3>
      {/* Controls — one line */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, code or email…"
            className="input-base w-full pl-9 text-sm"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-base text-sm w-40 shrink-0">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="hold">On Hold</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input-base text-sm w-44 shrink-0">
          <option value="">All types</option>
          {typesPresent.map(t => <option key={t} value={t}>{CLIENT_TYPE_LABELS[t] ?? t}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">Not the account manager for any clients yet.</div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">No clients match your filters.</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="py-2 px-2 font-semibold">Client</th>
                <th className="py-2 px-2 font-semibold">Code</th>
                <th className="py-2 px-2 font-semibold">Status</th>
                <th className="py-2 px-2 font-semibold">Business Type</th>
                <th className="py-2 px-2 font-semibold">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map(c => (
                <tr key={c.clientId} className="hover:bg-[var(--bg-nav-hover)] transition-colors">
                  <td className="py-2.5 px-2">
                    <Link href={`/clients/${c.clientId}`} className="flex items-center gap-2.5 group">
                      <Avatar name={c.name} size={28} />
                      <span className="font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)]">{c.name}</span>
                    </Link>
                  </td>
                  <td className="py-2.5 px-2 text-[var(--text-secondary)] font-mono text-xs whitespace-nowrap">{c.clientRef || '—'}</td>
                  <td className="py-2.5 px-2">{clientStatusBadge(STATUS_LABELS[c.status] ?? c.status)}</td>
                  <td className="py-2.5 px-2 text-[var(--text-secondary)] whitespace-nowrap">{c.businessType ? (CLIENT_TYPE_LABELS[c.businessType] ?? c.businessType) : '—'}</td>
                  <td className="py-2.5 px-2 text-[var(--text-secondary)]">
                    {c.email ? <a href={`mailto:${c.email}`} className="hover:text-[var(--accent)] truncate">{c.email}</a> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function clientStatusBadge(status: string) {
  const s = status.toLowerCase();
  const cls = s === 'active'
    ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
    : s === 'hold' || s === 'on_hold'
      ? 'bg-amber-50 text-amber-700 border-amber-100'
      : 'bg-gray-100 text-gray-500 border-gray-200';
  return (
    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border uppercase ${cls}`}>
      {status}
    </span>
  );
}

function statusBadge(status: string) {
  const done = status === 'complete';
  return (
    <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${
      done ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
           : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>
      {done ? 'Done' : status.replace(/_/g, ' ')}
    </span>
  );
}

function TabContent({ tab, items, hasTasks }: { tab: TabName; items: unknown[] | undefined; hasTasks: boolean }) {
  if (tab === 'Tasks' && !hasTasks) {
    return <div className="glass rounded-xl p-5 h-[200px]"><EnableTool tool="Tasks" /></div>;
  }
  if (items === undefined) {
    return <div className="glass rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">Loading…</div>;
  }
  if (items.length === 0) {
    const text = tab === 'Tasks' ? 'No tasks assigned.'
      : tab === 'Activity' ? 'No activity yet.'
      : 'No documents uploaded.';
    return <div className="glass rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">{text}</div>;
  }
  return (
    <div className="glass rounded-xl p-5">
      <ul className="divide-y divide-[var(--border)]">
        {tab === 'Tasks' && (items as TaskItem[]).map(t => (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
              <ClipboardCheck size={13} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{t.title}</p>
              {t.clientName && <p className="text-xs text-[var(--text-muted)] truncate">{t.clientName}</p>}
            </div>
            {t.due && <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtDue(t.due)}</span>}
            {statusBadge(t.status)}
          </li>
        ))}

        {tab === 'Activity' && (items as ActivityItem[]).map(o => {
          const Icon = featureIcon(o.feature); const color = featureColor(o.feature);
          return (
            <li key={o.id} className="flex items-center gap-3 py-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                <Icon size={13} style={{ color }} />
              </div>
              <span className="text-sm font-medium text-[var(--text-primary)] shrink-0">{featureLabel(o.feature)}</span>
              <span className="text-xs text-[var(--text-muted)] truncate">
                {o.clients?.name ?? 'No client'}{o.clients?.client_ref ? ` · ${o.clients.client_ref}` : ''}
              </span>
              {o.clients?.status && clientStatusBadge(o.clients.status)}
              <span className="ml-auto text-xs text-[var(--text-muted)] shrink-0">{timeAgo(o.created_at)}</span>
            </li>
          );
        })}

        {tab === 'Documents' && (items as DocItem[]).map(d => {
          const driveUrl = d.file_url || (d.drive_file_id ? `https://drive.google.com/file/d/${d.drive_file_id}/view` : null);
          const inner = (
            <>
              <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                <FileBox size={13} className="text-[var(--accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium text-[var(--text-primary)] truncate ${driveUrl ? 'group-hover:text-[var(--accent)]' : ''}`}>{d.file_name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {[d.clients?.name, d.document_type].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              {driveUrl && <ArrowUpRight size={14} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
              <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtDue(d.created_at)}</span>
            </>
          );
          return (
            <li key={d.id} className="py-2.5">
              {driveUrl ? (
                <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 group" title="Open in Google Drive">
                  {inner}
                </a>
              ) : (
                <div className="flex items-center gap-3">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
