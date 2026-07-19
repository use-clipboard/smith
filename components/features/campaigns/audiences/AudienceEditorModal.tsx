'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { CampaignAudience, AudienceGroup, FieldOption } from '@/types/campaigns';
import AudienceBuilder from './AudienceBuilder';
import AudiencePreview from './AudiencePreview';
import { emptyGroup } from './builderUtils';

interface Props {
  audience?: CampaignAudience | null;
  team: FieldOption[];
  onClose: () => void;
  onSaved: () => void;
}

export default function AudienceEditorModal({ audience, team, onClose, onSaved }: Props) {
  const [name, setName] = useState(audience?.name ?? '');
  const [description, setDescription] = useState(audience?.description ?? '');
  const [definition, setDefinition] = useState<AudienceGroup>(() => {
    const d = audience?.definition;
    return d && typeof d === 'object' && 'children' in d ? (d as AudienceGroup) : emptyGroup('and');
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError('Give the audience a name.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { name: name.trim(), description, source: 'dynamic', definition };
      const url = audience ? `/api/campaigns/audiences/${audience.id}` : '/api/campaigns/audiences';
      const method = audience ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) { setError('Could not save the audience.'); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{audience ? 'Edit audience' : 'New audience'}</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. March year-end limited companies"
                  className="mt-1 w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Description (optional)</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  className="mt-1 w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] mb-2 block">Conditions</label>
              <AudienceBuilder value={definition} onChange={setDefinition} dynamicOptions={{ account_manager_id: team }} />
            </div>
          </div>

          <div className="lg:col-span-1">
            <AudiencePreview source="dynamic" definition={definition} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-black/5">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save audience'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
