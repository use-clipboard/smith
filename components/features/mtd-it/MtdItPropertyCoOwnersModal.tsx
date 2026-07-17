'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, Search, Loader2, AlertTriangle, Plus, Check, Trash2, Copy } from 'lucide-react';
import type { MtdItProperty } from '@/types';

interface Client {
  id:          string;
  name:        string;
  client_ref:  string | null;
}

interface Props {
  property: MtdItProperty;
  onClose: () => void;
  onChanged?: () => void;
}

/** What applying this property's split to the rest of the portfolio would do.
 *  From GET /api/mtd-it/properties/[id]/apply-to-all. */
interface ApplyPlan {
  target_count: number;
  overwrites: Array<{ address: string; owners: string[] }>;
}

// Lists existing co-owners on a property + lets the user add another MTD IT
// client (with their share %) or remove an existing one. The bidirectional
// link bookkeeping (matching property row on the other client, reverse link)
// happens server-side in /api/mtd-it/properties/[id]/links.
export default function MtdItPropertyCoOwnersModal({ property, onClose, onChanged }: Props) {
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [search,     setSearch]     = useState('');
  const [adding,     setAdding]     = useState<string | null>(null);
  const [draftShare, setDraftShare] = useState(50);
  const [busy,       setBusy]       = useState(false);

  // Apply-this-split-to-all. `applyPlan` is fetched when the confirm opens so
  // we can say what would be overwritten rather than asking "are you sure?"
  // about an unknown number of properties. null = still loading.
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [applyPlan,    setApplyPlan]    = useState<ApplyPlan | null>(null);
  const [appliedMsg,   setAppliedMsg]   = useState('');

  // Pull MTD IT clients on mount. Filter out the current client + anyone
  // already a co-owner so the picker only shows valid new candidates.
  useEffect(() => {
    void fetch('/api/mtd-it/clients?tax_year=2026')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(j => {
        setAllClients(((j.clients ?? []) as Array<{ id: string; name: string; client_ref: string | null }>)
          .map(c => ({ id: c.id, name: c.name, client_ref: c.client_ref })));
      })
      .catch(() => setError('Failed to load MTD IT clients'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const existingIds = new Set((property.co_owners ?? []).map(c => c.co_owner_client_id));
  const candidates  = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allClients
      .filter(c => c.id !== property.client_id)
      .filter(c => !existingIds.has(c.id))
      .filter(c => !q || c.name.toLowerCase().includes(q) || (c.client_ref ?? '').toLowerCase().includes(q))
      .slice(0, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClients, search, property.client_id, existingIds]);

  async function addCoOwner(coClientId: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/properties/${property.id}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ co_owner_client_id: coClientId, co_owner_share_pct: Math.max(0.01, Math.min(100, draftShare)) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Failed to add co-owner');
      onChanged?.();
      setAdding(null);
      setDraftShare(50);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add co-owner');
    } finally {
      setBusy(false);
    }
  }

  async function removeCoOwner(coClientId: string) {
    if (!confirm('Remove this co-owner link? The other client\'s property row will stay, you can delete it from there if needed.')) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/properties/${property.id}/links?co_owner_client_id=${coClientId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to remove');
      }
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  async function openApplyConfirm() {
    setAppliedMsg('');
    setApplyPlan(null);
    setApplyConfirm(true);
    try {
      const res = await fetch(`/api/mtd-it/properties/${property.id}/apply-to-all`);
      if (!res.ok) throw new Error('Could not work out what would change');
      const d = await res.json();
      setApplyPlan({ target_count: d.target_count ?? 0, overwrites: d.overwrites ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not work out what would change');
      setApplyConfirm(false);
    }
  }

  async function applyToAll() {
    setBusy(true); setError(null); setAppliedMsg('');
    try {
      const res = await fetch(`/api/mtd-it/properties/${property.id}/apply-to-all`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Failed to apply the split');
      setApplyConfirm(false);
      setApplyPlan(null);
      setAppliedMsg(d.applied > 0
        ? `Applied to ${d.applied} other propert${d.applied === 1 ? 'y' : 'ies'}`
        : 'No other properties to apply to');
      // Partial application is possible — e.g. a co-owner without MTD IT on.
      if (Array.isArray(d.failures) && d.failures.length > 0) {
        setError(`Some properties couldn't be updated: ${d.failures.join('; ')}`);
      }
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to apply the split');
    } finally {
      setBusy(false);
    }
  }

  const coOwners   = property.co_owners ?? [];
  const totalShare = property.ownership_pct + coOwners.reduce((a, c) => a + c.co_owner_share_pct, 0);
  const overShare  = totalShare > 100.01; // a touch of float wiggle room
  // Compare only the people who actually hold a share.
  const shares = [property.ownership_pct, ...coOwners.map(c => c.co_owner_share_pct)].filter(s => s > 0);
  const nonEqualSplit = shares.length > 1 && !shares.every(s => Math.abs(s - shares[0]) < 0.01);

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={!busy ? onClose : undefined}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Property co-owners</h3>
            <p className="text-xs text-gray-500 truncate">{property.address}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Ownership snapshot */}
          <div className="text-[11px] uppercase font-semibold tracking-wide text-gray-500">Ownership</div>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            <div className="flex items-center px-3 py-2 text-sm">
              <span className="flex-1 text-gray-900 font-medium">This client</span>
              <span className="tabular-nums text-gray-700">{property.ownership_pct}%</span>
            </div>
            {(property.co_owners ?? []).map(c => (
              <div key={c.co_owner_client_id} className="flex items-center px-3 py-2 text-sm">
                <span className="flex-1 min-w-0">
                  <span className="text-gray-900 truncate">{c.co_owner_name}</span>
                  {c.co_owner_ref && <span className="text-xs text-gray-500 ml-1.5">· {c.co_owner_ref}</span>}
                </span>
                <span className="tabular-nums text-gray-700 mr-2">{c.co_owner_share_pct}%</span>
                <button
                  onClick={() => void removeCoOwner(c.co_owner_client_id)}
                  disabled={busy}
                  className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                  aria-label={`Remove ${c.co_owner_name}`}
                ><Trash2 size={12} /></button>
              </div>
            ))}
            <div className={`flex items-center px-3 py-2 text-sm ${overShare ? 'text-amber-700' : 'text-gray-600'}`}>
              <span className="flex-1 font-medium">Total accounted for</span>
              <span className="tabular-nums font-semibold">{totalShare.toFixed(2)}%</span>
            </div>
          </div>
          {overShare && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              Total exceeds 100%. Check the shares — one of the owners is probably over.
            </div>
          )}

          {/* Jointly-owned property between spouses is 50/50 by default; a
              different split needs a Form 17 election. Same warning the Landlord
              tool shows — easy to trip over when applying a split in bulk. */}
          {nonEqualSplit && (
            <div className="flex items-start gap-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-800">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                Jointly-owned property between spouses or civil partners is split 50/50 by default.
                A different split requires a <strong className="font-semibold">Form 17</strong> election to HMRC.
              </span>
            </div>
          )}

          {/* Apply this split across the portfolio. The common case is a couple
              holding everything 50:50 — set it up once here rather than on
              every property. Mirrors the Landlord tool's owners modal. */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {applyConfirm ? (
              <div className="flex-1 min-w-0 space-y-2">
                <div className="text-xs text-gray-700">
                  {applyPlan === null ? (
                    <span className="inline-flex items-center gap-1.5 text-gray-500">
                      <Loader2 size={11} className="animate-spin" /> Checking what would change…
                    </span>
                  ) : applyPlan.target_count === 0 ? (
                    <>This client has no other {property.property_type === 'uk' ? 'UK' : 'foreign'} properties to apply to.</>
                  ) : (
                    <>
                      Apply this split to <strong>{applyPlan.target_count}</strong> other{' '}
                      {property.property_type === 'uk' ? 'UK' : 'foreign'} propert{applyPlan.target_count === 1 ? 'y' : 'ies'}?
                      {applyPlan.overwrites.length > 0 && (
                        <span className="block mt-1 text-amber-800">
                          {applyPlan.overwrites.length} of them {applyPlan.overwrites.length === 1 ? 'has' : 'have'} a different split
                          that will be overwritten:{' '}
                          {applyPlan.overwrites.slice(0, 4).map(o =>
                            `${o.address}${o.owners.length ? ` (${o.owners.join(', ')})` : ' (no co-owners)'}`,
                          ).join('; ')}
                          {applyPlan.overwrites.length > 4 && ` and ${applyPlan.overwrites.length - 4} more`}.
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void applyToAll()}
                    disabled={busy || applyPlan === null || applyPlan.target_count === 0}
                    className="btn-primary inline-flex items-center gap-1.5 text-xs py-1 px-2.5 disabled:opacity-50"
                  >
                    {busy && <Loader2 size={11} className="animate-spin" />} Yes, apply
                  </button>
                  <button
                    onClick={() => { setApplyConfirm(false); setApplyPlan(null); }}
                    disabled={busy}
                    className="text-xs py-1 px-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700 disabled:opacity-50"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => void openApplyConfirm()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
              >
                <Copy size={12} /> Apply this split to all properties
              </button>
            )}
            {appliedMsg && <span className="text-xs text-emerald-600">{appliedMsg}</span>}
          </div>

          {/* Add co-owner */}
          <div className="pt-2">
            <div className="text-[11px] uppercase font-semibold tracking-wide text-gray-500 mb-2">Add co-owner</div>
            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search MTD IT clients…"
                  className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <input
                type="number"
                min={0.01} max={100} step={0.5}
                value={draftShare}
                onChange={e => setDraftShare(Number(e.target.value))}
                className="w-16 px-2 py-1.5 text-sm text-right border border-gray-200 rounded-lg"
                aria-label="Their share %"
              />
              <span className="text-xs text-gray-500">%</span>
            </div>

            <div className="border border-gray-100 rounded-lg max-h-48 overflow-y-auto">
              {loading ? (
                <div className="py-6 text-center text-xs text-gray-500">
                  <Loader2 size={12} className="inline animate-spin mr-1.5" /> Loading…
                </div>
              ) : candidates.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-500">No matching MTD IT clients.</div>
              ) : (
                candidates.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => { setAdding(c.id); void addCoOwner(c.id); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    {adding === c.id ? <Loader2 size={12} className="animate-spin text-[var(--accent)]" /> : <Plus size={12} className="text-gray-400" />}
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.client_ref && <span className="text-[11px] text-gray-500">{c.client_ref}</span>}
                    {adding === c.id && <Check size={12} className="text-green-600" />}
                  </button>
                ))
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-2 leading-snug">
              When you add a co-owner we&apos;ll automatically create a matching property row on their MTD IT setup at the same address (with their {draftShare || '?'}% share), and link the two together.
            </p>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
