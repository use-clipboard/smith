'use client';

/**
 * ClientOverview — the dashboard-style Overview tab for a client record.
 *
 * Layout:
 *   Top row    — Tasks Overview · Tasks Due This Week · Key Information · Key Contacts
 *   Bottom row — Linked Clients (×2) · Tools & Activity · Financial Snapshot
 *
 * Key Information is entity-type aware (mirrors the Edit modal's showFor logic),
 * so an Individual shows UTR / NI / CH ID / DoB / MTD IT, a Limited Company
 * shows Company Number / VAT / PAYE / Year End, etc. Task/tools data comes from
 * /api/clients/[id]/overview; the client record itself is passed in as a prop.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarClock, ClipboardCheck, Activity, Lock, Mail, Phone, Users2, Link2,
  MessageCircle, StickyNote,
  FileSearch, ArrowLeftRight, House, Gauge, Receipt, ShieldAlert, FileText, MicVocal,
  type LucideIcon,
} from 'lucide-react';
import { Donut } from '@/components/features/dashboard/widgets/shared';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import ClientLinksPanel from './ClientLinksPanel';
import FinancialSnapshot from './FinancialSnapshot';
import type { KeyContact } from './KeyContactsEditor';

/** The subset of the client record this view renders. The full page Client
 *  type satisfies it structurally. */
export interface ClientForOverview {
  name: string;
  client_ref: string | null;
  contact_email: string | null;
  risk_rating: string | null;
  business_type: string | null;
  registration_number: string | null;
  utr_number: string | null;
  national_insurance_number: string | null;
  companies_house_id: string | null;
  companies_house_auth_code: string | null;
  vat_number: string | null;
  vat_scheme: string | null;
  paye_reference: string | null;
  year_end: string | null;
  date_of_birth: string | null;
  mtd_it: boolean;
  key_contacts: KeyContact[] | null;
}

interface OverviewData {
  taskSummary: { overdue: number; dueThisWeek: number; later: number; total: number };
  tasksDueWeek: { id: string; title: string; due: string }[];
  recentActivity: { id: string; feature: string; created_at: string }[];
  toolsActivity: { feature: string; count: number }[];
  timelineThisMonth: { id: string; title: string; noteType: string; noteDate: string }[];
}

const NOTE_TYPE_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  phone_call:    { label: 'Phone Call',    icon: Phone,         color: '#0284C7' },
  meeting:       { label: 'Meeting',       icon: Users2,        color: '#059669' },
  meeting_notes: { label: 'Meeting Notes', icon: MicVocal,      color: '#7C3AED' },
  conversation:  { label: 'Conversation',  icon: MessageCircle, color: '#8B5CF6' },
  email:         { label: 'Email',         icon: Mail,          color: '#D97706' },
  other:         { label: 'Note',          icon: StickyNote,    color: '#6B7280' },
};

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
const fLabel = (f: string) => FEATURE_META[f]?.label ?? f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const fIcon  = (f: string) => FEATURE_META[f]?.icon ?? Activity;
const fColor = (f: string) => FEATURE_META[f]?.color ?? '#6B7280';

function fmtDue(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ── Key Information — entity-type aware (mirrors the Edit modal's showFor) ──────
const NON_INDIVIDUAL = ['sole_trader', 'partnership', 'limited_company', 'llp', 'trust', 'charity', 'rental_landlord'];
type KIField = { key: keyof ClientForOverview; label: string; types: string[]; kind?: 'date' | 'bool' };
const KEY_INFO_FIELDS: KIField[] = [
  { key: 'registration_number',       label: 'Company Number',           types: ['limited_company', 'llp'] },
  { key: 'utr_number',                label: 'UTR Number',               types: ['sole_trader', 'partnership', 'limited_company', 'llp', 'individual'] },
  { key: 'national_insurance_number', label: 'National Insurance Number',types: ['individual', 'sole_trader'] },
  { key: 'companies_house_auth_code', label: 'Companies House Auth Code', types: ['limited_company', 'llp'] },
  { key: 'vat_number',                label: 'VAT Number',               types: ['sole_trader', 'limited_company', 'llp', 'partnership'] },
  { key: 'vat_scheme',                label: 'VAT Scheme',               types: NON_INDIVIDUAL },
  { key: 'paye_reference',            label: 'PAYE Reference',           types: NON_INDIVIDUAL },
  { key: 'year_end',                  label: 'Year End',                 types: NON_INDIVIDUAL },
  { key: 'date_of_birth',             label: 'Date of Birth',            types: ['individual', 'sole_trader'], kind: 'date' },
  { key: 'mtd_it',                    label: 'MTD IT',                   types: ['individual'], kind: 'bool' },
];

function formatKeyInfo(field: KIField, raw: unknown): string {
  if (field.kind === 'bool') return raw ? 'Registered' : '—';
  if (raw == null || raw === '') return '—';
  if (field.kind === 'date') {
    const d = new Date(String(raw));
    return isNaN(d.getTime()) ? String(raw) : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  return String(raw);
}

const C_OVER = '#ef4444', C_WEEK = '#f59e0b', C_LATER = '#6366f1';

export default function ClientOverview({ clientId, client }: { clientId: string; client: ClientForOverview }) {
  const { isModuleActive } = useModules();
  const composeWindow = useComposeWindow();
  const hasTasks = isModuleActive('tasks');
  const hasEmailTriage = isModuleActive('email-triage');
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState(false);

  // Open the email-triage compose window pre-addressed to a key contact and
  // allocated to the currently-open client.
  function composeTo(email: string, name: string) {
    composeWindow.open({
      defaultTo: [{ name: name || email, email }],
      defaultClients: [{
        id: clientId,
        name: client.name,
        client_ref: client.client_ref ?? '',
        contact_email: client.contact_email,
        risk_rating: client.risk_rating,
      }],
    });
  }

  useEffect(() => {
    let active = true;
    setData(null); setError(false);
    fetch(`/api/clients/${clientId}/overview`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (active) setData(d as OverviewData); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [clientId]);

  if (error) return <div className="p-6 text-sm text-[var(--text-muted)]">Couldn&apos;t load the overview.</div>;
  if (!data) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[320px] rounded-xl bg-white/40" />)}
      </div>
    );
  }

  const ts = data.taskSummary;
  const type = client.business_type;
  const keyInfoRows = KEY_INFO_FIELDS.filter(f => !type || f.types.includes(type));
  const contacts = Array.isArray(client.key_contacts) ? client.key_contacts : [];

  return (
    <div className="space-y-4">
      {/* Top row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Tasks Overview */}
        <Card title="Tasks Overview">
          {!hasTasks ? <EnableTool tool="Tasks" /> : (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <Donut
                segments={[
                  { value: ts.overdue, color: C_OVER, label: 'Overdue' },
                  { value: ts.dueThisWeek, color: C_WEEK, label: 'Due this week' },
                  { value: ts.later, color: C_LATER, label: 'Later' },
                ]}
                centerValue={ts.total}
                centerSub="Total tasks"
                size={150}
                thickness={18}
              />
              <ul className="space-y-2 text-sm w-full px-2">
                <Legend color={C_OVER} label="Overdue" value={ts.overdue} total={ts.total} />
                <Legend color={C_WEEK} label="Due this week" value={ts.dueThisWeek} total={ts.total} />
                <Legend color={C_LATER} label="Later" value={ts.later} total={ts.total} />
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

        {/* Key Information — entity-type aware */}
        <Card title="Key Information">
          {keyInfoRows.length === 0 ? (
            <Empty icon={<FileText size={20} />} text="No key information for this client type." />
          ) : (
            <dl className="space-y-3">
              {keyInfoRows.map(f => (
                <KeyRow key={f.key} label={f.label} value={formatKeyInfo(f, client[f.key])} />
              ))}
            </dl>
          )}
        </Card>

        {/* Key Contacts */}
        <Card title="Key Contacts">
          {contacts.length === 0 ? (
            <Empty icon={<Users2 size={20} />} text="No key contacts. Add them in Edit Details." />
          ) : (
            <ul className="space-y-3">
              {contacts.map((c, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <Avatar name={c.name || '?'} size={32} />
                  <div className="min-w-0 flex-1">
                    {c.linked_client_id ? (
                      <Link href={`/clients/${c.linked_client_id}`} className="text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--accent)] flex items-center gap-1">
                        {c.name}<Link2 size={11} className="text-[var(--text-muted)] shrink-0" />
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                    )}
                    {c.role && <p className="text-xs text-[var(--text-muted)] truncate">{c.role}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {c.email && (
                      <Tooltip label={c.email} side="top">
                        {hasEmailTriage ? (
                          <button onClick={() => composeTo(c.email!, c.name)} aria-label={`Email ${c.name}`}
                            className="w-7 h-7 rounded-lg border border-[var(--border-card)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
                            <Mail size={13} />
                          </button>
                        ) : (
                          <a href={`mailto:${c.email}`} aria-label={`Email ${c.name}`}
                            className="w-7 h-7 rounded-lg border border-[var(--border-card)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
                            <Mail size={13} />
                          </a>
                        )}
                      </Tooltip>
                    )}
                    {c.phone && (
                      <Tooltip label={c.phone} side="top">
                        <a href={`tel:${c.phone}`} aria-label={`Call ${c.name}`}
                          className="w-7 h-7 rounded-lg border border-[var(--border-card)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors">
                          <Phone size={13} />
                        </a>
                      </Tooltip>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Linked Clients — full management (add / edit / remove / org chart) */}
        <div className="xl:col-span-2">
          <ClientLinksPanel clientId={clientId} />
        </div>

        {/* Tools & Activity — all tools ever used + this month's timeline */}
        <Card title="Tools &amp; Activity">
          {data.toolsActivity.length === 0 && data.timelineThisMonth.length === 0 ? (
            <Empty icon={<Activity size={20} />} text="No tools used or activity yet." />
          ) : (
            <div className="space-y-4">
              {data.toolsActivity.length > 0 && (
                <ul className="space-y-2.5">
                  {data.toolsActivity.map(t => {
                    const Icon = fIcon(t.feature); const color = fColor(t.feature);
                    return (
                      <li key={t.feature} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}18` }}>
                          <Icon size={13} style={{ color }} />
                        </div>
                        <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{fLabel(t.feature)}</p>
                        <span className="text-xs text-[var(--text-muted)] shrink-0">{t.count} time{t.count === 1 ? '' : 's'}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {data.timelineThisMonth.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Timeline · this month</p>
                  <ul className="space-y-2.5">
                    {data.timelineThisMonth.map(n => {
                      const meta = NOTE_TYPE_META[n.noteType] ?? NOTE_TYPE_META.other;
                      const Icon = meta.icon;
                      return (
                        <li key={n.id} className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${meta.color}18` }}>
                            <Icon size={13} style={{ color: meta.color }} />
                          </div>
                          <p className="flex-1 min-w-0 text-sm text-[var(--text-primary)] truncate">{n.title}</p>
                          <span className="text-xs text-[var(--text-muted)] shrink-0">{fmtDue(n.noteDate)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Financial Snapshot — latest closed-year P&L / BS from the Bookkeeping tool */}
        <FinancialSnapshot clientId={clientId} />
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-5 h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        {subtitle && <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-1 px-1">{children}</div>
    </div>
  );
}

function KeyRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-[var(--text-muted)]">{label}</dt>
      <dd className="text-sm font-medium text-[var(--text-primary)] truncate">{value || '—'}</dd>
    </div>
  );
}

function Legend({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
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

function EnableTool({ tool }: { tool: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center py-8 gap-2 text-center">
      <Lock size={20} className="text-[var(--text-muted)] opacity-40" />
      <p className="text-xs text-[var(--text-muted)]">Please enable the <span className="font-medium text-[var(--text-secondary)]">{tool}</span> tool.</p>
    </div>
  );
}
