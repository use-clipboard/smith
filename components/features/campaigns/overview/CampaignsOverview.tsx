'use client';

import { useEffect, useState } from 'react';
import {
  Send, CheckCircle2, Eye, MousePointerClick, TrendingDown, UserMinus,
  CalendarClock, Clock, Sparkles, ArrowRight, Megaphone, Reply,
} from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface Kpis {
  sentThisMonth: number; deliveryRate: number; openRate: number; clickRate: number; replies: number;
  bounceRate: number; unsubscribes: number; scheduled: number; awaitingApproval: number; activeAutomations: number;
}
interface Suggestion { key: string; title: string; detail: string; count: number; action: string }
interface CampaignRow { id: string; name: string; subject: string; status: string; sent_at: string | null; scheduled_at: string | null; stats: Record<string, number> }
interface OverviewData { kpis: Kpis; suggestions: Suggestion[]; recent: CampaignRow[]; upcoming: CampaignRow[]; totalCampaigns: number }

function ukDateTime(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Kpi({ icon: Icon, label, value, tint }: { icon: typeof Send; label: string; value: string; tint: string }) {
  return (
    <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${tint}1a` }}>
          <Icon size={16} style={{ color: tint }} />
        </div>
        <span className="text-[12.5px] text-[var(--text-secondary)] font-medium">{label}</span>
      </div>
      <div className="text-[22px] font-semibold text-[var(--text-primary)] tracking-tight">{value}</div>
    </div>
  );
}

export default function CampaignsOverview({
  onNewCampaign, onStartCampaignFor, onGoToTab,
}: {
  onNewCampaign: () => void;
  onStartCampaignFor: (audienceId?: string, name?: string) => void;
  onGoToTab: (id: string) => void;
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch('/api/campaigns/overview');
        if (r.ok && live) setData(await r.json());
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;
  if (!data) return <div className="text-sm text-[var(--text-secondary)] py-10 text-center">Couldn’t load the dashboard.</div>;

  const k = data.kpis;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3">
        <Kpi icon={Send}               label="Sent this month" value={String(k.sentThisMonth)} tint="#7C3AED" />
        <Kpi icon={CheckCircle2}       label="Delivery rate"   value={`${k.deliveryRate}%`}    tint="#16A34A" />
        <Kpi icon={Eye}                label="Open rate"       value={`${k.openRate}%`}        tint="#2563EB" />
        <Kpi icon={MousePointerClick}  label="Click rate"      value={`${k.clickRate}%`}       tint="#0891B2" />
        <Kpi icon={Reply}              label="Replies"         value={String(k.replies)}       tint="#16A34A" />
        <Kpi icon={TrendingDown}       label="Bounce rate"     value={`${k.bounceRate}%`}      tint="#DC2626" />
        <Kpi icon={UserMinus}          label="Unsubscribes"    value={String(k.unsubscribes)}  tint="#B45309" />
        <Kpi icon={CalendarClock}      label="Scheduled"       value={String(k.scheduled)}     tint="#7C3AED" />
        <Kpi icon={Clock}              label="Awaiting approval" value={String(k.awaitingApproval)} tint="#9333EA" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Communications Briefing (the differentiator) */}
        <div className="lg:col-span-2 glass-solid rounded-2xl border border-[var(--border)] p-5">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} style={{ color: 'var(--accent)' }} />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">SMITH Communications Briefing</h3>
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)]">Live</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Suggested campaigns based on your live client, compliance and billing data.</p>

          {data.suggestions.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)] py-6 text-center">
              Nothing needs chasing right now. Everything looks up to date.
            </div>
          ) : (
            <div className="space-y-2.5">
              {data.suggestions.map(s => (
                <div key={s.key} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-[var(--text-primary)]">{s.title}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{s.detail}</div>
                  </div>
                  <button
                    onClick={() => onStartCampaignFor(undefined, s.action)}
                    className="shrink-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent)] hover:underline"
                  >
                    {s.action} <ArrowRight size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick start */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-5 flex flex-col">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Get started</h3>
          <p className="text-xs text-[var(--text-secondary)] mb-4">Build an audience from your live data, then write and send.</p>
          <div className="space-y-2">
            <button onClick={onNewCampaign} className="btn-primary w-full justify-center"><Megaphone size={15} /> New campaign</button>
            <button onClick={() => onGoToTab('audiences')} className="btn-secondary w-full justify-center"><UserMinus size={15} className="rotate-0" /> Build an audience</button>
          </div>
          <div className="mt-auto pt-4 text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{data.totalCampaigns}</span> campaign{data.totalCampaigns === 1 ? '' : 's'} so far.
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent campaigns */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent campaigns</h3>
            <button onClick={() => onGoToTab('campaigns')} className="text-xs font-semibold text-[var(--accent)] hover:underline">View all</button>
          </div>
          {data.recent.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)] py-6 text-center">No campaigns sent yet.</div>
          ) : (
            <div className="divide-y divide-black/5">
              {data.recent.map(c => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</div>
                    <div className="text-xs text-[var(--text-secondary)]">Sent {ukDateTime(c.sent_at)}</div>
                  </div>
                  <div className="flex gap-4 text-xs text-[var(--text-secondary)] shrink-0">
                    <span><span className="font-semibold text-[var(--text-primary)]">{c.stats?.sent ?? 0}</span> sent</span>
                    <span><span className="font-semibold text-[var(--text-primary)]">{c.stats?.opened ?? 0}</span> opened</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming sends */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Upcoming sends</h3>
          {data.upcoming.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)] py-6 text-center">Nothing scheduled.</div>
          ) : (
            <div className="divide-y divide-black/5">
              {data.upcoming.map(c => (
                <div key={c.id} className="flex items-center gap-3 py-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                    <CalendarClock size={15} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-[var(--text-primary)] truncate">{c.name}</div>
                    <div className="text-xs text-[var(--text-secondary)]">Scheduled {ukDateTime(c.scheduled_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
