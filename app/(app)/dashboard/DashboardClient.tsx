'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  FileSearch, ArrowLeftRight, House, ClipboardCheck,
  TrendingUp, Receipt, ShieldAlert, FileText, BookOpen,
  Users, Activity, Wifi, ExternalLink, Archive, Building2,
  CalendarDays, MicVocal, UserPlus, CheckSquare, X, MessageSquare,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import { useTabContext, Tab } from '@/components/ui/TabContext';
import { useModules } from '@/components/ui/ModulesProvider';
import Whiteboard from '@/components/features/whiteboard/Whiteboard';
import { createClient } from '@/lib/supabase';
import { useChatContext } from '@/components/chat/ChatProvider';

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
];

const FEATURE_LABELS: Record<string, string> = {
  full_analysis: 'Full Analysis',
  bank_to_csv: 'Bank to CSV',
  landlord_analysis: 'Landlord Analysis',
  final_accounts_review: 'Accounts Review',
  performance_analysis: 'Performance',
  p32_summary: 'P32 Summary',
  risk_assessment: 'Risk Assessment',
  summarise: 'Summarise',
};

const FEATURE_ICONS: Record<string, React.ElementType> = {
  full_analysis: FileSearch,
  bank_to_csv: ArrowLeftRight,
  landlord_analysis: House,
  final_accounts_review: ClipboardCheck,
  performance_analysis: TrendingUp,
  p32_summary: Receipt,
  risk_assessment: ShieldAlert,
  summarise: FileText,
};

const FEATURE_COLORS: Record<string, string> = {
  full_analysis: '#4F46E5',
  bank_to_csv: '#0891B2',
  landlord_analysis: '#D97706',
  final_accounts_review: '#7C3AED',
  performance_analysis: '#059669',
  p32_summary: '#CA8A04',
  risk_assessment: '#DC2626',
  summarise: '#475569',
};

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
}

interface Props {
  displayName: string;
  recentClients: { id: string; name: string; client_ref?: string }[];
  recentOutputs: ActivityOutput[];
  teamMembers: TeamMember[];
  whiteboardMessages: { id: string; content: string; color: 'yellow' | 'pink' | 'blue'; author_name: string; created_at: string; user_id: string }[];
  currentUserId: string;
  firmId: string;
  currentUserName: string;
}

export default function DashboardClient({ displayName, recentClients, recentOutputs, teamMembers, whiteboardMessages, currentUserId, firmId, currentUserName }: Props) {
  const { openTab } = useTabContext();
  const { isModuleActive } = useModules();
  const { openConversationWith } = useChatContext();
  const hour = new Date().getHours();

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

  // Dashboard panel: show 4 (online-priority already sorted above)
  const panelTeam = sortedTeam.slice(0, 4);

  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const activeTools = ALL_TOOLS.filter(tool => isModuleActive(tool.moduleId));

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Welcome bar */}
      <div className="glass rounded-xl px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            {greeting}, {displayName.charAt(0).toUpperCase() + displayName.slice(1)}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">Here&apos;s your workspace overview.</p>
        </div>
        <p className="text-sm text-[var(--text-muted)] hidden sm:block">{today}</p>
      </div>

      {/* Team Whiteboard */}
      <div className="relative">
        <Whiteboard
          initialMessages={whiteboardMessages}
          currentUserId={currentUserId}
          firmId={firmId}
          currentUserName={currentUserName}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Recent Clients */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                <Users size={15} className="text-[var(--accent)]" />
              </div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Recent Clients</span>
            </div>
            <Link href="/clients" className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
              View all <ExternalLink size={10} />
            </Link>
          </div>
          {recentClients.length === 0 ? (
            <EmptyState icon={<Users size={20} />} text="No clients yet. Add your first client." />
          ) : (
            <ul className="space-y-3">
              {recentClients.map(c => (
                <li key={c.id} className="flex items-center justify-between group">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                    {c.client_ref && <p className="text-xs text-[var(--text-muted)]">{c.client_ref}</p>}
                  </div>
                  <Link
                    href={`/clients/${c.id}`}
                    className="text-xs text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity ml-2 px-2 py-1 rounded hover:bg-[var(--accent-light)]"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Activity */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                <Activity size={15} className="text-[var(--accent)]" />
              </div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Recent Activity</span>
            </div>
            <button
              onClick={openActivityModal}
              className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
            >
              View all <ExternalLink size={10} />
            </button>
          </div>
          {recentOutputs.length === 0 ? (
            <EmptyState icon={<Activity size={20} />} text="No recent activity. Run a tool to get started." />
          ) : (
            <ul className="space-y-3">
              {recentOutputs.map(o => {
                const Icon = FEATURE_ICONS[o.feature] ?? Activity;
                const color = FEATURE_COLORS[o.feature] ?? '#6B7280';
                return (
                  <li key={o.id} className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${color}18` }}
                    >
                      <Icon size={13} style={{ color }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {FEATURE_LABELS[o.feature] || o.feature}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] truncate">
                        {o.clients?.name
                          ? `${o.clients.name}${o.clients.client_ref ? ` · ${o.clients.client_ref}` : ''}`
                          : 'No client'
                        } · {formatTimeAgo(o.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Team */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
                <Wifi size={15} className="text-[var(--accent)]" />
              </div>
              <span className="text-sm font-semibold text-[var(--text-primary)]">Team</span>
            </div>
            <button
              onClick={() => setTeamOpen(true)}
              className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
            >
              View all <ExternalLink size={10} />
            </button>
          </div>
          {panelTeam.length === 0 ? (
            <EmptyState icon={<Wifi size={20} />} text="No team members found." />
          ) : (
            <ul className="space-y-2.5">
              {panelTeam.map(m => {
                const isOnline = onlineIds.has(m.id);
                return (
                  <li key={m.id} className="flex items-center gap-2.5">
                    <Avatar name={m.full_name || m.email} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {m.full_name || m.email.split('@')[0]}
                      </p>
                    </div>
                    <Tooltip label={isOnline ? 'Online' : 'Offline'} side="left" className="shrink-0">
                      <div
                        className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-[var(--text-muted)] opacity-30'}`}
                      />
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Quick Launch */}
      {activeTools.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3 px-1">
            Quick Launch
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3">
            {activeTools.map(tool => {
              const Icon = tool.icon;
              return (
                <Link
                  key={tool.href}
                  href={tool.href}
                  onClick={() => openTab({
                    id: tool.moduleId,
                    title: tool.label,
                    route: tool.href,
                    icon: Icon as Tab['icon'],
                  })}
                  aria-label={tool.desc}
                  className="glass rounded-xl p-4 flex flex-col items-center gap-2 text-center hover:border-[var(--accent)] hover:shadow-card group transition-all duration-150 hover:-translate-y-0.5"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{ background: `${tool.color}18` }}
                  >
                    <Icon size={20} style={{ color: tool.color }} />
                  </div>
                  <span className="text-xs font-medium text-[var(--text-primary)] leading-tight line-clamp-2">
                    {tool.label}
                  </span>
                </Link>
              );
            })}
          </div>
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
                const Icon = FEATURE_ICONS[o.feature] ?? Activity;
                const color = FEATURE_COLORS[o.feature] ?? '#6B7280';
                return (
                  <li key={o.id} className="flex items-center gap-4 py-3 px-1">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${color}18` }}
                    >
                      <Icon size={16} style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {FEATURE_LABELS[o.feature] || o.feature}
                      </p>
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
                      <Avatar name={m.full_name || m.email} size={36} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-card-solid)] ${
                          isOnline ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      />
                    </div>

                    {/* Name + status */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                        {m.full_name || m.email.split('@')[0]}
                        {isSelf && <span className="ml-1.5 text-[10px] font-normal text-[var(--text-muted)]">(you)</span>}
                      </p>
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
