'use client';

import Link from 'next/link';
import {
  FileSearch, ArrowLeftRight, House, ClipboardCheck,
  TrendingUp, Receipt, ShieldAlert, FileText, BookOpen,
  Users, Activity, Wifi, ExternalLink, Archive, Building2,
} from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useTabContext, Tab } from '@/components/ui/TabContext';
import { useModules } from '@/components/ui/ModulesProvider';

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

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  displayName: string;
  recentClients: { id: string; name: string; client_ref?: string }[];
  recentOutputs: { id: string; feature: string; created_at: string; clients?: { name: string } | null }[];
  teamMembers: { id: string; full_name?: string; email: string }[];
}

export default function DashboardClient({ displayName, recentClients, recentOutputs, teamMembers }: Props) {
  const { openTab } = useTabContext();
  const { isModuleActive } = useModules();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  // Only show tools the firm has activated
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
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <Activity size={15} className="text-[var(--accent)]" />
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Recent Activity</span>
          </div>
          {recentOutputs.length === 0 ? (
            <EmptyState icon={<Activity size={20} />} text="No recent activity. Run a tool to get started." />
          ) : (
            <ul className="space-y-3">
              {recentOutputs.map(o => (
                <li key={o.id} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {FEATURE_LABELS[o.feature] || o.feature}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {(o.clients as { name: string } | null)?.name || 'No client'} · {formatTimeAgo(o.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Team */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <Wifi size={15} className="text-[var(--accent)]" />
            </div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">Team</span>
          </div>
          {teamMembers.length === 0 ? (
            <EmptyState icon={<Wifi size={20} />} text="No team members found." />
          ) : (
            <ul className="space-y-2.5">
              {teamMembers.map(m => (
                <li key={m.id} className="flex items-center gap-2.5">
                  <Avatar name={m.full_name || m.email} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {m.full_name || m.email.split('@')[0]}
                    </p>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" title="Online" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Quick Launch — only shows active modules */}
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
                  className="glass rounded-xl p-4 flex flex-col items-center gap-2 text-center hover:border-[var(--accent)] hover:shadow-card group transition-all duration-150 hover:-translate-y-0.5"
                  title={tool.desc}
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
