'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Briefcase, Loader2, AlertTriangle } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import type { MtdItTrade } from '@/types';

interface Props {
  clientId: string;
  onChange?: (trades: MtdItTrade[]) => void;
}

export default function MtdItTradesEditor({ clientId, onChange }: Props) {
  const [items, setItems]     = useState<MtdItTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [adding,  setAdding]  = useState(false);
  const [draftName, setDraftName]               = useState('');
  const [draftDescription, setDraftDescription] = useState('');

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/trades?client_id=${clientId}`);
      if (!res.ok) throw new Error('Failed to load trades');
      const data = await res.json();
      const list = (data.trades ?? []) as MtdItTrade[];
      setItems(list);
      onChange?.(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  async function addTrade() {
    if (!draftName.trim()) return;
    setBusyId('__add__');
    try {
      const res = await fetch('/api/mtd-it/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, name: draftName.trim(), description: draftDescription.trim() || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to add trade');
      }
      setDraftName(''); setDraftDescription(''); setAdding(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add trade');
    } finally {
      setBusyId(null);
    }
  }

  async function patchTrade(id: string, patch: Partial<MtdItTrade>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/mtd-it/trades?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setBusyId(null);
    }
  }

  async function removeTrade(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/mtd-it/trades?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading trades…</div>;

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-xs text-gray-500 italic">No trades yet — add one to split sole-trader figures across multiple businesses.</p>
      )}

      {items.map(t => (
        <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm">
          <Briefcase size={14} className="text-gray-500 shrink-0" />
          <input
            defaultValue={t.name}
            onBlur={e => { if (e.target.value !== t.name && e.target.value.trim()) void patchTrade(t.id, { name: e.target.value }); }}
            className="flex-1 min-w-0 px-1.5 py-0.5 text-sm bg-transparent border border-transparent rounded hover:border-gray-200 focus:outline-none focus:border-gray-300"
          />
          <input
            defaultValue={t.description ?? ''}
            placeholder="Optional description"
            onBlur={e => { if ((e.target.value || null) !== t.description) void patchTrade(t.id, { description: e.target.value || null }); }}
            className="flex-[1.2] min-w-0 px-1.5 py-0.5 text-xs text-gray-500 bg-transparent border border-transparent rounded hover:border-gray-200 focus:outline-none focus:border-gray-300"
          />
          <Tooltip label="Remove trade">
            <button
              onClick={() => removeTrade(t.id)}
              disabled={busyId === t.id}
              aria-label="Remove trade"
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
            >
              {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </Tooltip>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-sm">
          <Briefcase size={14} className="text-purple-700 shrink-0" />
          <input
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            placeholder="Trade name"
            autoFocus
            className="flex-1 min-w-0 px-1.5 py-0.5 text-sm bg-white border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
          <input
            value={draftDescription}
            onChange={e => setDraftDescription(e.target.value)}
            placeholder="Optional description"
            className="flex-[1.2] min-w-0 px-1.5 py-0.5 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
          <button
            onClick={addTrade}
            disabled={busyId === '__add__' || !draftName.trim()}
            className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busyId === '__add__' && <Loader2 size={10} className="animate-spin" />}
            Add
          </button>
          <button onClick={() => setAdding(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-light)] rounded-lg"
        ><Plus size={12} /> Add trade</button>
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>
      )}
    </div>
  );
}
