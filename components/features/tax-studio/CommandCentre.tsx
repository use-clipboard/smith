'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Sparkles, ArrowRight, LayoutGrid, List as ListIcon, Loader2,
  TrendingUp, Layers, ClipboardCheck, AlertCircle, CheckCircle2, FileCheck2,
  Clock3, CalendarClock, Mail, PiggyBank, Activity, ChevronRight, X, Trash2, AlertTriangle,
  User, Building2, Users, Landmark, Globe2, type LucideIcon,
} from 'lucide-react';
import { StudioCard, StatusBadge } from './primitives';
import {
  deriveStatus, stageProgress, currentFilingSeason, returnType, fmtMoney, fmtDateUK,
  deadlineForTaxYear, STATUS_META, WORKFLOW_COLUMNS, STAGES,
} from './data';
import { estimateSa100 } from './calc';
import type { ReturnListItem } from './persistence';
import type { ReturnStatus, TaxReturn, TimelineEvent, TaxSuggestion } from './types';

// Bucket → which statuses it counts, colour, icon.
const BUCKETS: { key: string; label: string; statuses: ReturnStatus[]; color: string; tone: string; icon: typeof Layers }[] = [
  { key: 'progress', label: 'In progress',       statuses: ['not-started', 'waiting-info', 'analysing'], color: '#3b82f6', tone: 'text-blue-600 bg-blue-50', icon: Loader2 },
  { key: 'review',   label: 'Awaiting review',   statuses: ['review'],            color: '#8b5cf6', tone: 'text-violet-600 bg-violet-50', icon: ClipboardCheck },
  { key: 'approval', label: 'Awaiting approval', statuses: ['ready-to-send', 'awaiting-approval'], color: '#f59e0b', tone: 'text-amber-600 bg-amber-50', icon: AlertCircle },
  { key: 'ready',    label: 'Ready to file',     statuses: ['ready-to-file', 'approved'], color: '#14b8a6', tone: 'text-teal-600 bg-teal-50', icon: CheckCircle2 },
  { key: 'filed',    label: 'Filed',             statuses: ['filed', 'amended'],  color: '#6366f1', tone: 'text-indigo-600 bg-indigo-50', icon: FileCheck2 },
];

type RowWithStatus = ReturnListItem & { status: ReturnStatus };
interface BucketView { label: string; tint: string; icon: typeof Layers; rows: RowWithStatus[] }

// The top-level tax services. Only Personal Tax (SA100) is live today; the rest
// are scaffolded as "coming soon" tiles. Each will open its own sub-dashboard.
export type TaxServiceId = 'personal' | 'company' | 'partnership' | 'trust' | 'cgt' | 'nonresident';
export const TAX_SERVICES: { id: TaxServiceId; title: string; sub: string; icon: LucideIcon; available: boolean }[] = [
  { id: 'personal',    title: 'Personal Tax (SA100)', sub: 'Individuals & sole traders', icon: User,       available: true },
  { id: 'company',     title: 'Company Tax (CT600)',  sub: 'Limited companies',          icon: Building2,  available: false },
  { id: 'partnership', title: 'Partnership (SA800)',  sub: 'Partnerships & LLPs',         icon: Users,      available: false },
  { id: 'trust',       title: 'Trust & Estate (SA900)', sub: 'Trusts & estates',         icon: Landmark,   available: false },
  { id: 'cgt',         title: 'Capital Gains (CGT)',  sub: 'Standalone CGT reporting',    icon: TrendingUp, available: false },
  { id: 'nonresident', title: 'Non-resident (SA109)', sub: 'Non-resident individuals',    icon: Globe2,     available: false },
];

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return fmtDateUK(iso);
}

export default function CommandCentre({
  items, loading, userName, onNew, onOpen, onDelete,
  activeService = 'personal', onSelectService,
}: {
  items: ReturnListItem[];
  loading: boolean;
  userName: string;
  onNew: () => void;
  onOpen: (r: TaxReturn) => void;
  onDelete?: (id: string) => Promise<void>;
  activeService?: TaxServiceId;
  onSelectService?: (id: TaxServiceId) => void;
}) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [bucketView, setBucketView] = useState<BucketView | null>(null);
  const [infoBox, setInfoBox] = useState<null | 'returns' | 'insights' | 'deadlines' | 'suggestions' | 'pipeline' | 'activity'>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showOrphaned, setShowOrphaned] = useState(false);
  const season = currentFilingSeason();

  const allRows = useMemo(() => items.map(it => ({ ...it, status: deriveStatus(it.ret) })), [items]);
  // Returns whose client was deleted are dropped from every active view and
  // surfaced separately (see the "deleted client" panel below).
  const rows = useMemo(() => allRows.filter(r => r.clientLinked), [allRows]);
  const orphanedRows = useMemo(() => allRows.filter(r => !r.clientLinked), [allRows]);
  const total = rows.length;

  const askDelete = (item: RowWithStatus) => setConfirmDelete({ id: item.id, label: `${item.ret.clientName} — ${returnType(item.ret.returnType).form} ${item.ret.taxYear}` });

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of BUCKETS) map[b.key] = rows.filter(r => b.statuses.includes(r.status)).length;
    return map;
  }, [rows]);

  const suggestions = useMemo(
    () => rows.flatMap(r => r.ret.suggestions.map(s => ({ ...s, client: r.ret.clientName, ret: r.ret }))).sort((a, b) => b.estSaving - a.estSaving),
    [rows],
  );
  const totalSavings = suggestions.reduce((a, s) => a + s.estSaving, 0);
  const highImpact = suggestions.filter(s => s.estSaving >= 1000 || s.confidence >= 75).length;
  const medImpact = suggestions.length - highImpact;

  // The current user's own returns, most-recently-edited first — "Continue
  // working" is personal, not the whole firm's book.
  const myReturns = useMemo(
    () => rows.filter(r => r.mine).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [rows],
  );
  const continueWorking = useMemo(
    () => myReturns.filter(r => !['filed', 'archived'].includes(r.status)),
    [myReturns],
  );

  const deadlines = useMemo(() =>
    rows.filter(r => !['filed', 'archived'].includes(r.status))
      .map(r => ({ r, date: deadlineForTaxYear(r.ret.taxYear) }))
      .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [rows]);

  const activity = useMemo(() =>
    rows.flatMap(r => r.ret.timeline.map(t => ({ ev: t, client: r.ret.clientName })))
      .sort((a, b) => (a.ev.at < b.ev.at ? 1 : -1)),
    [rows]);

  const briefing = useMemo(() => {
    const out: { icon: typeof Sparkles; headline: string; sub: string; tone: string }[] = [];
    const actionable = counts.progress + counts.ready;
    if (actionable) out.push({ icon: Sparkles, headline: `${actionable} return${actionable > 1 ? 's' : ''} can be progressed today`, sub: 'Ready to work on', tone: 'text-[var(--accent)] bg-[var(--accent)]/10' });
    if (counts.review) out.push({ icon: ClipboardCheck, headline: `${counts.review} return${counts.review > 1 ? 's' : ''} awaiting review`, sub: 'Needs your sign-off', tone: 'text-violet-600 bg-violet-50' });
    if (counts.approval) out.push({ icon: Clock3, headline: `${counts.approval} awaiting client approval`, sub: 'Sent to clients', tone: 'text-amber-600 bg-amber-50' });
    if (totalSavings > 0) out.push({ icon: PiggyBank, headline: `${fmtMoney(totalSavings)} in advisory opportunities`, sub: 'Tax planning suggestions available', tone: 'text-emerald-600 bg-emerald-50' });
    if (out.length === 0) out.push({ icon: Sparkles, headline: 'No returns in progress yet', sub: 'Start one to see your briefing', tone: 'text-[var(--accent)] bg-[var(--accent)]/10' });
    return out;
  }, [counts, totalSavings]);

  return (
    <div className="space-y-5">
      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">
          <CalendarClock size={14} className="text-[var(--accent)]" /> Tax Season {season.taxYear}
        </span>
        <button onClick={onNew} className="btn-primary"><Plus size={16} /> New return</button>
      </div>

      {/* Tax dashboards selector */}
      <TaxServiceTiles active={activeService} onSelect={onSelectService} />

      {/* Buckets */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <BucketCard label="Total returns" value={total} icon={Layers} tint="#64748B"
          onClick={() => setBucketView({ label: 'All returns', tint: '#64748B', icon: Layers, rows })} />
        {BUCKETS.map(b => (
          <BucketCard key={b.key} label={b.label} value={counts[b.key]} pct={total ? Math.round((counts[b.key] / total) * 100) : 0} icon={b.icon} tint={b.color}
            onClick={() => setBucketView({ label: b.label, tint: b.color, icon: b.icon, rows: rows.filter(r => b.statuses.includes(r.status)) })} />
        ))}
      </div>

      {/* Row 1: Continue working | AI briefing | Upcoming deadlines */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Continue working */}
        <Panel title="Continue working" action="View all my returns" onAction={() => setInfoBox('returns')}>
          {loading ? <PanelLoading /> : continueWorking.length === 0 ? (
            <PanelEmpty text="Nothing in progress." />
          ) : (
            <ContinueList items={continueWorking} onOpen={onOpen} />
          )}
        </Panel>

        {/* AI briefing */}
        <Panel title="AI briefing" action="View all insights" onAction={() => setInfoBox('insights')}>
          <BriefingList items={briefing} />
        </Panel>

        {/* Upcoming deadlines */}
        <Panel title="Upcoming deadlines" action="View all deadlines" onAction={() => setInfoBox('deadlines')}>
          {deadlines.length === 0 ? <PanelEmpty text="No open deadlines." /> : <DeadlineList items={deadlines} onOpen={onOpen} />}
        </Panel>
      </div>

      {/* Row 2: AI suggestions | Returns by status | Recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* AI suggestions */}
        <Panel title="AI suggestions for your clients" action="View all suggestions" onAction={() => setInfoBox('suggestions')}>
          {suggestions.length === 0 ? <PanelEmpty text="Run Analyse on a return to surface opportunities." /> : <SuggestionList items={suggestions} onOpen={onOpen} />}
        </Panel>

        {/* Returns by status donut */}
        <Panel title="Returns by status" action="View full pipeline" onAction={() => setInfoBox('pipeline')}>
          <div className="flex items-center gap-4">
            <StatusDonut total={total} segments={BUCKETS.map(b => ({ label: b.label, value: counts[b.key], color: b.color }))} />
            <div className="flex-1 space-y-1">
              {BUCKETS.map(b => (
                <div key={b.key} className="flex items-center gap-2 text-[11.5px]">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="flex-1 text-[var(--text-secondary)]">{b.label}</span>
                  <span className="font-semibold text-[var(--text-primary)]">{counts[b.key]}</span>
                  <span className="w-9 text-right text-[var(--text-muted)]">{total ? Math.round((counts[b.key] / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent activity" action="View all activity" onAction={() => setInfoBox('activity')}>
          {activity.length === 0 ? <PanelEmpty text="Activity will appear here as you work." /> : <ActivityList items={activity} />}
        </Panel>
      </div>

      {/* All returns (list / board) */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[13px] font-bold text-[var(--text-primary)]">All returns</p>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white/60 p-0.5">
            <ToggleBtn active={view === 'list'} onClick={() => setView('list')} icon={ListIcon} />
            <ToggleBtn active={view === 'board'} onClick={() => setView('board')} icon={LayoutGrid} />
          </div>
        </div>
        {loading ? (
          <StudioCard className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading returns…</StudioCard>
        ) : rows.length === 0 ? (
          <EmptyState onNew={onNew} />
        ) : view === 'list' ? (
          <div className="max-h-[440px] overflow-y-auto rounded-[18px]">
            <ReturnList rows={rows} onOpen={onOpen} onAskDelete={onDelete ? askDelete : undefined} />
          </div>
        ) : (
          <div className="max-h-[440px] overflow-y-auto">
            <KanbanBoard rows={rows} onOpen={onOpen} />
          </div>
        )}

        {/* Returns whose client was deleted — off the dashboard, still reachable. */}
        {orphanedRows.length > 0 && (
          <div className="mt-3">
            <button onClick={() => setShowOrphaned(v => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]">
              <ChevronRight size={13} className={`transition-transform ${showOrphaned ? 'rotate-90' : ''}`} />
              {orphanedRows.length} return{orphanedRows.length === 1 ? '' : 's'} with a deleted client
            </button>
            {showOrphaned && (
              <StudioCard className="mt-2 divide-y divide-black/5 overflow-hidden">
                {orphanedRows.map(r => {
                  const rt = returnType(r.ret.returnType);
                  const Icon = rt.icon;
                  return (
                    <div key={r.id} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02]">
                      <button onClick={() => onOpen(r.ret)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400"><Icon size={16} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-[var(--text-secondary)]">{r.ret.clientName}</p>
                          <p className="text-[11.5px] text-[var(--text-muted)]">{rt.form} · {r.ret.taxYear} · edited {r.date}</p>
                        </div>
                      </button>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Client deleted</span>
                      <StatusBadge status={r.status} />
                      {onDelete && (
                        <button onClick={() => askDelete(r)} aria-label="Delete return"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </StudioCard>
            )}
          </div>
        )}
      </div>

      {/* Planning opportunities banner */}
      <StudioCard className="overflow-hidden">
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-5" style={{ background: 'linear-gradient(135deg,#4F46E5 0%,#6366F1 50%,#7C3AED 100%)' }}>
          <div className="pointer-events-none absolute -right-6 -top-8 h-32 w-32 rounded-full bg-white/15 blur-2xl" />
          <div>
            <p className="flex items-center gap-1.5 text-[15px] font-bold text-white"><Sparkles size={16} /> Tax planning opportunities</p>
            <p className="mt-0.5 text-[12.5px] text-white/85">Explore what-if scenarios and potential tax savings for your clients.</p>
          </div>
          <div className="flex items-center gap-6">
            <BannerStat label="Total potential savings" value={fmtMoney(totalSavings)} />
            <BannerStat label="High impact" value={String(highImpact)} />
            <BannerStat label="Medium impact" value={String(medImpact)} />
          </div>
        </div>
      </StudioCard>

      <BucketLightbox
        bucket={bucketView}
        onClose={() => setBucketView(null)}
        onOpen={r => { setBucketView(null); onOpen(r); }}
      />

      <InfoLightbox
        kind={infoBox}
        onClose={() => setInfoBox(null)}
        onOpen={r => { setInfoBox(null); onOpen(r); }}
        myReturns={myReturns}
        allReturns={rows}
        briefing={briefing}
        deadlines={deadlines}
        suggestions={suggestions}
        activity={activity}
      />

      <ConfirmDeleteModal
        target={confirmDelete}
        deleting={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete || !onDelete) return;
          setDeleting(true);
          try { await onDelete(confirmDelete.id); } finally { setDeleting(false); setConfirmDelete(null); }
        }}
      />
    </div>
  );
}

// ─── Tax service selector ────────────────────────────────────────────────────
function TaxServiceTiles({ active, onSelect }: { active: TaxServiceId; onSelect?: (id: TaxServiceId) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <p className="text-[13px] font-bold text-[var(--text-primary)]">Tax Dashboards</p>
        <p className="text-[11.5px] text-[var(--text-muted)]">Open a Tax Dashboard</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TAX_SERVICES.map(s => (
          <CategoryTile
            key={s.id}
            title={s.title}
            sub={s.sub}
            icon={s.icon}
            active={s.id === active}
            soon={!s.available}
            onClick={s.available && onSelect ? () => onSelect(s.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function CategoryTile({ title, sub, icon: Icon, active, soon, onClick }: {
  title: string; sub: string; icon: LucideIcon; active: boolean; soon: boolean; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={soon}
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border px-2.5 py-2 text-left transition-all duration-200 ${
        soon
          ? 'cursor-default border-[var(--border)] bg-white/45'
          : 'cursor-pointer border-[var(--border)] bg-white/70 hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:bg-white hover:shadow-[0_10px_26px_rgba(99,102,241,0.18)] active:translate-y-0 active:shadow-[0_4px_14px_rgba(99,102,241,0.12)]'
      }`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${
        soon ? 'bg-slate-100 text-slate-300' : 'bg-[var(--accent)]/10 text-[var(--accent)] group-hover:bg-[var(--accent)] group-hover:text-white'
      }`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className={`truncate text-[11.5px] font-bold leading-tight ${soon ? 'text-slate-400' : 'text-[var(--text-primary)]'}`}>{title}</h4>
        <p className={`truncate text-[10px] leading-tight ${soon ? 'text-slate-300' : 'text-[var(--text-muted)]'}`}>{sub}</p>
      </div>
      {soon ? (
        <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[8px] font-bold uppercase tracking-[0.06em] text-slate-400">Soon</span>
      ) : (
        <ArrowRight size={14} className="shrink-0 -translate-x-1 text-[var(--text-muted)] opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-[var(--accent)] group-hover:opacity-100" />
      )}
    </button>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────────────
function BucketLightbox({ bucket, onClose, onOpen }: { bucket: BucketView | null; onClose: () => void; onOpen: (r: TaxReturn) => void }) {
  useEffect(() => {
    if (!bucket) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bucket, onClose]);

  if (!bucket) return null;
  const Icon = bucket.icon;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        className="relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[22px] border border-white/60 bg-white/90 shadow-[0_24px_80px_rgba(31,38,88,0.28)] backdrop-blur-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${bucket.tint}1f`, color: bucket.tint }}><Icon size={18} /></div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">{bucket.label}</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">{bucket.rows.length} return{bucket.rows.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {bucket.rows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-[var(--text-muted)]">No returns in this status.</p>
          ) : (
            bucket.rows.map(r => {
              const rt = returnType(r.ret.returnType);
              const RIcon = rt.icon;
              return (
                <button key={r.id} onClick={() => onOpen(r.ret)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03]">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><RIcon size={16} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{r.ret.clientName}</p>
                    <p className="text-[11.5px] text-[var(--text-muted)]">{rt.form} · {r.ret.taxYear} · edited {r.date}</p>
                  </div>
                  <StatusBadge status={r.status} />
                  <ChevronRight size={15} className="shrink-0 text-[var(--text-muted)]" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// A lightbox listing the full data behind a dashboard panel's "View all …" link.
function InfoLightbox({ kind, onClose, onOpen, myReturns, allReturns, briefing, deadlines, suggestions, activity }: {
  kind: null | 'returns' | 'insights' | 'deadlines' | 'suggestions' | 'pipeline' | 'activity';
  onClose: () => void;
  onOpen: (r: TaxReturn) => void;
  myReturns: RowWithStatus[];
  allReturns: RowWithStatus[];
  briefing: BriefingItem[];
  deadlines: DeadlineItem[];
  suggestions: SuggestionItem[];
  activity: ActivityItem[];
}) {
  useEffect(() => {
    if (!kind) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [kind, onClose]);

  if (!kind) return null;

  const META: Record<Exclude<typeof kind, null>, { title: string; icon: typeof Layers; tint: string; count: number; empty: string }> = {
    returns:     { title: 'My returns',         icon: Layers,        tint: '#6366f1', count: myReturns.length,   empty: 'You have no returns yet.' },
    insights:    { title: 'AI briefing',        icon: Sparkles,      tint: '#6366f1', count: briefing.length,    empty: 'No insights yet.' },
    deadlines:   { title: 'Upcoming deadlines', icon: CalendarClock, tint: '#f59e0b', count: deadlines.length,   empty: 'No open deadlines.' },
    suggestions: { title: 'AI suggestions',     icon: PiggyBank,     tint: '#10b981', count: suggestions.length, empty: 'No suggestions yet.' },
    pipeline:    { title: 'Full pipeline',      icon: Activity,      tint: '#6366f1', count: allReturns.length,  empty: 'No returns yet.' },
    activity:    { title: 'Recent activity',    icon: Activity,      tint: '#6366f1', count: activity.length,    empty: 'No activity yet.' },
  };
  const m = META[kind];
  const Icon = m.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-[22px] border border-white/60 bg-white/90 shadow-[0_24px_80px_rgba(31,38,88,0.28)] backdrop-blur-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-black/5 px-5 py-3.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${m.tint}1f`, color: m.tint }}><Icon size={18} /></div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-[var(--text-primary)]">{m.title}</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">{m.count} item{m.count === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-black/5"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {m.count === 0 ? (
            <p className="py-10 text-center text-[13px] text-[var(--text-muted)]">{m.empty}</p>
          ) : kind === 'returns' ? (
            <ContinueList items={myReturns} onOpen={onOpen} />
          ) : kind === 'pipeline' ? (
            <ContinueList items={allReturns} onOpen={onOpen} />
          ) : kind === 'insights' ? (
            <BriefingList items={briefing} />
          ) : kind === 'deadlines' ? (
            <DeadlineList items={deadlines} onOpen={onOpen} />
          ) : kind === 'suggestions' ? (
            <SuggestionList items={suggestions} onOpen={onOpen} />
          ) : (
            <ActivityList items={activity} />
          )}
        </div>
      </div>
    </div>
  );
}

function BucketCard({ label, value, pct, icon: Icon, tint, onClick }: { label: string; value: number | string; pct?: number; icon: typeof Layers; tint: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group relative w-full overflow-hidden rounded-[20px] border border-white/60 bg-white/70 p-4 text-left shadow-[0_8px_32px_rgba(31,38,88,0.08)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(31,38,88,0.14)]">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-40 blur-2xl transition-opacity group-hover:opacity-70" style={{ background: tint }} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
          <p className="mt-1.5 text-[24px] font-bold leading-none text-[var(--text-primary)]">
            {value}{pct != null && <span className="ml-1 text-[12px] font-semibold text-[var(--text-muted)]">{pct}%</span>}
          </p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${tint}1f`, color: tint }}>
          <Icon size={18} />
        </div>
      </div>
    </button>
  );
}

function Panel({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <StudioCard className="flex flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-bold text-[var(--text-primary)]">{title}</p>
        {action && <button onClick={onAction} disabled={!onAction} className="flex items-center gap-0.5 text-[11px] font-semibold text-[var(--accent)] transition-opacity hover:opacity-80 disabled:opacity-45">{action} <ArrowRight size={11} /></button>}
      </div>
      <div className="flex-1 overflow-y-auto pr-0.5" style={{ maxHeight: 232 }}>{children}</div>
    </StudioCard>
  );
}
function PanelLoading() { return <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading…</div>; }
function PanelEmpty({ text }: { text: string }) { return <p className="py-6 text-center text-[12px] text-[var(--text-muted)]">{text}</p>; }

// ─── Shared list renderers (used by both the panels and their lightboxes) ─────
type DeadlineItem = { r: RowWithStatus; date: Date };
type ActivityItem = { ev: TimelineEvent; client: string };
type SuggestionItem = TaxSuggestion & { client: string; ret: TaxReturn };
type BriefingItem = { icon: typeof Sparkles; headline: string; sub: string; tone: string };

function ContinueList({ items, onOpen }: { items: RowWithStatus[]; onOpen: (r: TaxReturn) => void }) {
  return (
    <div className="space-y-1">
      {items.map(r => {
        const rt = returnType(r.ret.returnType);
        const prog = stageProgress(r.ret);
        return (
          <button key={r.id} onClick={() => onOpen(r.ret)} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.03]">
            <Avatar name={r.ret.clientName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{r.ret.clientName}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{rt.form} · {r.ret.taxYear}</p>
            </div>
            <StatusBadge status={r.status} />
            <div className="hidden w-20 items-center gap-1.5 sm:flex">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/70"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(prog / 5) * 100}%` }} /></div>
              <span className="text-[10px] text-[var(--text-muted)]">{Math.round((prog / 5) * 100)}%</span>
            </div>
            <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)]" />
          </button>
        );
      })}
    </div>
  );
}

function DeadlineList({ items, onOpen }: { items: DeadlineItem[]; onOpen: (r: TaxReturn) => void }) {
  return (
    <div className="space-y-1">
      {items.map(({ r, date }) => {
        const days = Math.round((date.getTime() - Date.now()) / 86400000);
        const rt = returnType(r.ret.returnType);
        return (
          <button key={r.id} onClick={() => onOpen(r.ret)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.03]">
            <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-slate-100 leading-none">
              <span className="text-[13px] font-extrabold text-[var(--text-primary)]">{date.getDate()}</span>
              <span className="text-[9px] font-semibold uppercase text-[var(--text-muted)]">{date.toLocaleString('en-GB', { month: 'short' })}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{r.ret.clientName}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{rt.form} · {r.ret.taxYear}</p>
            </div>
            <span className={`shrink-0 text-[11px] font-semibold ${days < 30 ? 'text-rose-600' : days < 90 ? 'text-amber-600' : 'text-[var(--text-muted)]'}`}>{days > 0 ? `${days} days` : 'due'}</span>
          </button>
        );
      })}
    </div>
  );
}

function SuggestionList({ items, onOpen }: { items: SuggestionItem[]; onOpen: (r: TaxReturn) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((s, i) => {
        const high = s.estSaving >= 1000 || s.confidence >= 75;
        return (
          <button key={i} onClick={() => onOpen(s.ret)} className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-white/60 px-3 py-2 text-left transition-colors hover:border-[var(--accent)]/40">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={14} /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{s.title}</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">{s.client}{s.estSaving > 0 ? ` · save ~${fmtMoney(s.estSaving)}` : ''}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${high ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{high ? 'High' : 'Medium'}</span>
          </button>
        );
      })}
    </div>
  );
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  return (
    <div className="space-y-2">
      {items.map(({ ev, client }, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]"><ActivityIcon kind={ev.kind} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-[var(--text-secondary)]"><span className="font-semibold text-[var(--text-primary)]">{client}</span> — {ev.label}</p>
            <p className="text-[10.5px] text-[var(--text-muted)]">{relTime(ev.at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function BriefingList({ items }: { items: BriefingItem[] }) {
  return (
    <div className="space-y-1">
      {items.map((b, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${b.tone}`}><b.icon size={15} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{b.headline}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{b.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-[11px] text-white/75">{label}</p>
      <p className="text-[18px] font-extrabold text-white">{value}</p>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: TimelineEvent['kind'] }) {
  const map: Partial<Record<TimelineEvent['kind'], typeof Sparkles>> = {
    created: Plus, imported: ArrowRight, analysed: Sparkles, reviewed: ClipboardCheck,
    sent: Mail, approved: CheckCircle2, filed: FileCheck2, edited: Activity,
  };
  const Icon = map[kind] ?? Activity;
  return <Icon size={12} />;
}

function StatusDonut({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  const r = 42, circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="relative h-[104px] w-[104px] shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="14" className="stroke-slate-100" />
        {total > 0 && segments.map(s => {
          const len = (s.value / total) * circ;
          const el = <circle key={s.label} cx="60" cy="60" r={r} fill="none" strokeWidth="14" stroke={s.color} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} strokeLinecap="butt" />;
          acc += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[19px] font-extrabold text-[var(--text-primary)]">{total}</span>
        <span className="text-[10px] text-[var(--text-muted)]">Total</span>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px] font-bold text-[var(--accent)]">{initials}</div>;
}

function ToggleBtn({ active, onClick, icon: Icon }: { active: boolean; onClick: () => void; icon: typeof ListIcon }) {
  return (
    <button onClick={onClick} className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-black/5'}`}>
      <Icon size={14} />
    </button>
  );
}

function ReturnList({ rows, onOpen, onAskDelete }: { rows: (ReturnListItem & { status: ReturnStatus })[]; onOpen: (r: TaxReturn) => void; onAskDelete?: (item: ReturnListItem & { status: ReturnStatus }) => void }) {
  return (
    <StudioCard className="divide-y divide-black/5 overflow-hidden">
      {rows.map(r => {
        const rt = returnType(r.ret.returnType);
        const est = estimateSa100(r.ret.income, r.ret.taxYear);
        const Icon = rt.icon;
        return (
          <div key={r.id} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02]">
            <button onClick={() => onOpen(r.ret)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]"><Icon size={16} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{r.ret.clientName}</p>
                <p className="text-[11.5px] text-[var(--text-muted)]">{rt.form} · {r.ret.taxYear} · edited {r.date}</p>
              </div>
            </button>
            {est.totalTax > 0 && <span className="hidden text-[12px] text-[var(--text-secondary)] sm:block">{fmtMoney(est.totalTax)} tax</span>}
            <StatusBadge status={r.status} />
            {onAskDelete && (
              <button
                onClick={() => onAskDelete(r)}
                aria-label="Delete return"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            )}
            <button onClick={() => onOpen(r.ret)} aria-label="Open return" className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowRight size={15} /></button>
          </div>
        );
      })}
    </StudioCard>
  );
}

function ConfirmDeleteModal({ target, deleting, onCancel, onConfirm }: { target: { id: string; label: string } | null; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !deleting) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, deleting, onCancel]);

  if (!target) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => !deleting && onCancel()}>
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-[22px] border border-white/60 bg-white/95 p-5 shadow-[0_24px_80px_rgba(31,38,88,0.28)] backdrop-blur-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600"><AlertTriangle size={18} /></div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-[var(--text-primary)]">Delete this return?</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">Permanently delete <span className="font-semibold text-[var(--text-primary)]">{target.label}</span>. This can’t be undone.</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={deleting} className="btn-secondary bg-white">Cancel</button>
          <button onClick={onConfirm} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function KanbanBoard({ rows, onOpen }: { rows: (ReturnListItem & { status: ReturnStatus })[]; onOpen: (r: TaxReturn) => void }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {WORKFLOW_COLUMNS.map(col => {
        const colRows = rows.filter(r => r.status === col);
        return (
          <div key={col} className="w-[220px] shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_META[col].tone}`}>{STATUS_META[col].label}</span>
              <span className="text-[11px] font-semibold text-[var(--text-muted)]">{colRows.length}</span>
            </div>
            <div className="space-y-2">
              {colRows.map(r => {
                const rt = returnType(r.ret.returnType);
                return (
                  <button key={r.id} onClick={() => onOpen(r.ret)} className="w-full text-left">
                    <StudioCard className="p-3 transition-shadow hover:shadow-[0_10px_30px_rgba(31,38,88,0.14)]">
                      <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{r.ret.clientName}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{rt.form} · {r.ret.taxYear}</p>
                      <div className="mt-2 flex items-center gap-1">
                        {STAGES.map((s, i) => (
                          <div key={s.id} className={`h-1 flex-1 rounded-full ${i < stageProgress(r.ret) ? 'bg-[var(--accent)]' : 'bg-slate-200'}`} />
                        ))}
                      </div>
                    </StudioCard>
                  </button>
                );
              })}
              {colRows.length === 0 && <p className="px-1 text-[11px] text-[var(--text-muted)]">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <StudioCard className="flex flex-col items-center gap-3 px-8 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]"><TrendingUp size={22} /></div>
      <h3 className="text-[15px] font-bold text-[var(--text-primary)]">No returns yet</h3>
      <p className="max-w-sm text-[12.5px] text-[var(--text-muted)]">Start a return and Tax Studio will guide it from setup to filing — pulling figures from across SMITH along the way.</p>
      <button onClick={onNew} className="btn-primary"><Plus size={15} /> New return</button>
    </StudioCard>
  );
}
