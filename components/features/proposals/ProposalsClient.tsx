'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FileSignature, Plus, Send, Loader2, AlertTriangle, ChevronLeft, Mail, ExternalLink, Search,
  Filter, Check, X, Trash2, Edit3, Copy, Eye, Users as UsersIcon, LayoutDashboard, BarChart3,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import HistoryActions from '@/components/ui/HistoryActions';
import { downloadCsv, csvFilename } from '@/utils/exportToCsv';
import ProposalBuilder from './ProposalBuilder';

// ── Types ────────────────────────────────────────────────────────────────
export interface Prospect {
  id: string;
  contact_name: string;
  company_name: string | null;
  email: string;
  phone: string | null;
  client_type: string | null;
  source: string | null;
  notes: string | null;
  status: 'active' | 'converted' | 'lost' | 'archived';
}

export interface ProposalListRow {
  id: string;
  title: string;
  status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  total_one_off: number;
  total_monthly: number;
  total_annual: number;
  public_token: string | null;
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string | null;
  prospect: Pick<Prospect, 'id' | 'contact_name' | 'company_name' | 'email' | 'client_type' | 'status'> | null;
}

const STATUS_STYLE: Record<ProposalListRow['status'], string> = {
  draft:     'bg-gray-100 text-gray-700',
  sent:      'bg-sky-100 text-sky-700',
  viewed:    'bg-indigo-100 text-indigo-700',
  accepted:  'bg-emerald-100 text-emerald-700',
  declined:  'bg-red-100 text-red-700',
  expired:   'bg-amber-100 text-amber-700',
  withdrawn: 'bg-gray-200 text-gray-600',
};

type View =
  | { kind: 'dashboard'; sub: 'proposals' | 'prospects' | 'analytics' }
  | { kind: 'builder'; proposalId: string };

export default function ProposalsClient() {
  const [view, setView] = useState<View>({ kind: 'dashboard', sub: 'proposals' });

  return (
    <ToolLayout
      title="Proposals"
      description="Send proposals to prospects, track outcomes, and onboard new clients."
      icon={FileSignature}
      iconColor="#0EA5E9"
      wide
    >
      {view.kind === 'dashboard' && (
        <>
          <div className="flex flex-wrap gap-2 mb-4 border-b border-[var(--border)] pb-3">
            <SubTabBtn active={view.sub === 'proposals'} onClick={() => setView({ kind: 'dashboard', sub: 'proposals' })} icon={LayoutDashboard} label="Proposals" />
            <SubTabBtn active={view.sub === 'prospects'} onClick={() => setView({ kind: 'dashboard', sub: 'prospects' })} icon={UsersIcon} label="Prospects" />
            <SubTabBtn active={view.sub === 'analytics'} onClick={() => setView({ kind: 'dashboard', sub: 'analytics' })} icon={BarChart3} label="Win / loss" />
          </div>
          {view.sub === 'proposals' && <Dashboard onOpen={id => setView({ kind: 'builder', proposalId: id })} />}
          {view.sub === 'prospects' && <ProspectsSection />}
          {view.sub === 'analytics' && <AnalyticsSection />}
        </>
      )}
      {view.kind === 'builder' && (
        <div className="space-y-4">
          <button onClick={() => setView({ kind: 'dashboard', sub: 'proposals' })} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline">
            <ChevronLeft size={13} />Back to dashboard
          </button>
          <ProposalBuilder proposalId={view.proposalId} />
        </div>
      )}
    </ToolLayout>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ onOpen }: { onOpen: (id: string) => void }) {
  const [proposals, setProposals] = useState<ProposalListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | ProposalListRow['status']>('all');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/proposals');
    setProposals((await res.json()).proposals ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return proposals.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${p.title} ${p.prospect?.contact_name ?? ''} ${p.prospect?.company_name ?? ''} ${p.prospect?.email ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [proposals, statusFilter, search]);

  const stats = useMemo(() => {
    const total = proposals.length;
    const draft = proposals.filter(p => p.status === 'draft').length;
    const sent = proposals.filter(p => p.status === 'sent' || p.status === 'viewed').length;
    const accepted = proposals.filter(p => p.status === 'accepted').length;
    const declined = proposals.filter(p => p.status === 'declined').length;
    const decided = accepted + declined;
    const acceptanceRate = decided > 0 ? Math.round((accepted / decided) * 100) : null;
    return { total, draft, sent, accepted, declined, acceptanceRate };
  }, [proposals]);

  function exportCsv() {
    const headers = ['Prospect', 'Company', 'Title', 'Status', 'Monthly', 'One-off', 'Created', 'Decided'];
    const csvRows = filtered.map(p => [
      p.prospect?.contact_name ?? '',
      p.prospect?.company_name ?? '',
      p.title,
      p.status,
      p.total_monthly > 0 ? Number(p.total_monthly).toFixed(2) : '',
      p.total_one_off > 0 ? Number(p.total_one_off).toFixed(2) : '',
      fmt(p.created_at),
      p.decided_at ? fmt(p.decided_at) : '',
    ]);
    downloadCsv(csvFilename('proposals'), headers, csvRows);
  }

  return (
    <div className="space-y-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Total" value={stats.total} />
        <Stat label="Draft" value={stats.draft} tone="gray" />
        <Stat label="Outstanding" value={stats.sent} tone="sky" />
        <Stat label="Accepted" value={stats.accepted} tone="emerald" />
        <Stat label="Acceptance rate" value={stats.acceptanceRate == null ? '—' : `${stats.acceptanceRate}%`} tone="bold" />
      </div>



      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search proposals…" className="input-base text-sm pl-8 w-64" />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-[var(--text-muted)] shrink-0" />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | ProposalListRow['status'])} className="input-base text-sm min-w-[150px] pr-8">
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="viewed">Viewed</option>
              <option value="accepted">Accepted</option>
              <option value="declined">Declined</option>
              <option value="expired">Expired</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <HistoryActions onExport={exportCsv} exportDisabled={filtered.length === 0} />
          <button onClick={() => setNewOpen(true)} className="btn-primary inline-flex items-center gap-2 text-sm">
            <Plus size={13} /> New proposal
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-[#5b21b6]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading proposals…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-[var(--border)]">
          <FileSignature size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">No proposals yet — click <strong>New proposal</strong> to start.</p>
        </div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <Th>Prospect</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th align="right">Monthly</Th>
                <Th align="right">One-off</Th>
                <Th>Created</Th>
                <Th>Decided</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/40 cursor-pointer" onClick={() => onOpen(p.id)}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{p.prospect?.contact_name ?? '—'}</p>
                    <p className="text-xs text-[var(--text-muted)]">{p.prospect?.company_name ?? p.prospect?.email}</p>
                  </td>
                  <td className="px-3 py-2.5">{p.title}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.total_monthly > 0 ? `£${Number(p.total_monthly).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.total_one_off > 0 ? `£${Number(p.total_one_off).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{fmt(p.created_at)}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{p.decided_at ? fmt(p.decided_at) : '—'}</td>
                  <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                    {p.public_token && (
                      <Tooltip label="Copy public link">
                        <button onClick={() => copyLink(p.public_token!)} className="p-1.5 rounded text-gray-500 hover:bg-gray-100"><Copy size={13} /></button>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newOpen && <NewProposalModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); onOpen(id); }} />}
    </div>
  );
}

function copyLink(token: string) {
  const url = `${window.location.origin}/p/${token}`;
  navigator.clipboard.writeText(url).then(
    () => alert('Public link copied to clipboard'),
    () => alert(url),
  );
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'right' | 'left' }) {
  return <th className={`px-3 py-2 text-${align ?? 'left'} text-[10px] uppercase tracking-wide font-bold text-[var(--text-muted)]`}>{children}</th>;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'gray' | 'sky' | 'emerald' | 'bold' }) {
  const map: Record<string, string> = {
    gray:    'bg-gray-50 text-gray-700 border-gray-200',
    sky:     'bg-sky-50 text-sky-700 border-sky-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bold:    'bg-gray-900 text-white border-gray-900',
  };
  const cls = tone ? map[tone] : 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/20';
  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  );
}

// ── New proposal modal: pick or create a prospect, then jump to builder
function NewProposalModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState<'pick' | 'new-prospect'>('pick');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loadingProspects, setLoadingProspects] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [newProspect, setNewProspect] = useState({ contact_name: '', company_name: '', email: '', client_type: 'limited_company' });

  useEffect(() => {
    fetch('/api/proposals/prospects?status=active')
      .then(r => r.json())
      .then(d => setProspects(d.prospects ?? []))
      .finally(() => setLoadingProspects(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prospects;
    return prospects.filter(p =>
      p.contact_name.toLowerCase().includes(q) ||
      (p.company_name ?? '').toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q),
    );
  }, [prospects, search]);

  async function startWith(prospectId: string) {
    setCreating(true); setError(null);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_id: prospectId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to create proposal');
      onCreated(data.proposal.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setCreating(false); }
  }

  async function createProspectAndStart() {
    if (!newProspect.contact_name.trim() || !newProspect.email.trim()) {
      setError('Name and email are required.'); return;
    }
    setCreating(true); setError(null);
    try {
      const res = await fetch('/api/proposals/prospects', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_name: newProspect.contact_name,
          company_name: newProspect.company_name || null,
          email: newProspect.email,
          client_type: newProspect.client_type,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.prospect) throw new Error(data.error ?? 'Failed');
      await startWith(data.prospect.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !creating && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold">New proposal</h3>
          <button onClick={onClose} disabled={creating} className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><X size={14} /></button>
        </div>
        <div className="p-5 space-y-3">
          {step === 'pick' ? (
            <>
              <p className="text-xs text-[var(--text-muted)]">Pick a prospect to send to, or add a new one.</p>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prospects…" className="input-base text-sm w-full pl-8" />
              </div>
              <div className="max-h-72 overflow-y-auto border border-[var(--border)] rounded-lg divide-y divide-gray-100">
                {loadingProspects ? (
                  <p className="text-xs text-[var(--text-muted)] italic px-3 py-3">Loading…</p>
                ) : filtered.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] italic px-3 py-3">{search ? 'No prospects match.' : 'No prospects yet.'}</p>
                ) : filtered.map(p => (
                  <button key={p.id} onClick={() => void startWith(p.id)} disabled={creating} className="w-full text-left px-3 py-2 hover:bg-[var(--bg-nav-hover)] text-sm">
                    <p className="font-medium">{p.contact_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{p.company_name ? `${p.company_name} · ` : ''}{p.email}</p>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep('new-prospect')} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={11} />Add a new prospect</button>
            </>
          ) : (
            <>
              <button onClick={() => setStep('pick')} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><ChevronLeft size={11} />Back</button>
              <div className="grid grid-cols-2 gap-2">
                <FieldM label="Contact name *"><input value={newProspect.contact_name} onChange={e => setNewProspect({ ...newProspect, contact_name: e.target.value })} className="input-base text-sm w-full" /></FieldM>
                <FieldM label="Company name"><input value={newProspect.company_name} onChange={e => setNewProspect({ ...newProspect, company_name: e.target.value })} className="input-base text-sm w-full" /></FieldM>
                <FieldM label="Email *"><input type="email" value={newProspect.email} onChange={e => setNewProspect({ ...newProspect, email: e.target.value })} className="input-base text-sm w-full" /></FieldM>
                <FieldM label="Client type">
                  <select value={newProspect.client_type} onChange={e => setNewProspect({ ...newProspect, client_type: e.target.value })} className="input-base text-sm w-full">
                    <option value="sole_trader">Sole trader</option>
                    <option value="limited_company">Limited company</option>
                    <option value="llp">LLP</option>
                    <option value="partnership">Partnership</option>
                    <option value="charity">Charity</option>
                    <option value="trust">Trust</option>
                    <option value="individual">Individual</option>
                    <option value="other">Other</option>
                  </select>
                </FieldM>
              </div>
            </>
          )}
          {error && <div className="text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={creating} className="btn-secondary text-sm">Cancel</button>
          {step === 'new-prospect' && (
            <button onClick={() => void createProspectAndStart()} disabled={creating} className="btn-primary text-sm">
              {creating ? <Loader2 size={12} className="animate-spin inline mr-1" /> : <Check size={12} className="inline mr-1" />}Create & open builder
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldM({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</span>{children}</label>;
}

// ── Win/loss analytics panel ────────────────────────────────────────────
interface Analytics {
  counts: { total: number; draft: number; outstanding: number; accepted: number; declined: number; expired: number };
  winRate: number | null;
  avgDaysToDecide: number | null;
  revenueWon: { monthly: number; annual: number; one_off: number };
  topDeclineReasons: Array<{ reason: string; count: number }>;
  serviceWinRates: Array<{ name: string; wins: number; losses: number; winRate: number | null }>;
}

function AnalyticsSection() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/proposals/analytics')
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-sm text-[#5b21b6]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading analytics…</div>;
  }
  if (!data || data.counts.total === 0) {
    return (
      <div className="text-center py-16 bg-white rounded-xl border border-[var(--border)]">
        <BarChart3 size={28} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-[var(--text-muted)]">No proposals yet — analytics will appear here once you've sent some.</p>
      </div>
    );
  }

  const decided = data.counts.accepted + data.counts.declined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Win rate" value={data.winRate == null ? '—' : `${data.winRate}%`} />
        <MetricCard label="Avg days to decide" value={data.avgDaysToDecide == null ? '—' : `${data.avgDaysToDecide}d`} />
        <MetricCard label="Decided" value={String(decided)} />
        <MetricCard label="Outstanding" value={String(data.counts.outstanding)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard label="Monthly won" value={`£${data.revenueWon.monthly.toLocaleString('en-GB')}`} tone="emerald" />
        <MetricCard label="Annual won" value={`£${data.revenueWon.annual.toLocaleString('en-GB')}`} tone="emerald" />
        <MetricCard label="One-off won" value={`£${data.revenueWon.one_off.toLocaleString('en-GB')}`} tone="emerald" />
      </div>

      {data.serviceWinRates.length > 0 && (
        <div className="bg-white border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Win rate by service</p>
          <table className="w-full text-sm">
            <thead><tr className="text-[var(--text-muted)] uppercase text-[10px]"><th className="text-left py-1.5">Service</th><th className="text-right py-1.5">Wins</th><th className="text-right py-1.5">Losses</th><th className="text-right py-1.5">Win rate</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.serviceWinRates.map(s => (
                <tr key={s.name}><td className="py-2">{s.name}</td><td className="text-right tabular-nums">{s.wins}</td><td className="text-right tabular-nums">{s.losses}</td><td className="text-right font-semibold tabular-nums">{s.winRate == null ? '—' : `${s.winRate}%`}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.topDeclineReasons.length > 0 && (
        <div className="bg-white border border-[var(--border)] rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Top decline reasons</p>
          <ul className="space-y-1.5">
            {data.topDeclineReasons.map((r, i) => (
              <li key={i} className="text-sm flex items-start gap-3">
                <span className="font-mono text-[var(--text-muted)] shrink-0">{r.count}×</span>
                <span className="text-[var(--text-secondary)] italic">&ldquo;{r.reason}&rdquo;</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'emerald' }) {
  const cls = tone === 'emerald'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : 'bg-white border-[var(--border)] text-[var(--text-primary)]';
  return (
    <div className={`rounded-lg border ${cls} p-3`}>
      <p className="text-[10px] font-bold uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-lg font-bold mt-0.5">{value}</p>
    </div>
  );
}

// ── Sub-tab pill (Proposals / Prospects) ─────────────────────────────────
function SubTabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active ? 'bg-[var(--accent)] text-white' : 'bg-white border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

// ── Prospects CRUD ───────────────────────────────────────────────────────
function ProspectsSection() {
  const [list, setList] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Prospect['status']>('all');
  const [editing, setEditing] = useState<Prospect | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/proposals/prospects');
    setList((await res.json()).prospects ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(p => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (`${p.contact_name} ${p.company_name ?? ''} ${p.email}`).toLowerCase().includes(q);
    });
  }, [list, search, statusFilter]);

  async function remove(p: Prospect) {
    if (!confirm(`Delete prospect "${p.contact_name}"? Any proposals attached to them will be deleted too.`)) return;
    await fetch(`/api/proposals/prospects/${p.id}`, { method: 'DELETE' });
    void load();
  }

  async function setStatus(p: Prospect, status: Prospect['status']) {
    await fetch(`/api/proposals/prospects/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prospects…" className="input-base text-sm pl-8 w-64" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | Prospect['status'])} className="input-base text-sm min-w-[150px] pr-8">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="converted">Converted</option>
            <option value="lost">Lost</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <button onClick={() => setAdding(true)} className="btn-primary inline-flex items-center gap-2 text-sm">
          <Plus size={13} /> New prospect
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-[#5b21b6]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-[var(--border)]">
          <UsersIcon size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">No prospects yet.</p>
        </div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {filtered.map(p => (
            <div key={p.id} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{p.contact_name}</p>
                <p className="text-xs text-[var(--text-muted)]">{p.company_name ? `${p.company_name} · ` : ''}{p.email}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{p.client_type ?? '—'}{p.source ? ` · via ${p.source}` : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <select value={p.status} onChange={e => void setStatus(p, e.target.value as Prospect['status'])} className="input-base text-xs h-7">
                  <option value="active">Active</option>
                  <option value="converted">Converted</option>
                  <option value="lost">Lost</option>
                  <option value="archived">Archived</option>
                </select>
                <button onClick={() => setEditing(p)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                <button onClick={() => void remove(p)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(adding || editing) && (
        <ProspectFormModal
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

function ProspectFormModal({ initial, onClose, onSaved }: { initial: Prospect | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    contact_name: initial?.contact_name ?? '',
    company_name: initial?.company_name ?? '',
    email: initial?.email ?? '',
    phone: initial?.phone ?? '',
    client_type: initial?.client_type ?? 'limited_company',
    source: initial?.source ?? '',
    notes: initial?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!form.contact_name.trim() || !form.email.trim()) { setError('Name and email are required.'); return; }
    setSaving(true); setError(null);
    try {
      const body = {
        contact_name: form.contact_name,
        company_name: form.company_name || null,
        email: form.email,
        phone: form.phone || null,
        client_type: form.client_type,
        source: form.source || null,
        notes: form.notes || null,
      };
      if (initial) {
        await fetch(`/api/proposals/prospects/${initial.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch('/api/proposals/prospects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold">{initial ? 'Edit prospect' : 'New prospect'}</h3>
          <button onClick={onClose} disabled={saving} className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><X size={14} /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <FieldM label="Contact name *"><input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="input-base text-sm w-full" /></FieldM>
          <FieldM label="Company name"><input value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} className="input-base text-sm w-full" /></FieldM>
          <FieldM label="Email *"><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-base text-sm w-full" /></FieldM>
          <FieldM label="Phone"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input-base text-sm w-full" /></FieldM>
          <FieldM label="Client type">
            <select value={form.client_type} onChange={e => setForm({ ...form, client_type: e.target.value })} className="input-base text-sm w-full">
              <option value="sole_trader">Sole trader</option>
              <option value="limited_company">Limited company</option>
              <option value="llp">LLP</option>
              <option value="partnership">Partnership</option>
              <option value="charity">Charity</option>
              <option value="trust">Trust</option>
              <option value="individual">Individual</option>
              <option value="other">Other</option>
            </select>
          </FieldM>
          <FieldM label="Source"><input value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="referral / web / event…" className="input-base text-sm w-full" /></FieldM>
          <label className="col-span-2 block"><span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Notes</span>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="input-base text-sm w-full" />
          </label>
        </div>
        {error && <div className="px-5 pb-2 text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm">
            {saving ? <Loader2 size={12} className="animate-spin inline mr-1" /> : <Check size={12} className="inline mr-1" />}{initial ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
