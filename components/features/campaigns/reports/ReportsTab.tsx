'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3, ChevronRight } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import CampaignReport from './CampaignReport';

interface CampaignRow { id: string; name: string; subject: string; status: string; sent_at: string | null; stats: Record<string, number> }

function ukDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ReportsTab() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/campaigns');
      if (r.ok) {
        const all = ((await r.json()).campaigns ?? []) as CampaignRow[];
        setRows(all.filter(c => c.status === 'sent'));
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selected) return <CampaignReport campaignId={selected} onBack={() => setSelected(null)} />;
  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;

  if (rows.length === 0) {
    return (
      <div className="glass-solid rounded-2xl border border-[var(--border)] p-10 text-center max-w-lg mx-auto mt-6">
        <div className="w-12 h-12 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-4">
          <BarChart3 size={22} style={{ color: 'var(--accent)' }} />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">No sent campaigns yet</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Once you send a campaign, its opens, clicks and replies show up here.</p>
      </div>
    );
  }

  return (
    <div className="glass-solid rounded-2xl border border-[var(--border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--text-muted)] border-b border-black/5">
            <th className="px-4 py-2.5 font-semibold">Campaign</th>
            <th className="px-4 py-2.5 font-semibold text-right">Sent</th>
            <th className="px-4 py-2.5 font-semibold text-right">Opened</th>
            <th className="px-4 py-2.5 font-semibold text-right">Clicked</th>
            <th className="px-4 py-2.5 font-semibold">Sent on</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-black/5">
          {rows.map(c => (
            <tr key={c.id} className="hover:bg-black/[0.015] cursor-pointer" onClick={() => setSelected(c.id)}>
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--text-primary)]">{c.name}</div>
                <div className="text-xs text-[var(--text-secondary)] truncate max-w-[320px]">{c.subject}</div>
              </td>
              <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{c.stats?.sent ?? 0}</td>
              <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{c.stats?.opened ?? 0}</td>
              <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{c.stats?.clicked ?? 0}</td>
              <td className="px-4 py-3 text-[var(--text-secondary)]">{ukDate(c.sent_at)}</td>
              <td className="px-4 py-3 text-right"><ChevronRight size={15} className="text-[var(--text-muted)]" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
