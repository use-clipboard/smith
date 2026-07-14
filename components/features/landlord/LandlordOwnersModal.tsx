'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, Search, Loader2, AlertTriangle, Plus, Trash2, UserPlus, Link2, Copy } from 'lucide-react';
import type { LandlordProperty } from '@/types';

type ClientStatus = 'active' | 'hold' | 'inactive';
interface ClientHit { id: string; name: string; client_ref: string | null; status: ClientStatus }

// Matches the client status pill used elsewhere (Vault / Clients list).
const CLIENT_STATUS_STYLES: Record<ClientStatus, { dot: string; label: string; pill: string }> = {
  active:   { dot: 'bg-green-500', label: 'Active',   pill: 'bg-green-100 text-green-700' },
  hold:     { dot: 'bg-amber-500', label: 'On Hold',  pill: 'bg-amber-100 text-amber-700' },
  inactive: { dot: 'bg-gray-400',  label: 'Inactive', pill: 'bg-gray-100 text-gray-500'   },
};

function ClientStatusPill({ status }: { status: ClientStatus }) {
  const s = CLIENT_STATUS_STYLES[status] ?? CLIENT_STATUS_STYLES.active;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0 ${s.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

interface Props {
  property: LandlordProperty;
  /** Name of the primary landlord client (whose share is property.ownership_pct). */
  primaryName: string;
  onClose: () => void;
  onChanged: () => void;
}

// Manage the owners of a property: the primary landlord's share (stored on the
// property row) plus additional owners, each of which may be a linked client
// (bridge to self-assessment) or a plain named individual.
export default function LandlordOwnersModal({ property, primaryName, onClose, onChanged }: Props) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-owner form
  const [mode, setMode]         = useState<'client' | 'named'>('client');
  const [search, setSearch]     = useState('');
  const [hits, setHits]         = useState<ClientHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked]     = useState<ClientHit | null>(null);
  const [namedName, setNamedName] = useState('');
  const [draftShare, setDraftShare] = useState(50);

  // Apply-this-split-to-every-property
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [appliedMsg, setAppliedMsg]     = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // Client search (debounced).
  useEffect(() => {
    if (mode !== 'client') return;
    const q = search.trim();
    if (!q) { setHits([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/clients?search=${encodeURIComponent(q)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (cancelled || !d) return;
          const list = (Array.isArray(d) ? d : d.clients ?? []) as Array<{ id: string; name: string; client_ref: string | null; status?: ClientStatus }>;
          setHits(list.filter(c => c.id !== property.client_id).slice(0, 25).map(c => ({
            id: c.id, name: c.name, client_ref: c.client_ref ?? null, status: c.status ?? 'active',
          })));
        })
        .catch(() => {/* ignore */})
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, mode, property.client_id]);

  const totalShare = property.ownership_pct + property.owners.reduce((a, o) => a + o.share_pct, 0);
  const overShare  = totalShare > 100.01;
  // Jointly-owned property between spouses is split 50/50 by default; a different
  // split needs a Form 17 election. Flag when there are co-owners not on equal shares.
  const shares = [property.ownership_pct, ...property.owners.map(o => o.share_pct)];
  const nonEqualSplit = property.owners.length > 0 && !shares.every(s => Math.abs(s - shares[0]) < 0.01);

  async function patchPrimaryShare(pct: number) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/properties?id=${property.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownership_pct: Math.max(0, Math.min(100, pct)) }),
      });
      if (!res.ok) throw new Error('Failed to update share');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update'); }
    finally { setBusy(false); }
  }

  async function addOwner() {
    const share = Math.max(0.01, Math.min(100, draftShare));
    const payload = mode === 'client'
      ? (picked ? { property_id: property.id, owner_client_id: picked.id, owner_name: picked.name, share_pct: share } : null)
      : (namedName.trim() ? { property_id: property.id, owner_client_id: null, owner_name: namedName.trim(), share_pct: share } : null);
    if (!payload) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/landlord/property-owners', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Failed to add owner'); }
      setPicked(null); setNamedName(''); setSearch(''); setHits([]); setDraftShare(50);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to add owner'); }
    finally { setBusy(false); }
  }

  async function patchOwnerShare(id: string, pct: number) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/landlord/property-owners?id=${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_pct: Math.max(0, Math.min(100, pct)) }),
      });
      if (!res.ok) throw new Error('Failed to update share');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update'); }
    finally { setBusy(false); }
  }

  // Copy this property's split (primary share + every owner) onto all the
  // client's other properties — replaces their owners.
  async function applyToAll() {
    setBusy(true); setError(null); setAppliedMsg('');
    try {
      const res = await fetch('/api/landlord/property-owners/apply-to-all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: property.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed to apply');
      setApplyConfirm(false);
      setAppliedMsg(d.applied > 0
        ? `Applied to ${d.applied} other propert${d.applied === 1 ? 'y' : 'ies'}`
        : 'No other properties to apply to');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to apply'); }
    finally { setBusy(false); }
  }

  async function removeOwner(id: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/landlord/property-owners?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove');
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to remove'); }
    finally { setBusy(false); }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={!busy ? onClose : undefined}>
      <div className="bg-[var(--bg-card-solid)] rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-[var(--border)]" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">Property owners</h3>
            <p className="text-xs text-[var(--text-muted)] truncate">{property.address}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-50">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="text-[11px] uppercase font-semibold tracking-wide text-[var(--text-muted)]">Ownership</div>
          <div className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)]">
            {/* Primary */}
            <div className="flex items-center px-3 py-2 text-sm gap-2">
              <span className="flex-1 min-w-0 text-[var(--text-primary)] font-medium truncate">{primaryName || 'This client'} <span className="text-xs text-[var(--text-muted)] font-normal">(primary)</span></span>
              <input
                type="number" min={0} max={100} step={1}
                defaultValue={property.ownership_pct}
                onBlur={e => { const v = Number(e.target.value) || 0; if (v !== property.ownership_pct) void patchPrimaryShare(v); }}
                disabled={busy}
                className="w-16 px-2 py-1 text-sm text-right border border-[var(--border-input)] rounded bg-transparent"
                aria-label="Primary owner share %"
              />
              <span className="text-xs text-[var(--text-muted)]">%</span>
              <span className="w-7" />
            </div>
            {/* Additional owners */}
            {property.owners.map(o => (
              <div key={o.id} className="flex items-center px-3 py-2 text-sm gap-2">
                <span className="flex-1 min-w-0">
                  <span className="text-[var(--text-primary)] truncate">{o.owner_name}</span>
                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${o.owner_client_id ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                    {o.owner_client_id ? 'Client' : 'Named'}
                  </span>
                </span>
                <input
                  type="number" min={0} max={100} step={1}
                  defaultValue={o.share_pct}
                  onBlur={e => { const v = Number(e.target.value) || 0; if (v !== o.share_pct) void patchOwnerShare(o.id, v); }}
                  disabled={busy}
                  className="w-16 px-2 py-1 text-sm text-right border border-[var(--border-input)] rounded bg-transparent"
                  aria-label={`${o.owner_name} share %`}
                />
                <span className="text-xs text-[var(--text-muted)]">%</span>
                <button onClick={() => void removeOwner(o.id)} disabled={busy} className="p-1 rounded text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50" aria-label={`Remove ${o.owner_name}`}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div className={`flex items-center px-3 py-2 text-sm ${overShare ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--text-secondary)]'}`}>
              <span className="flex-1 font-medium">Total accounted for</span>
              <span className="tabular-nums font-semibold mr-9">{totalShare.toFixed(2)}%</span>
            </div>
          </div>
          {overShare && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> Total exceeds 100% — check the shares.
            </div>
          )}
          {nonEqualSplit && (
            <div className="flex items-start gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800 rounded-lg text-xs text-indigo-800 dark:text-indigo-300">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> Jointly-owned property between spouses or civil partners is split 50/50 by default. A different split requires a <strong className="font-semibold">&nbsp;Form 17&nbsp;</strong> election to HMRC.
            </div>
          )}

          {/* Apply this split to the rest of the portfolio */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {applyConfirm ? (
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-[var(--text-secondary)]">Overwrite the owners on every other property?</span>
                <button onClick={() => void applyToAll()} disabled={busy} className="btn-primary text-xs py-1 px-2.5 disabled:opacity-50">
                  {busy ? <Loader2 size={11} className="animate-spin" /> : null} Yes, apply
                </button>
                <button onClick={() => setApplyConfirm(false)} disabled={busy} className="btn-secondary text-xs py-1 px-2.5">Cancel</button>
              </div>
            ) : (
              <button onClick={() => { setAppliedMsg(''); setApplyConfirm(true); }} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-50">
                <Copy size={12} /> Apply this split to all properties
              </button>
            )}
            {appliedMsg && <span className="text-xs text-emerald-600">{appliedMsg}</span>}
          </div>

          {/* Add owner */}
          <div className="pt-1">
            <div className="text-[11px] uppercase font-semibold tracking-wide text-[var(--text-muted)] mb-2">Add owner</div>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setMode('client')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'client' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}><Link2 size={12} /> Link a client</button>
              <button onClick={() => setMode('named')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${mode === 'named' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}><UserPlus size={12} /> Named individual</button>
            </div>

            <div className="flex items-center gap-2 mb-2">
              {mode === 'client' ? (
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input value={picked ? picked.name : search} onChange={e => { setPicked(null); setSearch(e.target.value); }} placeholder="Search clients…" className="w-full pl-7 pr-2 py-1.5 text-sm input-base" />
                </div>
              ) : (
                <input value={namedName} onChange={e => setNamedName(e.target.value)} placeholder="Full name" className="flex-1 py-1.5 text-sm input-base" />
              )}
              <input type="number" min={0.01} max={100} step={1} value={draftShare} onChange={e => setDraftShare(Number(e.target.value))} className="w-16 px-2 py-1.5 text-sm text-right input-base" aria-label="Share %" />
              <span className="text-xs text-[var(--text-muted)]">%</span>
              <button onClick={() => void addOwner()} disabled={busy || (mode === 'client' ? !picked : !namedName.trim())} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
              </button>
            </div>

            {mode === 'client' && !picked && search.trim() && (
              <div className="border border-[var(--border)] rounded-lg max-h-44 overflow-y-auto">
                {searching ? (
                  <div className="py-5 text-center text-xs text-[var(--text-muted)]"><Loader2 size={12} className="inline animate-spin mr-1.5" /> Searching…</div>
                ) : hits.length === 0 ? (
                  <div className="py-5 text-center text-xs text-[var(--text-muted)]">No matching clients.</div>
                ) : hits.map(c => (
                  <button key={c.id} type="button" onClick={() => { setPicked(c); setSearch(c.name); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-nav-hover)]">
                    <span className="flex-1 truncate text-[var(--text-primary)]">{c.name}</span>
                    <ClientStatusPill status={c.status} />
                    {c.client_ref && <span className="text-[11px] text-[var(--text-muted)] font-mono">{c.client_ref}</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[var(--text-muted)] mt-2 leading-snug">
              Linking a client lets their share flow into the future self-assessment tool. Named individuals are stored as a note until you link them to a client.
            </p>
          </div>

          {error && (
            <div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-800 px-3 py-2 rounded-lg flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end">
          <button onClick={onClose} className="btn-secondary text-sm">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
