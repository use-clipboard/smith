'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, House, Globe2, Loader2, AlertTriangle, Users } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import PropertyUseTypeSelect, { type PropertyUseType } from '@/components/ui/PropertyUseTypeSelect';
import { currencyOptionsIncluding } from '@/lib/mtdIt/currencyCodes';
import { COUNTRY_OPTIONS, canonicalCountryName } from '@/lib/mtdIt/countryCodes';
import MtdItPropertyCoOwnersModal from './MtdItPropertyCoOwnersModal';
import type { MtdItProperty } from '@/types';

interface Props {
  clientId: string;
  /** When set, filter to just UK or foreign properties — leave undefined to show both */
  filter?: 'uk' | 'foreign';
  onChange?: (props: MtdItProperty[]) => void;
}

type UseType = PropertyUseType;

export default function MtdItPropertiesEditor({ clientId, filter, onChange }: Props) {
  const [items, setItems]     = useState<MtdItProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [adding,  setAdding]  = useState<'uk' | 'foreign' | null>(null);
  const [coOwnersOpen, setCoOwnersOpen] = useState<MtdItProperty | null>(null);

  // Draft inputs for the add row
  const [draftAddress, setDraftAddress]   = useState('');
  const [draftCountry, setDraftCountry]   = useState('');
  const [draftCurrency, setDraftCurrency] = useState('GBP');
  const [draftPct,     setDraftPct]       = useState(100);
  const [draftUseType, setDraftUseType]   = useState<UseType>(null);

  /** Returns the freshly-loaded list so callers can act on it without reading
   *  `items` out of a stale closure. */
  async function refresh(): Promise<MtdItProperty[]> {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/properties?client_id=${clientId}`);
      if (!res.ok) throw new Error('Failed to load properties');
      const data = await res.json();
      const list = (data.properties ?? []) as MtdItProperty[];
      setItems(list);
      onChange?.(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load properties');
      return [];
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  const visible = filter ? items.filter(p => p.property_type === filter) : items;

  async function addProperty(type: 'uk' | 'foreign') {
    if (!draftAddress.trim()) return;
    setBusyId('__add__');
    try {
      const res = await fetch('/api/mtd-it/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id:     clientId,
          address:       draftAddress.trim(),
          country:       type === 'foreign' ? (draftCountry.trim() || null) : null,
          currency:      type === 'foreign' ? (draftCurrency.toUpperCase() || 'EUR') : 'GBP',
          ownership_pct: Math.max(0, Math.min(100, draftPct)),
          property_type: type,
          use_type: draftUseType,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to add property');
      }
      setDraftAddress(''); setDraftCountry(''); setDraftCurrency(type === 'foreign' ? 'EUR' : 'GBP'); setDraftPct(100); setDraftUseType(null); setAdding(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add property');
    } finally {
      setBusyId(null);
    }
  }

  async function patchProperty(id: string, patch: Partial<MtdItProperty>) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/mtd-it/properties?id=${id}`, {
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

  async function removeProperty(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/mtd-it/properties?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading properties…</div>;

  return (
    <div className="space-y-2">
      {visible.length === 0 && (
        <p className="text-xs text-gray-500 italic">No properties yet — add one to tag rental rows against.</p>
      )}

      {visible.map(p => (
        <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-sm">
          {p.property_type === 'uk' ? <House size={14} className="text-gray-500 shrink-0" /> : <Globe2 size={14} className="text-gray-500 shrink-0" />}
          <input
            defaultValue={p.address}
            onBlur={e => { if (e.target.value !== p.address) void patchProperty(p.id, { address: e.target.value }); }}
            className="flex-1 min-w-0 px-1.5 py-0.5 text-sm bg-transparent border border-transparent rounded hover:border-gray-200 focus:outline-none focus:border-gray-300"
          />
          <PropertyUseTypeSelect
            value={p.use_type ?? null}
            disabled={busyId === p.id}
            onChange={v => { if (v !== (p.use_type ?? null)) void patchProperty(p.id, { use_type: v }); }}
          />
          {p.property_type === 'foreign' && (
            <>
              <select
                value={canonicalCountryName(p.country)}
                aria-label="Country"
                onChange={e => { const v = e.target.value || null; if (v !== p.country) void patchProperty(p.id, { country: v }); }}
                className="w-32 px-1.5 py-0.5 text-xs bg-transparent border border-transparent rounded hover:border-gray-200 focus:outline-none focus:border-gray-300"
              >
                <option value="">Country…</option>
                {COUNTRY_OPTIONS.map(o => <option key={o.code} value={o.name}>{o.name}</option>)}
              </select>
              <Tooltip label="Currency — used to pull the right HMRC exchange rate">
                <select
                  value={p.currency}
                  onChange={e => { if (e.target.value !== p.currency) void patchProperty(p.id, { currency: e.target.value }); }}
                  aria-label="Currency"
                  className="w-20 px-1.5 py-0.5 text-xs font-mono bg-transparent border border-transparent rounded hover:border-gray-200 focus:outline-none focus:border-gray-300"
                >
                  {currencyOptionsIncluding(p.currency).map(c => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
              </Tooltip>
            </>
          )}
          <Tooltip label="Ownership %">
            <input
              type="number"
              min={0} max={100} step={1}
              defaultValue={p.ownership_pct}
              onBlur={e => {
                const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                if (v !== p.ownership_pct) void patchProperty(p.id, { ownership_pct: v });
              }}
              className="w-14 px-1.5 py-0.5 text-xs text-right bg-transparent border border-transparent rounded hover:border-gray-200 focus:outline-none focus:border-gray-300"
              aria-label="Ownership %"
            />
          </Tooltip>
          <span className="text-[10px] text-gray-400">%</span>
          {/* Co-owners button — shows count if any are already linked. Husband/
              wife co-owned portfolios use this to share entries during the
              import-from-co-owner flow. */}
          <Tooltip label={(p.co_owners && p.co_owners.length > 0) ? `${p.co_owners.length} co-owner${p.co_owners.length !== 1 ? 's' : ''}` : 'Link a co-owner client (e.g. spouse)'}>
            <button
              onClick={() => setCoOwnersOpen(p)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${p.co_owners && p.co_owners.length > 0
                ? 'bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/30'
                : 'text-gray-400 hover:text-[var(--accent)] hover:bg-[var(--accent-light)]'}`}
              aria-label="Manage co-owners"
            >
              <Users size={11} />
              {p.co_owners && p.co_owners.length > 0 ? p.co_owners.length : ''}
            </button>
          </Tooltip>
          <Tooltip label="Remove property">
            <button
              onClick={() => removeProperty(p.id)}
              disabled={busyId === p.id}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
              aria-label="Remove property"
            >
              {busyId === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </Tooltip>
        </div>
      ))}

      {coOwnersOpen && (
        <MtdItPropertyCoOwnersModal
          property={coOwnersOpen}
          onClose={() => setCoOwnersOpen(null)}
          onChanged={() => { void refresh().then(list => {
            // Keep the modal in sync with the latest co-owner list after an
            // add/remove/apply-to-all. Re-find from the list refresh() just
            // returned — reading `items` here would be the pre-refresh array.
            setCoOwnersOpen(prev => prev ? (list.find(x => x.id === prev.id) ?? null) : prev);
          }); }}
        />
      )}

      {/* Add row */}
      {adding === filter || (adding && !filter) ? (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-purple-50 border border-purple-200 rounded-lg text-sm">
          {adding === 'uk' ? <House size={14} className="text-purple-700 shrink-0" /> : <Globe2 size={14} className="text-purple-700 shrink-0" />}
          <input
            value={draftAddress}
            onChange={e => setDraftAddress(e.target.value)}
            placeholder="Address"
            autoFocus
            className="flex-1 min-w-0 px-1.5 py-0.5 text-sm bg-white border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
          <PropertyUseTypeSelect value={draftUseType} onChange={setDraftUseType} />
          {adding === 'foreign' && (
            <>
              <select
                value={draftCountry}
                aria-label="Country"
                onChange={e => setDraftCountry(e.target.value)}
                className="w-32 px-1.5 py-0.5 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              >
                <option value="">Country…</option>
                {COUNTRY_OPTIONS.map(o => <option key={o.code} value={o.name}>{o.name}</option>)}
              </select>
              <select
                value={draftCurrency === 'GBP' ? 'EUR' : draftCurrency}
                onChange={e => setDraftCurrency(e.target.value)}
                aria-label="Currency"
                className="w-20 px-1.5 py-0.5 text-xs font-mono bg-white border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
              >
                {currencyOptionsIncluding(draftCurrency === 'GBP' ? 'EUR' : draftCurrency)
                  .filter(c => c.code !== 'GBP')
                  .map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </>
          )}
          <input
            type="number" min={0} max={100} step={1}
            value={draftPct}
            onChange={e => setDraftPct(Number(e.target.value))}
            className="w-14 px-1.5 py-0.5 text-xs text-right bg-white border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            aria-label="Ownership %"
          />
          <span className="text-[10px] text-gray-500">%</span>
          <button
            onClick={() => addProperty(adding!)}
            disabled={busyId === '__add__' || !draftAddress.trim()}
            className="px-2 py-1 text-xs bg-[var(--accent)] text-white rounded hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busyId === '__add__' && <Loader2 size={10} className="animate-spin" />}
            Add
          </button>
          <button onClick={() => setAdding(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </div>
      ) : (
        <div className="flex gap-2">
          {(filter === undefined || filter === 'uk') && (
            <button
              onClick={() => { setAdding('uk'); setDraftCurrency('GBP'); }}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-light)] rounded-lg"
            ><Plus size={12} /> Add UK property</button>
          )}
          {(filter === undefined || filter === 'foreign') && (
            <button
              onClick={() => { setAdding('foreign'); setDraftCurrency('EUR'); }}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-light)] rounded-lg"
            ><Plus size={12} /> Add foreign property</button>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>
      )}
    </div>
  );
}
