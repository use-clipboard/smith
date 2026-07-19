'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Workflow, Pencil, Trash2, Play, Pause, Info } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import type { CampaignAutomation, CampaignAudience } from '@/types/campaigns';
import { TRIGGER_BY_TYPE } from '@/lib/campaigns/triggerMeta';
import AutomationEditorModal from './AutomationEditorModal';

function ukDateTime(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AutomationsTab() {
  const [rows, setRows] = useState<CampaignAutomation[]>([]);
  const [audiences, setAudiences] = useState<CampaignAudience[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CampaignAutomation | null | 'new'>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, audRes] = await Promise.all([fetch('/api/campaigns/automations'), fetch('/api/campaigns/audiences')]);
      if (aRes.ok) setRows((await aRes.json()).automations ?? []);
      if (audRes.ok) setAudiences((await audRes.json()).audiences ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(a: CampaignAutomation) {
    await fetch(`/api/campaigns/automations/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: a.status === 'active' ? 'paused' : 'active' }),
    });
    load();
  }
  async function remove(id: string) {
    if (!confirm('Delete this automation?')) return;
    await fetch(`/api/campaigns/automations/${id}`, { method: 'DELETE' });
    load();
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;

  return (
    <div>
      <div className="flex items-start justify-between mb-4 gap-3">
        <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
          Automations send an email on their own when something happens in your practice — a year end nearing,
          an invoice going overdue, or on a set schedule. New automations start <strong>paused</strong>; switch one on
          when you’re happy with it.
        </p>
        <button onClick={() => setEditing('new')} className="btn-primary shrink-0"><Plus size={15} /> New automation</button>
      </div>

      {rows.length === 0 ? (
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-10 text-center max-w-lg mx-auto mt-6">
          <div className="w-12 h-12 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-4">
            <Workflow size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">No automations yet</h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1 mb-4">Set up a recurring newsletter, or an automatic year-end records reminder.</p>
          <button onClick={() => setEditing('new')} className="btn-primary mx-auto"><Plus size={15} /> New automation</button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(a => {
            const meta = TRIGGER_BY_TYPE[a.trigger_type];
            const active = a.status === 'active';
            return (
              <div key={a.id} className="glass-solid rounded-2xl border border-[var(--border)] p-4 flex items-center gap-4">
                <button onClick={() => toggle(a)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-green-100 text-green-600' : 'bg-black/5 text-[var(--text-muted)]'}`}
                  aria-label={active ? 'Pause' : 'Activate'}>
                  {active ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{a.name}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{active ? 'Active' : 'Paused'}</span>
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {meta?.label ?? a.trigger_type}
                    {a.trigger_type === 'recurring' && a.next_run_at && ` · next ${ukDateTime(a.next_run_at)}`}
                    {a.last_run_at && ` · last ran ${ukDateTime(a.last_run_at)}`}
                  </div>
                </div>
                <button onClick={() => setEditing(a)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                <button onClick={() => remove(a.id)} className="p-1.5 text-[var(--text-muted)] hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2 mt-5 text-xs text-[var(--text-muted)] max-w-2xl">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>Active automations send automatically from your connected Gmail. Each firing is saved as a campaign, so you can see opens and clicks in Reports. Multi-step journeys (wait, then follow up) and per-send approval are coming in a later phase.</span>
      </div>

      {editing && (
        <AutomationEditorModal
          automation={editing === 'new' ? null : editing}
          audiences={audiences}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
