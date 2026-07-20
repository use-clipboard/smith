'use client';

import { useEffect, useState } from 'react';
import {
  ArrowLeft, Eye, MousePointerClick, Send, TrendingDown, UserMinus, Reply,
  FileUp, ClipboardCheck, PoundSterling, Target, CalendarCheck, Landmark,
} from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface Outcomes {
  windowDays: number;
  documentsUploaded: number;
  tasksCompleted: number;
  invoicesPaid: number;
  mtdSubmitted: number;
  accountsApproved: number;
  anyOutcome: number;
}

interface ReportData {
  campaign: { id: string; name: string; subject: string; status: string; sent_at: string | null };
  totals: { recipients: number; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number; failed: number; skipped: number };
  topLinks: { url: string; count: number }[];
  timeline: { date: string; opens: number; clicks: number }[];
  outcomes: Outcomes;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recipients: any[];
}

const WINDOWS = [7, 14, 30];

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

function OutcomeTile({ icon: Icon, value, label }: { icon: typeof Eye; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shrink-0"><Icon size={18} className="text-[var(--accent)]" /></div>
      <div>
        <div className="text-2xl font-semibold text-[var(--text-primary)] leading-none">{value}</div>
        <div className="text-xs text-[var(--text-secondary)] mt-1">{label}</div>
      </div>
    </div>
  );
}

export default function CampaignReport({ campaignId, onBack }: { campaignId: string; onBack: () => void }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(14);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const r = await fetch(`/api/campaigns/${campaignId}/report?window=${windowDays}`);
        if (r.ok && live) setData(await r.json());
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [campaignId, windowDays]);

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;
  if (!data) return <div className="text-sm text-[var(--text-secondary)] py-10 text-center">Couldn’t load this report.</div>;

  const t = data.totals;
  const o = data.outcomes;
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

      {/* Outcomes — what makes this beat a normal newsletter tool */}
      <div className="rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent-light)]/30 p-5 mb-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Target size={16} style={{ color: 'var(--accent)' }} />
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">What happened after this campaign</h4>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs font-semibold bg-white">
            {WINDOWS.map(w => (
              <button key={w} onClick={() => setWindowDays(w)}
                className={`px-2.5 py-1 ${windowDays === w ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
                {w} days
              </button>
            ))}
          </div>
        </div>

        <div className="text-sm text-[var(--text-primary)] mb-4">
          <span className="text-2xl font-semibold">{o.anyOutcome}</span>
          <span className="text-[var(--text-secondary)]"> of {t.sent} recipients took an action in the {o.windowDays} days after opening.</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          <OutcomeTile icon={FileUp} value={o.documentsUploaded} label="uploaded documents / records" />
          <OutcomeTile icon={ClipboardCheck} value={o.tasksCompleted} label="had a task completed" />
          <OutcomeTile icon={PoundSterling} value={o.invoicesPaid} label="paid an invoice" />
          <OutcomeTile icon={CalendarCheck} value={o.mtdSubmitted} label="MTD quarter submitted" />
          <OutcomeTile icon={Landmark} value={o.accountsApproved} label="approved their accounts" />
        </div>

        <p className="text-[11px] text-[var(--text-muted)] mt-4">
          Activity across your practice in the window after the send — shown for context, not as proof the email caused it.
        </p>
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
                  {r.outcomes?.documents && <FileUp size={12} className="text-[var(--accent)]" aria-label="Uploaded documents after send" />}
                  {r.outcomes?.tasks && <ClipboardCheck size={12} className="text-[var(--accent)]" aria-label="Task completed after send" />}
                  {r.outcomes?.invoices && <PoundSterling size={12} className="text-[var(--accent)]" aria-label="Paid an invoice after send" />}
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
