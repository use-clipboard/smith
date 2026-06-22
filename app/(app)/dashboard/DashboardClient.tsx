'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  FileSearch, ArrowLeftRight, House, ClipboardCheck,
  TrendingUp, Receipt, ShieldAlert, FileText, BookOpen,
  Users, Activity, Wifi, ExternalLink, Archive, Building2,
  CalendarDays, MicVocal, UserPlus, CheckSquare, X, MessageSquare,
  HeartHandshake, FileSignature, GripVertical, Plus, Pencil, Check, LayoutGrid,
} from 'lucide-react';
import { useDashboardLayout } from '@/components/ui/DashboardLayoutProvider';
import { DASHBOARD_WIDGETS, DASHBOARD_WIDGET_BY_ID } from '@/config/dashboardWidgets';
import TasksWidget from '@/components/features/dashboard/widgets/TasksWidget';
import CalendarWidget from '@/components/features/dashboard/widgets/CalendarWidget';
import MtdItWidget from '@/components/features/dashboard/widgets/MtdItWidget';
import HrWidget from '@/components/features/dashboard/widgets/HrWidget';
import EmailTriageWidget from '@/components/features/dashboard/widgets/EmailTriageWidget';
import VaultWidget from '@/components/features/dashboard/widgets/VaultWidget';
import ProposalsWidget from '@/components/features/dashboard/widgets/ProposalsWidget';
import UpcomingDeadlinesWidget from '@/components/features/dashboard/widgets/UpcomingDeadlinesWidget';
import NeedsAttentionWidget from '@/components/features/dashboard/widgets/NeedsAttentionWidget';
import NotesWidget from '@/components/features/dashboard/widgets/NotesWidget';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import { useTabContext, Tab } from '@/components/ui/TabContext';
import { useModules } from '@/components/ui/ModulesProvider';
import Whiteboard from '@/components/features/whiteboard/Whiteboard';
import DashboardHero from '@/components/features/dashboard/DashboardHero';
import DashboardDataProvider from '@/components/features/dashboard/DashboardDataProvider';
import { createClient } from '@/lib/supabase';
import { useChatContext } from '@/components/chat/ChatProvider';
import { useOpenProfile } from '@/components/features/team/useOpenProfile';

const ALL_TOOLS = [
  { moduleId: 'full-analysis',   href: '/full-analysis',  label: 'Full Analysis',     desc: 'Analyse invoices for VT, Capium, or Xero', icon: FileSearch,     color: '#4F46E5' },
  { moduleId: 'bank-to-csv',     href: '/bank-to-csv',    label: 'Bank to CSV',        desc: 'Extract transactions from bank statements',  icon: ArrowLeftRight, color: '#0891B2' },
  { moduleId: 'landlord',        href: '/landlord',       label: 'Landlord',           desc: 'UK property income & expense analysis',      icon: House,          color: '#D97706' },
  { moduleId: 'final-accounts',  href: '/final-accounts', label: 'Accounts Review',    desc: 'Review accounts & prepare working papers',   icon: ClipboardCheck, color: '#7C3AED' },
  { moduleId: 'performance',     href: '/performance',    label: 'Performance',        desc: 'Business performance report with KPIs',      icon: TrendingUp,     color: '#059669' },
  { moduleId: 'p32',             href: '/p32',            label: 'P32 Summary',        desc: 'Generate client email from P32 record',      icon: Receipt,        color: '#CA8A04' },
  { moduleId: 'risk-assessment', href: '/risk-assessment',label: 'Risk Assessment',    desc: 'AML client risk assessment',                 icon: ShieldAlert,    color: '#DC2626' },
  { moduleId: 'summarise',       href: '/summarise',      label: 'Summarise',          desc: 'Summarise out-of-range documents',            icon: FileText,       color: '#475569' },
  { moduleId: 'document-vault',  href: '/vault',          label: 'Document Vault',     desc: 'Search and manage all client documents',      icon: Archive,        color: '#7C3AED' },
  { moduleId: 'policies',        href: '/policies',       label: 'Policies',           desc: 'Firm policies & procedures reference',       icon: BookOpen,       color: '#0F766E' },
  { moduleId: 'ch-secretarial',  href: '/ch-secretarial', label: 'CH Secretarial',     desc: 'Live Companies House data for your clients',  icon: Building2,      color: '#1D4ED8' },
  { moduleId: 'google-calendar', href: '/calendar',        label: 'Calendar',           desc: 'Shared firm calendar for events & meetings',  icon: CalendarDays,   color: '#0891B2' },
  { moduleId: 'meeting-notes',   href: '/meeting-notes',  label: 'Meeting Notes',      desc: 'Record, transcribe and summarise meetings',   icon: MicVocal,       color: '#7C3AED' },
  { moduleId: 'staff-hire',      href: '/staff-hire',     label: 'Staff Hire',         desc: 'AI-powered recruitment and applicant review',  icon: UserPlus,       color: '#7C3AED' },
  { moduleId: 'tasks',           href: '/tasks',          label: 'Tasks',              desc: 'Manage client and internal tasks with workflows', icon: CheckSquare,    color: '#4F46E5' },
  { moduleId: 'hr',              href: '/hr',             label: 'HR',                 desc: 'Holidays, team org chart, personnel files & briefings', icon: HeartHandshake, color: '#9333EA' },
  { moduleId: 'proposals',       href: '/proposals',      label: 'Proposals',          desc: 'Send proposals to prospects, accept & onboard',          icon: FileSignature,  color: '#0EA5E9' },
];

// Feature meta — kept in lockstep with the `feature` strings written to the
// `outputs` table by /app/api/outputs/*. Add a new entry here whenever a new
// tool starts logging outputs, otherwise it shows up as a generic Activity
// row with no icon/label.
const FEATURE_META: Record<string, { label: string; icon: React.ElementType; color: string; route: string }> = {
  full_analysis:         { label: 'Full Analysis',     icon: FileSearch,     color: '#4F46E5', route: '/full-analysis'   },
  bank_to_csv:           { label: 'Bank to CSV',       icon: ArrowLeftRight, color: '#0891B2', route: '/bank-to-csv'     },
  landlord_analysis:     { label: 'Landlord Analysis', icon: House,          color: '#D97706', route: '/landlord'        },
  final_accounts_review: { label: 'Accounts Review',   icon: ClipboardCheck, color: '#7C3AED', route: '/final-accounts'  },
  performance_analysis:  { label: 'Performance',       icon: TrendingUp,     color: '#059669', route: '/performance'     },
  p32_summary:           { label: 'P32 Summary',       icon: Receipt,        color: '#CA8A04', route: '/p32'             },
  risk_assessment:       { label: 'Risk Assessment',   icon: ShieldAlert,    color: '#DC2626', route: '/risk-assessment' },
  summarise:             { label: 'Summarise',         icon: FileText,       color: '#475569', route: '/summarise'       },
  meeting_notes:         { label: 'Meeting Notes',     icon: MicVocal,       color: '#7C3AED', route: '/meeting-notes'   },
};

/** Friendly title for a feature key that has no FEATURE_META entry — keeps every
 *  Recent Activity row uniform (e.g. "timeline_summary" → "Timeline Summary"). */
function formatFeatureLabel(feature: string): string {
  return feature.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Grid placement (Customise mode) ──────────────────────────────────────────
// Simulates the 3-column auto-flow so we can render drop-zone outlines in the
// empty cells that the flow leaves behind (the gaps you can drag widgets into).
type GridCell =
  | { type: 'widget'; id: string }
  | { type: 'empty'; afterId: string | null; key: string };

function widgetSpan(id: string): number {
  const s = DASHBOARD_WIDGET_BY_ID.get(id)?.size;
  return s === 'large' ? 3 : s === 'medium' ? 2 : 1;
}

/** Walk the ordered widgets, injecting `empty` cells wherever the row wraps.
 *  `startCol` lets the caller reserve leading columns (e.g. the 2-col hero that
 *  occupies the start of row 1), so the flow + drop-zones line up beside it. */
function computeGridCells(order: string[], startCol = 0): GridCell[] {
  const cells: GridCell[] = [];
  let col = startCol;
  for (let i = 0; i < order.length; i++) {
    const span = widgetSpan(order[i]);
    if (col + span > 3) {
      const afterId = i > 0 ? order[i - 1] : null;
      for (let c = col; c < 3; c++) cells.push({ type: 'empty', afterId, key: `e-${i}-${c}` });
      col = 0;
    }
    cells.push({ type: 'widget', id: order[i] });
    col += span;
    if (col >= 3) col = 0;
  }
  if (col > 0 && col < 3) {
    const afterId = order[order.length - 1] ?? null;
    for (let c = col; c < 3; c++) cells.push({ type: 'empty', afterId, key: `e-end-${c}` });
  }
  return cells;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

interface ActivityOutput {
  id: string;
  feature: string;
  created_at: string;
  clients?: { name: string; client_ref?: string | null } | null;
}

interface TeamMember {
  id: string;
  full_name?: string;
  email: string;
  role?: string;
  last_sign_in_at?: string | null;
  avatar_url?: string | null;
}

interface Props {
  displayName: string;
  recentClients: { id: string; name: string; client_ref?: string }[];
  recentOutputs: ActivityOutput[];
  teamMembers: TeamMember[];
  whiteboardMessages: { id: string; content: string; color: string; author_name: string; created_at: string; user_id: string; kind: 'sticky' | 'marker'; pos_x: number; pos_y: number; rotation: number }[];
  currentUserId: string;
  firmId: string;
  currentUserName: string;
}

export default function DashboardClient({ displayName, recentClients, recentOutputs, teamMembers, whiteboardMessages, currentUserId, firmId, currentUserName }: Props) {
  const { openTab } = useTabContext();
  const { isModuleActive } = useModules();
  const { openConversationWith } = useChatContext();
  const openProfile = useOpenProfile();

  // Greeting + today's date are time-dependent — defer until after mount so
  // server-rendered HTML matches the first client paint (otherwise React throws
  // a hydration mismatch when the server and client straddle a minute/day boundary).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, []);
  const hour = now?.getHours() ?? 0;

  // ── Real-time presence ────────────────────────────────────────────────────
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set([currentUserId]));

  useEffect(() => {
    if (!firmId || !currentUserId) return;
    const supabase = createClient();
    const channel = supabase.channel(`firm-presence:${firmId}`, {
      config: { presence: { key: currentUserId } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setOnlineIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ userId: currentUserId });
      });
    return () => { supabase.removeChannel(channel); };
  }, [firmId, currentUserId]);

  // ── Activity lightbox ─────────────────────────────────────────────────────
  const [activityOpen, setActivityOpen] = useState(false);
  const [allOutputs, setAllOutputs] = useState<ActivityOutput[]>([]);
  const [loadingOutputs, setLoadingOutputs] = useState(false);

  const openActivityModal = useCallback(async () => {
    setActivityOpen(true);
    if (allOutputs.length > 0) return;
    setLoadingOutputs(true);
    const supabase = createClient();
    const { data } = await supabase
      .from('outputs')
      .select('id, feature, created_at, clients(name, client_ref)')
      .order('created_at', { ascending: false })
      .limit(100);
    setAllOutputs((data ?? []) as unknown as ActivityOutput[]);
    setLoadingOutputs(false);
  }, [allOutputs.length]);

  // ── Team lightbox ─────────────────────────────────────────────────────────
  const [teamOpen, setTeamOpen] = useState(false);

  // Sort: online first → alphabetical within each group
  const sortedTeam = [...teamMembers].sort((a, b) => {
    const aOn = onlineIds.has(a.id);
    const bOn = onlineIds.has(b.id);
    if (aOn && !bOn) return -1;
    if (!aOn && bOn) return 1;
    return (a.full_name || a.email).localeCompare(b.full_name || b.email);
  });

  const greeting = !now ? '' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = now
    ? now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const activeTools = ALL_TOOLS.filter(tool => isModuleActive(tool.moduleId));

  // Current user's role (admins can delete any noticeboard note).
  const isAdmin = teamMembers.find(m => m.id === currentUserId)?.role === 'admin';
  // user_id → avatar URL, so sticky notes can show the author's profile picture.
  const avatarUrls: Record<string, string | null> = Object.fromEntries(
    teamMembers.map(m => [m.id, m.avatar_url ?? null])
  );

  // ── Customizable layout ─────────────────────────────────────────────────────
  const { layout, updateLayout } = useDashboardLayout();
  const [editMode, setEditMode] = useState(false);

  // Visible widgets in saved order (skip unknown ids + module-gated widgets off).
  const visibleWidgets = layout.filter(id => {
    const def = DASHBOARD_WIDGET_BY_ID.get(id);
    if (!def) return false;
    return def.moduleId ? isModuleActive(def.moduleId) : true;
  });
  // Widgets available to add: registered, not shown, module active.
  const hiddenWidgets = DASHBOARD_WIDGETS.filter(def =>
    !layout.includes(def.id) && (def.moduleId ? isModuleActive(def.moduleId) : true)
  );

  // Drag-to-reorder (mirrors the favourites reorder UX, horizontal).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [overPos, setOverPos] = useState<'before' | 'after'>('before');
  const [overEmpty, setOverEmpty] = useState<string | null>(null);

  // Drop a widget into an empty grid cell → reorder it to sit just after the
  // widget that precedes the gap (so the flow places it in that cell).
  function onDropEmpty(afterId: string | null) {
    const from = dragId;
    setDragId(null); setOverId(null); setOverEmpty(null);
    if (!from) return;
    const ids = layout.filter(x => x !== from);
    const insertAt = afterId ? ids.indexOf(afterId) + 1 : 0;
    ids.splice(insertAt, 0, from);
    updateLayout(ids);
  }

  function onWidgetDragOver(e: React.DragEvent, id: string) {
    if (!dragId || dragId === id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = (e.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    if (overId !== id) setOverId(id);
    if (overPos !== pos) setOverPos(pos);
  }
  function onWidgetDrop(targetId: string) {
    const from = dragId;
    const pos = overPos;
    setDragId(null); setOverId(null);
    if (!from || from === targetId) return;
    const ids = [...layout];
    const fromIdx = ids.indexOf(from);
    const overIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || overIdx < 0) return;
    ids.splice(fromIdx, 1);
    const insertIdx = pos === 'before'
      ? (fromIdx < overIdx ? overIdx - 1 : overIdx)
      : (fromIdx < overIdx ? overIdx : overIdx + 1);
    ids.splice(insertIdx, 0, from);
    updateLayout(ids);
  }
  function removeWidget(id: string) { updateLayout(layout.filter(x => x !== id)); }
  function addWidget(id: string) { updateLayout([...layout, id]); }

  // Fixed footprints: small = 1 col, medium = 2 cols (same height as small),
  // large = full width with self-sizing height (the noticeboard). Heights only
  // apply at md+ so widgets stack cleanly (auto height) on narrow screens.
  const SIZE_CLASS: Record<string, { span: string; height: string }> = {
    small:  { span: 'md:col-span-1', height: 'md:h-[260px]' },
    medium: { span: 'md:col-span-2', height: 'md:h-[260px]' },
    large:  { span: 'md:col-span-3', height: '' },
  };

  /** Render a widget's content by id. The grid applies the col-span + edit chrome. */
  function renderWidget(id: string) {
    switch (id) {
      case 'whiteboard':
        return (
          <Whiteboard
            initialMessages={whiteboardMessages}
            currentUserId={currentUserId}
            firmId={firmId}
            currentUserName={currentUserName}
            isAdmin={isAdmin}
            avatarUrls={avatarUrls}
          />
        );

      case 'recent-clients':
        // Scrollable list of every client added in the last 30 days (not
        // fit-to-height) so all of them are reachable when there are more than fit.
        return (
          <div className="glass rounded-xl p-5 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                  <Users size={15} className="text-[var(--accent)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Recent Clients</span>
              </div>
              <Link
                href="/clients"
                onClick={() => openTab({ id: 'clients', title: 'Clients', route: '/clients', icon: Users as Tab['icon'] })}
                className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
              >
                View all <ExternalLink size={10} />
              </Link>
            </div>
            {recentClients.length === 0 ? (
              <EmptyState icon={<Users size={20} />} text="No clients added in the last 30 days." />
            ) : (
              <ul className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-3 -mx-1 px-1">
                {recentClients.map(c => (
                  <li key={c.id}>
                    <Link href={`/clients/${c.id}`} className="flex items-center gap-2.5 group">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)]">{c.name}</p>
                        {c.client_ref && <p className="text-xs text-[var(--text-muted)]">{c.client_ref}</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );

      case 'recent-activity':
        return (
          <FillPanel
            icon={<Activity size={15} className="text-[var(--accent)]" />}
            title="Recent Activity"
            action={
              <button onClick={openActivityModal} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                View all <ExternalLink size={10} />
              </button>
            }
            items={recentOutputs}
            listClassName="space-y-3"
            itemClassName="flex items-center gap-3"
            keyFor={o => o.id}
            renderItem={o => {
              const meta = FEATURE_META[o.feature];
              const Icon = meta?.icon ?? Activity;
              const color = meta?.color ?? '#6B7280';
              return (
                <>
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                    <Icon size={13} style={{ color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{meta?.label || formatFeatureLabel(o.feature)}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {o.clients?.name
                        ? `${o.clients.name}${o.clients.client_ref ? ` · ${o.clients.client_ref}` : ''}`
                        : 'No client'} · {formatTimeAgo(o.created_at)}
                    </p>
                  </div>
                </>
              );
            }}
            empty={<EmptyState icon={<Activity size={20} />} text="No recent activity. Run a tool to get started." />}
          />
        );

      case 'team':
        // Scrollable list of the WHOLE team (not fit-to-height) so every member
        // is reachable within the panel.
        return (
          <div className="glass rounded-xl p-5 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                  <Wifi size={15} className="text-[var(--accent)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Team</span>
              </div>
              <button onClick={() => setTeamOpen(true)} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                View all <ExternalLink size={10} />
              </button>
            </div>
            {sortedTeam.length === 0 ? (
              <EmptyState icon={<Wifi size={20} />} text="No team members found." />
            ) : (
              <ul className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-2.5 -mx-1 px-1">
                {sortedTeam.map(m => {
                  const isOnline = onlineIds.has(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-2.5">
                      <button
                        onClick={() => openProfile(m.id, m.full_name || m.email.split('@')[0])}
                        className="flex items-center gap-2.5 min-w-0 flex-1 group text-left"
                      >
                        <Avatar name={m.full_name || m.email} avatarUrl={m.avatar_url ?? null} size={28} />
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)]">
                          {m.full_name || m.email.split('@')[0]}
                        </p>
                      </button>
                      <Tooltip label={isOnline ? 'Online' : 'Offline'} side="left" className="shrink-0">
                        <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-[var(--text-muted)] opacity-30'}`} />
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );

      case 'quick-launch':
        return (
          <div className="glass rounded-xl p-5 h-full flex flex-col">
            <div className="flex items-center gap-2 mb-4 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                <LayoutGrid size={15} className="text-[var(--accent)]" />
              </div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Quick Launch</span>
            </div>
            {activeTools.length === 0 ? (
              <EmptyState icon={<Activity size={20} />} text="No tools enabled yet." />
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-1 px-1">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {activeTools.map(tool => {
                    const Icon = tool.icon;
                    return (
                      <Link
                        key={tool.href}
                        href={tool.href}
                        onClick={() => openTab({ id: tool.moduleId, title: tool.label, route: tool.href, icon: Icon as Tab['icon'] })}
                        aria-label={tool.desc}
                        className="rounded-lg p-2.5 flex flex-col items-center gap-1.5 text-center bg-white/50 border border-[var(--border)] hover:bg-white/75 hover:border-[var(--accent)] group transition-all duration-150"
                      >
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110" style={{ background: `${tool.color}1f` }}>
                          <Icon size={16} style={{ color: tool.color }} />
                        </div>
                        <span className="text-[11px] font-medium text-[var(--text-primary)] leading-tight line-clamp-2">{tool.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );

      case 'tasks':
        return <TasksWidget />;
      case 'calendar':
        return <CalendarWidget />;
      case 'mtd-it':
        return <MtdItWidget />;
      case 'hr':
        return <HrWidget />;
      case 'email-triage':
        return <EmailTriageWidget />;
      case 'document-vault':
        return <VaultWidget />;
      case 'proposals':
        return <ProposalsWidget />;
      case 'upcoming-deadlines':
        return <UpcomingDeadlinesWidget />;
      case 'needs-attention':
        return <NeedsAttentionWidget />;
      case 'notes':
        return <NotesWidget storageKey={`smith-notes-${currentUserId}`} />;

      default:
        return null;
    }
  }

  return (
    <DashboardDataProvider>
    <div className="p-6 sm:p-8 space-y-6">
      {/* Welcome + customise toggle */}
      <div className="px-1 pt-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)] leading-tight">
            {greeting ? `${greeting}, ` : ''}{displayName.charAt(0).toUpperCase() + displayName.slice(1)}.
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Here&apos;s what&apos;s happening with your team and clients today.
            {today && <span className="text-[var(--text-muted)]"> · {today}</span>}
          </p>
        </div>
        <button
          onClick={() => setEditMode(v => !v)}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-white hover:bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] border border-[var(--border)] shadow-sm transition-colors"
        >
          {editMode ? <><Check size={14} /> Done</> : <><Pencil size={14} /> Customise</>}
        </button>
      </div>

      {editMode && (
        <p className="text-xs text-[var(--text-muted)] px-1">
          Drag widgets to reorder, remove the ones you don&apos;t need, or add more below.
        </p>
      )}

      {/* Widget grid — rendered in the user's saved order. The hero is a fixed
          2-col cell at the start of the grid (both views), so the first widget
          flows in beside it. In Customise mode the empty cells the flow leaves
          behind render as drop zones (computed with a 2-col offset for the hero). */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <div className="md:col-span-2">
          <DashboardHero />
        </div>
        {(editMode ? computeGridCells(visibleWidgets, 2) : visibleWidgets.map(id => ({ type: 'widget', id } as GridCell))).map(cell => {
          if (cell.type === 'empty') {
            return (
              <div
                key={cell.key}
                onDragOver={e => { if (dragId) { e.preventDefault(); if (overEmpty !== cell.key) setOverEmpty(cell.key); } }}
                onDragLeave={() => setOverEmpty(prev => (prev === cell.key ? null : prev))}
                onDrop={e => { e.preventDefault(); onDropEmpty(cell.afterId); }}
                className={`hidden md:flex md:col-span-1 md:h-[260px] rounded-xl border-2 border-dashed items-center justify-center transition-colors
                  ${overEmpty === cell.key
                    ? 'border-[var(--accent)] bg-[rgba(79,70,229,0.16)]'
                    : 'border-[rgba(79,70,229,0.4)] bg-[var(--bg-nav-hover)]'}`}
              >
                <span className="text-xs font-semibold text-[var(--accent)] pointer-events-none">Drop here</span>
              </div>
            );
          }
          const id = cell.id;
          const def = DASHBOARD_WIDGET_BY_ID.get(id)!;
          const sz = SIZE_CLASS[def.size] ?? SIZE_CLASS.small;
          const isDropTarget = editMode && overId === id && dragId && dragId !== id;
          return (
            <div
              key={id}
              draggable={editMode}
              onDragStart={() => { if (editMode) setDragId(id); }}
              onDragOver={e => onWidgetDragOver(e, id)}
              onDrop={e => { if (editMode) { e.preventDefault(); onWidgetDrop(id); } }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              className={`${sz.span} ${sz.height} relative flex flex-col transition-all
                ${editMode ? 'cursor-grab active:cursor-grabbing rounded-xl' : ''}
                ${dragId === id ? 'opacity-40' : ''}
                ${isDropTarget ? 'ring-2 ring-[var(--accent)] ring-offset-2 rounded-xl' : ''}`}
            >
              {editMode && (
                <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg bg-white backdrop-blur-sm border border-[var(--border)] shrink-0">
                  <GripVertical size={14} className="text-[var(--text-secondary)] shrink-0" />
                  <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{def.label} · {def.size}</span>
                  <button
                    onClick={() => removeWidget(id)}
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-1.5 py-0.5 rounded hover:bg-white/20"
                  >
                    <X size={12} /> Remove
                  </button>
                </div>
              )}
              <div className={`flex-1 min-h-0 ${editMode ? 'pointer-events-none select-none' : ''}`}>
                {renderWidget(id)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add-widget panel (edit mode) */}
      {editMode && (
        <div className="glass rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={15} className="text-[var(--accent)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">Add a widget</span>
          </div>
          {hiddenWidgets.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">All available widgets are already on your dashboard.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hiddenWidgets.map(def => (
                <button
                  key={def.id}
                  onClick={() => addWidget(def.id)}
                  title={def.description}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border-input)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--accent-light)] transition-colors"
                >
                  <Plus size={12} /> {def.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Activity Lightbox ─────────────────────────────────────────────── */}
      {activityOpen && (
        <Lightbox title="All Activity" onClose={() => setActivityOpen(false)}>
          {loadingOutputs ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm">
              Loading…
            </div>
          ) : allOutputs.length === 0 ? (
            <EmptyState icon={<Activity size={24} />} text="No activity recorded yet." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {allOutputs.map(o => {
                const meta = FEATURE_META[o.feature];
                const Icon = meta?.icon ?? Activity;
                const color = meta?.color ?? '#6B7280';
                const canOpenTool = !!meta?.route;
                return (
                  <li key={o.id} className="flex items-center gap-4 py-3 px-1">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${color}18` }}
                    >
                      <Icon size={16} style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {canOpenTool ? (
                        <Link
                          href={meta.route}
                          onClick={() => {
                            setActivityOpen(false);
                            openTab({
                              id: o.feature,
                              title: meta.label,
                              route: meta.route,
                              icon: meta.icon as Tab['icon'],
                            });
                          }}
                          className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline"
                        >
                          {meta.label}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {formatFeatureLabel(o.feature)}
                        </p>
                      )}
                      {o.clients?.name ? (
                        <p className="text-xs text-[var(--text-muted)] truncate">
                          {o.clients.name}
                          {o.clients.client_ref && (
                            <span className="ml-1 font-mono text-[var(--text-muted)] opacity-70">
                              {o.clients.client_ref}
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">No client</p>
                      )}
                    </div>
                    <span className="text-xs text-[var(--text-muted)] shrink-0 whitespace-nowrap">
                      {formatTimeAgo(o.created_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Lightbox>
      )}

      {/* ── Team Lightbox ─────────────────────────────────────────────────── */}
      {teamOpen && (
        <Lightbox title={`Team · ${teamMembers.length} member${teamMembers.length !== 1 ? 's' : ''}`} onClose={() => setTeamOpen(false)}>
          {sortedTeam.length === 0 ? (
            <EmptyState icon={<Users size={24} />} text="No team members found." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {sortedTeam.map(m => {
                const isOnline = onlineIds.has(m.id);
                const isSelf = m.id === currentUserId;
                return (
                  <li key={m.id} className="flex items-center gap-4 py-3.5 px-1">
                    {/* Avatar + online dot */}
                    <div className="relative shrink-0">
                      <Avatar name={m.full_name || m.email} avatarUrl={m.avatar_url ?? null} size={36} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-card-solid)] ${
                          isOnline ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      />
                    </div>

                    {/* Name + status */}
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => { setTeamOpen(false); openProfile(m.id, m.full_name || m.email.split('@')[0]); }}
                        className="text-sm font-semibold text-[var(--text-primary)] truncate hover:text-[var(--accent)] text-left"
                      >
                        {m.full_name || m.email.split('@')[0]}
                        {isSelf && <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">(you)</span>}
                      </button>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {isOnline
                          ? <span className="text-emerald-500 font-medium">Online now</span>
                          : m.last_sign_in_at
                            ? `Last seen ${formatDateTime(m.last_sign_in_at)}`
                            : 'Offline'
                        }
                      </p>
                    </div>

                    {/* Role badge */}
                    {m.role && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-page)] text-[var(--text-muted)] border border-[var(--border)] shrink-0 capitalize">
                        {m.role}
                      </span>
                    )}

                    {/* Message button — hidden for self */}
                    {!isSelf && (
                      <Tooltip label={`Message ${m.full_name?.split(' ')[0] ?? 'them'}`} className="shrink-0">
                        <button
                          onClick={() => {
                            setTeamOpen(false);
                            openConversationWith(m.id);
                          }}
                          aria-label={`Message ${m.full_name?.split(' ')[0] ?? 'them'}`}
                          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                        >
                          <MessageSquare size={12} />
                          Message
                        </button>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Lightbox>
      )}
    </div>
    </DashboardDataProvider>
  );
}

// ─── Shared Lightbox wrapper ──────────────────────────────────────────────────

function Lightbox({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <div
        className="glass-solid rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col border border-[var(--border)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-all"
          >
            <X size={14} />
          </button>
        </div>
        {/* Body */}
        <div className="overflow-y-auto px-5 py-2 scrollbar-thin flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-2 text-center">
      <div className="text-[var(--text-muted)] opacity-40">{icon}</div>
      <p className="text-xs text-[var(--text-muted)]">{text}</p>
    </div>
  );
}

// ─── Fill-to-height list panel ────────────────────────────────────────────────
// Renders as many list items as fit the panel's available height, recomputing
// on resize (responsive to screen + the widget's own size). Avoids the dead
// gap a fixed item count leaves in a fixed-height widget.

/** Measures the container and returns how many items of the current row height fit. */
function useFillCount(len: number): readonly [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(len);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientHeight;
      const kids = el.querySelectorAll('[data-fill-item]');
      if (avail <= 0 || kids.length === 0) return;
      const firstRect = (kids[0] as HTMLElement).getBoundingClientRect();
      const itemH = firstRect.height;
      // Stride (item height + gap) from the gap between the first two items;
      // falls back to itemH when only one is rendered.
      const stride = kids.length > 1
        ? (kids[1] as HTMLElement).getBoundingClientRect().top - firstRect.top
        : itemH;
      if (itemH <= 0 || stride <= 0) return;
      const fit = Math.max(1, Math.floor((avail - itemH) / stride) + 1);
      setCount(Math.min(len, fit));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [len]);

  return [ref, count] as const;
}

function FillPanel<T>({
  icon, title, action, items, listClassName, itemClassName, keyFor, renderItem, empty,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  items: T[];
  listClassName: string;
  itemClassName: string;
  keyFor: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  empty: React.ReactNode;
}) {
  const [ref, count] = useFillCount(items.length);
  return (
    <div className="glass rounded-xl p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">{icon}</div>
          <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        </div>
        {action}
      </div>
      {items.length === 0 ? empty : (
        <div ref={ref} className="flex-1 min-h-0 overflow-hidden">
          <ul className={listClassName}>
            {items.slice(0, count).map(item => (
              <li key={keyFor(item)} data-fill-item className={itemClassName}>
                {renderItem(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
