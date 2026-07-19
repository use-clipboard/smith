'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Eye, MousePointerClick, Send, TrendingDown, UserMinus, Reply } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface ReportData {
  campaign: { id: string; name: string; subject: string; status: string; sent_at: string | null };
  totals: { recipients: number; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number; failed: number; skipped: number };
  topLinks: { url: string; count: number }[];
  timeline: { date: string; opens: number; clicks: number }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recipients: any[];
}

function Stat({ icon: Icon, label, value, sub, tint }: { icon: typeof Eye; label: string; value: string; sub?: string; tint: string }) {
  return (
    <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${tint}1a` }}><Icon size={14} style={{ color: tint }} /></div>
        <span className="text-xs text-[var(--text-secondary)] font-medium">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
      {sub && <div className="text-xs text-[var(--text-secondary)]">{sub}</div>}
    </div>
  );
}

export default function CampaignReport({ campaignId, onBack }: { campaignId: string; onBack: () => void }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`/api/campaigns/${campaignId}/report`);
        if (r.ok && live) setData(await r.json());
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [campaignId]);

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;
  if (!data) return <div className="text-sm text-[var(--text-secondary)] py-10 text-center">Couldn’t load this report.</div>;

  const t = data.totals;
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : '—');

  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-3">
        <ArrowLeft size={15} /> All reports
      </button>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{data.campaign.name}</h3>
      <p className="text-sm text-[var(--text-secondary)] mb-4">{data.campaign.subject}</p>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
        <Stat icon={Send} label="Sent" value={String(t.sent)} sub={`${t.recipients} recipients`} tint="#7C3AED" />
        <Stat icon={Eye} label="Opened" value={String(t.opened)} sub={pct(t.opened, t.sent)} tint="#2563EB" />
        <Stat icon={MousePointerClick} label="Clicked" value={String(t.clicked)} sub={pct(t.clicked, t.sent)} tint="#0891B2" />
        <Stat icon={Reply} label="Replied" value={String(t.replied)} sub={pct(t.replied, t.sent)} tint="#16A34A" />
        <Stat icon={TrendingDown} label="Bounced" value={String(t.bounced)} sub={pct(t.bounced, t.sent)} tint="#DC2626" />
        <Stat icon={UserMinus} label="Unsubscribed" value={String(t.unsubscribed)} tint="#B45309" />
        <Stat icon={Send} label="Failed / skipped" value={String(t.failed + t.skipped)} tint="#6B7280" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top links */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Most clicked links</h4>
          {data.topLinks.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)] py-4 text-center">No link clicks yet.</div>
          ) : (
            <div className="space-y-2">
              {data.topLinks.map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-[var(--text-secondary)] truncate">{l.url}</span>
                  <span className="font-semibold text-[var(--text-primary)] shrink-0">{l.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recipient engagement */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Recipients</h4>
          <div className="max-h-72 overflow-y-auto scrollbar-thin divide-y divide-black/5">
            {data.recipients.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--text-primary)] truncate">{r.name || r.email}</div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">{r.email}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  {r.opened_at && <span className="inline-flex items-center gap-1 text-blue-600"><Eye size={12} />{r.open_count}</span>}
                  {r.first_clicked_at && <span className="inline-flex items-center gap-1 text-cyan-600"><MousePointerClick size={12} />{r.click_count}</span>}
                  {r.replied_at && <span className="inline-flex items-center gap-1 text-green-600"><Reply size={12} />replied</span>}
                  {r.bounced_at && <span className="text-red-600">bounced</span>}
                  {r.unsubscribed_at && <span className="text-amber-600">unsub</span>}
                  {r.status === 'failed' && <span className="text-red-600">failed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
