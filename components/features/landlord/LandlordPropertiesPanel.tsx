'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, House, Loader2, AlertTriangle, Users, Building2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import LandlordOwnersModal from './LandlordOwnersModal';
import type { LandlordProperty } from '@/types';

interface Props {
  clientId: string;
  primaryName: string;
  properties: LandlordProperty[];
  loading: boolean;
  onRefetch: () => void;
  /** Hide Add/Remove when the caller owns the list — e.g. grouped mode, where
   *  there is exactly one combined property and adding more does nothing. */
  allowAdd?: boolean;
  /** Message for the empty state (defaults to the register wording). */
  emptyLabel?: string;
}

// Editor for a client's saved property register (shared with MTD IT). Each
// property carries the primary landlord's ownership % plus additional owners
// (clients or named individuals) managed via the owners modal.
export default function LandlordPropertiesPanel({
  clientId, primaryName, properties, loading, onRefetch, allowAdd = true, emptyLabel,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftAddress, setDraftAddress] = useState('');
  const [ownersFor, setOwnersFor] = useState<LandlordProperty | null>(null);

  // Keep the open owners modal in sync with the freshly-fetched property list.
  useEffect(() => {
    if (!ownersFor) return;
    const fresh = properties.find(p => p.id === ownersFor.id) ?? null;
    if (fresh && fresh !== ownersFor) setOwnersFor(fresh);
  }, [properties, ownersFor]);

  async function addProperty() {
    if (!draftAddress.trim()) return;
    setBusyId('__add__'); setError(null);
    try {
      const res = await fetch('/api/mtd-it/properties', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, address: draftAddress.trim(), ownership_pct: 100, property_type: 'uk' }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Failed to add property'); }
      setDraftAddress(''); setAdding(false);
      onRefetch();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add property'); }
    finally { setBusyId(null); }
  }

  async function patchAddress(id: string, address: string) {
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/properties?id=${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (!res.ok) throw new Error('Failed to update');
      onRefetch();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update'); }
    finally { setBusyId(null); }
  }

  async function removeProperty(id: string) {
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/properties?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove');
      onRefetch();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to remove'); }
    finally { setBusyId(null); }
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading properties…</div>
      ) : properties.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] italic">
          {emptyLabel ?? 'No saved properties for this client yet. Add one to allocate income & expenses to it.'}
        </p>
      ) : (
        properties.map(p => {
          const ownerCount = p.owners.length;
          const total = p.ownership_pct + p.owners.reduce((a, o) => a + o.share_pct, 0);
          return (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm">
              <House size={14} className="text-[var(--text-muted)] shrink-0" />
              <input
                defaultValue={p.address}
                onBlur={e => { if (e.target.value.trim() && e.target.value !== p.address) void patchAddress(p.id, e.target.value.trim()); }}
                className="flex-1 min-w-0 px-1.5 py-0.5 text-sm bg-transparent border border-transparent rounded hover:border-[var(--border)] focus:outline-none focus:border-[var(--border-input)]"
              />
              <Tooltip label="Manage owners & shares">
                <button
                  onClick={() => setOwnersFor(p)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${ownerCount > 0
                    ? 'bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)]'}`}
                >
                  <Users size={11} /> {ownerCount > 0 ? `${ownerCount + 1} owners` : `${p.ownership_pct}%`}
                </button>
              </Tooltip>
              {total > 100.01 && (
                <Tooltip label="Owner shares exceed 100%"><AlertTriangle size={13} className="text-amber-500 shrink-0" /></Tooltip>
              )}
              {allowAdd && (
                <Tooltip label="Remove property">
                  <button onClick={() => void removeProperty(p.id)} disabled={busyId === p.id} className="p-1 text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded disabled:opacity-50" aria-label="Remove property">
                    {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </Tooltip>
              )}
            </div>
          );
        })
      )}

      {!allowAdd ? null : adding ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded-lg text-sm">
          <Building2 size={14} className="text-[var(--accent)] shrink-0" />
          <input
            value={draftAddress}
            onChange={e => setDraftAddress(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void addProperty(); }}
            placeholder="Property address"
            autoFocus
            className="flex-1 min-w-0 input-base text-sm py-1"
          />
          <button onClick={() => void addProperty()} disabled={busyId === '__add__' || !draftAddress.trim()} className="btn-primary text-xs py-1 px-3 disabled:opacity-50">
            {busyId === '__add__' && <Loader2 size={10} className="animate-spin" />} Add
          </button>
          <button onClick={() => { setAdding(false); setDraftAddress(''); }} className="btn-secondary text-xs py-1 px-3">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:opacity-80 pt-1">
          <Plus size={13} /> Add property
        </button>
      )}

      {error && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}

      {ownersFor && (
        <LandlordOwnersModal
          property={ownersFor}
          primaryName={primaryName}
          onClose={() => setOwnersFor(null)}
          onChanged={() => { onRefetch(); }}
        />
      )}
    </div>
  );
}
