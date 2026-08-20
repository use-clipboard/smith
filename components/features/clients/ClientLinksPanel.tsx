'use client';

/**
 * ClientLinksPanel — the "Linked Clients" panel for the client Overview: lists
 * linked clients with direction-aware relationship labels (e.g. the individual's
 * page reads "Director of", the company's page reads "Director is"), with an
 * org-chart-style Add / Edit lightbox (two entity nodes + a directional arrow +
 * a Swap button), an org-chart view, and per-link removal. Self-contained
 * (fetches /api/clients/[id]/links) so it works wherever it's dropped.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Plus, Network, X, Pencil, ArrowDown, ArrowUpDown } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Tooltip from '@/components/ui/Tooltip';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import LinkGraphLightbox from '@/components/features/clients/LinkGraphLightbox';
import { EntityCard, type EntityCardData } from '@/components/features/clients/entityVisuals';
import {
  LINK_TYPE_OPTIONS, LINK_TYPE_META,
  linkForwardLabel, linkLabelForDirection, shouldSwapForOrientation,
  type LinkDirection,
} from '@/lib/clientLinks';

interface LinkedClient {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
  status: string | null;
}

interface ClientLink {
  id: string;
  link_type: string;
  notes: string | null;
  direction: LinkDirection;
  other_client: LinkedClient | null;
}

interface CurrentClient {
  name: string;
  client_ref: string | null;
  business_type: string | null;
}

interface PickedClient {
  id: string;
  name: string;
  client_ref: string | null;
  business_type: string | null;
}

/**
 * The stacked two-node relationship diagram used by both the Add and Edit
 * lightboxes. `subject` sits on top, `object` on the bottom, with a coloured
 * arrow (labelled with the forward reading of `linkType`) pointing down.
 */
function LinkDiagram({
  subject, object, linkType, onSwap, canSwap, otherSlot, onChooseOther,
}: {
  subject: EntityCardData | null;
  object: EntityCardData | null;
  linkType: string;
  onSwap: () => void;
  canSwap: boolean;
  /** Which node is the changeable "other" client (opens the search on click). */
  otherSlot?: 'subject' | 'object' | null;
  onChooseOther?: () => void;
}) {
  const color = LINK_TYPE_META[linkType as keyof typeof LINK_TYPE_META]?.color ?? '#6b7280';
  const label = linkForwardLabel(linkType);
  return (
    <div className="flex flex-col items-center w-full">
      <EntityCard data={subject} placeholder="Choose a client" onClick={otherSlot === 'subject' ? onChooseOther : undefined} />
      <div className="relative w-full" style={{ height: 66 }}>
        <div className="absolute left-1/2 top-0 bottom-2.5 w-[2px] -translate-x-1/2" style={{ background: color }} />
        <ArrowDown size={18} strokeWidth={3} className="absolute left-1/2 -translate-x-1/2 bottom-0" style={{ color }} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2">
          <span className="whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold text-white shadow" style={{ background: color }}>
            {label}
          </span>
          {canSwap && (
            <Tooltip label="Swap direction">
              <button
                type="button"
                onClick={onSwap}
                aria-label="Swap direction"
                className="p-1.5 rounded-full bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors"
              >
                <ArrowUpDown size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <EntityCard data={object} placeholder="Choose a client" onClick={otherSlot === 'object' ? onChooseOther : undefined} />
    </div>
  );
}

export default function ClientLinksPanel({
  clientId,
  currentClient,
}: {
  clientId: string;
  currentClient?: CurrentClient;
}) {
  const [links, setLinks] = useState<ClientLink[] | null>(null);
  const [showGraph, setShowGraph] = useState(false);

  // Add-link state
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<PickedClient | null>(null);
  const [linkType, setLinkType] = useState('director');
  const [reverse, setReverse] = useState(false);         // subject/object flipped?
  const [manualSwap, setManualSwap] = useState(false);   // user overrode auto-orient
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchOpenSignal, setSearchOpenSignal] = useState(0); // bump to open the picker

  // Edit-link state
  const [editLink, setEditLink] = useState<ClientLink | null>(null);
  const [editType, setEditType] = useState('director');
  const [editNotes, setEditNotes] = useState('');
  const [editReverse, setEditReverse] = useState(false); // flipped from stored direction?
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const currentData: EntityCardData | null = currentClient
    ? { name: currentClient.name, client_ref: currentClient.client_ref, business_type: currentClient.business_type }
    : null;

  const fetchLinks = () => {
    fetch(`/api/clients/${clientId}/links`)
      .then(r => (r.ok ? r.json() : { links: [] }))
      .then(d => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  };
  useEffect(() => {
    fetchLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Auto-orient the Add diagram into the natural direction as the type/other
  // client change — unless the user has manually swapped.
  useEffect(() => {
    if (manualSwap) return;
    setReverse(shouldSwapForOrientation(linkType, currentClient?.business_type ?? null, picked?.business_type ?? null));
  }, [linkType, picked, manualSwap, currentClient]);

  function resetAdd() {
    setShowAdd(false); setPicked(null); setNotes(''); setLinkType('director');
    setReverse(false); setManualSwap(false); setError(null);
  }

  async function addLink() {
    if (!picked) return;
    setAdding(true); setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_client_id: picked.id, link_type: linkType, notes: notes || undefined, reverse }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Could not add the link. Please try again.');
        return;
      }
      resetAdd();
      fetchLinks();
    } catch {
      setError('Could not add the link. Please try again.');
    } finally { setAdding(false); }
  }

  function startEdit(l: ClientLink) {
    setEditLink(l);
    setEditType(l.link_type);
    setEditNotes(l.notes ?? '');
    setEditReverse(false);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editLink) return;
    setEditSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/links/${editLink.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_type: editType, notes: editNotes || null, reverse: editReverse }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setEditError(d.error || 'Could not update the link.');
        return;
      }
      setEditLink(null);
      fetchLinks();
    } catch {
      setEditError('Could not update the link. Please try again.');
    } finally { setEditSaving(false); }
  }

  async function removeLink(id: string) {
    setLinks(prev => (prev ? prev.filter(l => l.id !== id) : prev));
    await fetch(`/api/clients/${clientId}/links/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  // ── Add diagram orientation ────────────────────────────────────────────────
  const pickedData: EntityCardData | null = picked
    ? { name: picked.name, client_ref: picked.client_ref, business_type: picked.business_type }
    : null;
  const addSubject = reverse ? pickedData : currentData;
  const addObject = reverse ? currentData : pickedData;

  // ── Edit diagram orientation ───────────────────────────────────────────────
  const editOther: EntityCardData | null = editLink?.other_client
    ? { name: editLink.other_client.name, client_ref: editLink.other_client.client_ref, business_type: editLink.other_client.business_type }
    : null;
  // stored: current client is subject when the link is outgoing.
  const storedCurrentIsSubject = editLink?.direction === 'outgoing';
  const displayedCurrentIsSubject = editReverse ? !storedCurrentIsSubject : storedCurrentIsSubject;
  const editSubject = displayedCurrentIsSubject ? currentData : editOther;
  const editObject = displayedCurrentIsSubject ? editOther : currentData;

  return (
    <div className="glass rounded-xl p-5 h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          Linked Clients{links && links.length > 0 ? ` (${links.length})` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {links && links.length > 0 && (
            <Tooltip label="Org chart">
              <button onClick={() => setShowGraph(true)} className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] px-2 py-1 rounded-lg hover:bg-[var(--accent-light)] transition-colors">
                <Network size={13} /> Org chart
              </button>
            </Tooltip>
          )}
          <button onClick={() => { setShowAdd(true); setError(null); }} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] px-2 py-1 rounded-lg hover:bg-[var(--accent-light)] transition-colors">
            <Plus size={13} /> Add Link
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mx-1 px-1">
        {links === null ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">Loading…</p>
        ) : links.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-8 gap-2 text-center">
            <Network size={20} className="text-[var(--text-muted)] opacity-40" />
            <p className="text-xs text-[var(--text-muted)]">No linked clients yet.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {links.map(l => l.other_client && (
              <li key={l.id} className="group rounded-xl border border-[var(--border-card)] bg-white/50 p-3 relative">
                <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => startEdit(l)} aria-label="Edit link" className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => void removeLink(l.id)} aria-label="Remove link" className="text-[var(--text-muted)] hover:text-red-600 transition-colors">
                    <X size={13} />
                  </button>
                </div>
                <div className="flex items-center gap-2.5">
                  <Avatar name={l.other_client.name} size={32} />
                  <Link href={`/clients/${l.other_client.id}`} className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate hover:text-[var(--accent)]">{l.other_client.name}</p>
                    {l.other_client.client_ref && <p className="text-xs text-[var(--text-muted)] truncate">{l.other_client.client_ref}</p>}
                  </Link>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)]">{linkLabelForDirection(l.link_type, l.direction)}</span>
                  {l.notes && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">{l.notes}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showGraph && <LinkGraphLightbox clientId={clientId} onClose={() => setShowGraph(false)} />}

      {/* Add Link lightbox */}
      {showAdd && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={resetAdd}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add a linked client</h3>
              <button onClick={resetAdd} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <ClientSearchInput
                value={picked?.id ?? ''}
                valueName={picked?.name}
                autoOpenSignal={searchOpenSignal}
                onChange={(id, name, clientRef, businessType) => {
                  if (!id) { setPicked(null); setError(null); return; }
                  if (id === clientId) { setError("Can't link a client to itself"); return; }
                  setError(null);
                  setPicked({ id, name, client_ref: clientRef || null, business_type: businessType ?? null });
                }}
                placeholder="Search for a client to link…"
              />
              <select
                value={linkType}
                onChange={e => setLinkType(e.target.value)}
                className="input-base w-full text-sm"
              >
                {LINK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              {/* Live relationship diagram */}
              <div className="rounded-xl border border-[var(--border-card)] bg-gray-50/60 px-4 py-4">
                <LinkDiagram
                  subject={addSubject}
                  object={addObject}
                  linkType={linkType}
                  canSwap={!!picked}
                  onSwap={() => { setManualSwap(true); setReverse(r => !r); }}
                  otherSlot={reverse ? 'subject' : 'object'}
                  onChooseOther={() => setSearchOpenSignal(s => s + 1)}
                />
              </div>

              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (e.g. ownership %)" className="input-base w-full text-sm" />
              {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={resetAdd} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => void addLink()} disabled={!picked || adding} className="btn-primary text-xs disabled:opacity-50">{adding ? 'Linking…' : 'Add Link'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Edit Link lightbox */}
      {editLink && editLink.other_client && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setEditLink(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate pr-2">Edit link to {editLink.other_client.name}</h3>
              <button onClick={() => setEditLink(null)} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors shrink-0">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <select value={editType} onChange={e => setEditType(e.target.value)} className="input-base w-full text-sm">
                {LINK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>

              <div className="rounded-xl border border-[var(--border-card)] bg-gray-50/60 px-4 py-4">
                <LinkDiagram
                  subject={editSubject}
                  object={editObject}
                  linkType={editType}
                  canSwap
                  onSwap={() => setEditReverse(r => !r)}
                />
              </div>

              <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Notes (e.g. ownership %)" className="input-base w-full text-sm" />
              {editError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{editError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditLink(null)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => void saveEdit()} disabled={editSaving} className="btn-primary text-xs disabled:opacity-50">{editSaving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
