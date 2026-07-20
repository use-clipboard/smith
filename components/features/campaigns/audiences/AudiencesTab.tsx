'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Users, Pencil, Trash2, Send, FileSpreadsheet } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import type { CampaignAudience, FieldOption } from '@/types/campaigns';
import AudienceEditorModal from './AudienceEditorModal';
import ImportAudienceModal from './ImportAudienceModal';

const SOURCE_LABEL: Record<string, string> = {
  dynamic: 'Dynamic audience', static: 'Saved list', manual: 'Manual list', spreadsheet: 'Imported list',
};

export default function AudiencesTab({ onUseInCampaign }: { onUseInCampaign: (audienceId: string) => void }) {
  const [audiences, setAudiences] = useState<CampaignAudience[]>([]);
  const [team, setTeam] = useState<FieldOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<CampaignAudience | null | 'new'>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, mRes] = await Promise.all([fetch('/api/campaigns/audiences'), fetch('/api/campaigns/meta')]);
      if (aRes.ok) setAudiences((await aRes.json()).audiences ?? []);
      if (mRes.ok) {
        const m = await mRes.json();
        setTeam((m.team ?? []).map((t: { id: string; name: string }) => ({ value: t.id, label: t.name })));
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    if (!confirm('Delete this audience? Campaigns already sent are unaffected.')) return;
    await fetch(`/api/campaigns/audiences/${id}`, { method: 'DELETE' });
    load();
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
          Audiences are live segments built from your own client, compliance, task and billing data. A dynamic
          audience re-resolves every time you send — so “companies with a year end in 60 days” is always current.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setImporting(true)} className="btn-secondary"><FileSpreadsheet size={15} /> Import list</button>
          <button onClick={() => setEditing('new')} className="btn-primary"><Plus size={15} /> New audience</button>
        </div>
      </div>

      {audiences.length === 0 ? (
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-10 text-center max-w-lg mx-auto mt-6">
          <div className="w-12 h-12 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-4">
            <Users size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">No audiences yet</h3>
          <p className="text-sm text-[var(--text-secondary)] mt-1 mb-4">Build your first segment — say, all VAT-registered limited companies, or clients with an overdue task.</p>
          <button onClick={() => setEditing('new')} className="btn-primary mx-auto"><Plus size={15} /> New audience</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {audiences.map(a => (
            <div key={a.id} className="glass-solid rounded-2xl border border-[var(--border)] p-4 flex flex-col">
              <div className="flex items-start gap-2">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                  {a.source === 'spreadsheet' ? <FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} /> : <Users size={16} style={{ color: 'var(--accent)' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">{a.name}</div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">{a.description || SOURCE_LABEL[a.source] || 'Dynamic audience'}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 mt-4 pt-3 border-t border-black/5">
                <button onClick={() => onUseInCampaign(a.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline mr-auto">
                  <Send size={12} /> Use in campaign
                </button>
                {a.source === 'dynamic' && (
                  <button onClick={() => setEditing(a)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                )}
                <button onClick={() => remove(a.id)} className="p-1.5 text-[var(--text-muted)] hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <AudienceEditorModal
          audience={editing === 'new' ? null : editing}
          team={team}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {importing && (
        <ImportAudienceModal
          onClose={() => setImporting(false)}
          onSaved={() => { setImporting(false); load(); }}
        />
      )}
    </div>
  );
}
