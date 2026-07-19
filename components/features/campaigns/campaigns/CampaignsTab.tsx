'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Send, Trash2, Pencil, Mail } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface CampaignRow {
  id: string; name: string; subject: string; status: string; send_mode: string;
  audience_id: string | null; scheduled_at: string | null; sent_at: string | null;
  stats: Record<string, number>; created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  draft:             'bg-gray-100 text-gray-600',
  awaiting_review:   'bg-amber-100 text-amber-700',
  changes_requested: 'bg-orange-100 text-orange-700',
  approved:          'bg-blue-100 text-blue-700',
  scheduled:         'bg-indigo-100 text-indigo-700',
  sending:           'bg-purple-100 text-purple-700',
  sent:              'bg-green-100 text-green-700',
  paused:            'bg-gray-100 text-gray-600',
  cancelled:         'bg-gray-100 text-gray-500',
  failed:            'bg-red-100 text-red-700',
};
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', awaiting_review: 'Awaiting review', changes_requested: 'Changes requested',
  approved: 'Approved', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent',
  paused: 'Paused', cancelled: 'Cancelled', failed: 'Failed',
};

function ukDate(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CampaignsTab({ onOpen }: { onOpen: (id: string | 'new') => void }) {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/campaigns');
      if (r.ok) setRows((await r.json()).campaigns ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    load();
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;

  if (rows.length === 0) {
    return (
      <div className="glass-solid rounded-2xl border border-[var(--border)] p-10 text-center max-w-lg mx-auto mt-6">
        <div className="w-12 h-12 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-4">
          <Mail size={22} style={{ color: 'var(--accent)' }} />
        </div>
        <h3 className="text-base font-semibold text-[var(--text-primary)]">No campaigns yet</h3>
        <p className="text-sm text-[var(--text-secondary)] mt-1 mb-4">Create your first campaign — a newsletter, a tax reminder, or a records request.</p>
        <button onClick={() => onOpen('new')} className="btn-primary mx-auto"><Plus size={15} /> New campaign</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => onOpen('new')} className="btn-primary"><Plus size={15} /> New campaign</button>
      </div>
      <div className="glass-solid rounded-2xl border border-[var(--border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)] border-b border-black/5">
              <th className="px-4 py-2.5 font-semibold">Campaign</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold text-right">Sent</th>
              <th className="px-4 py-2.5 font-semibold text-right">Opened</th>
              <th className="px-4 py-2.5 font-semibold">Date</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {rows.map(c => (
              <tr key={c.id} className="hover:bg-black/[0.015]">
                <td className="px-4 py-3">
                  <button onClick={() => onOpen(c.id)} className="text-left">
                    <div className="font-medium text-[var(--text-primary)]">{c.name}</div>
                    <div className="text-xs text-[var(--text-secondary)] truncate max-w-[320px]">{c.subject || 'No subject yet'}</div>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLE[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{c.stats?.sent ?? '—'}</td>
                <td className="px-4 py-3 text-right text-[var(--text-secondary)]">{c.stats?.opened ?? '—'}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{ukDate(c.sent_at ?? c.scheduled_at ?? c.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onOpen(c.id)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent)]" aria-label={c.status === 'sent' ? 'View' : 'Edit'}>
                      {c.status === 'sent' ? <Send size={14} /> : <Pencil size={14} />}
                    </button>
                    <button onClick={() => remove(c.id)} className="p-1.5 text-[var(--text-muted)] hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
