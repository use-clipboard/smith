'use client';

/**
 * ClientLinksPanel — the "Linked Clients" panel for the client Overview: lists
 * linked clients (role + ownership from the link notes), with "+ Add Link", an
 * org-chart view, and per-link removal. Self-contained (fetches /api/clients/
 * [id]/links), so it works wherever it's dropped. Migrated from the old Details
 * tab so no connections are lost.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Plus, Network, X, Pencil } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import LinkGraphLightbox from '@/components/features/clients/LinkGraphLightbox';

interface ClientLink {
  id: string;
  link_type: string;
  notes: string | null;
  other_client: { id: string; name: string; client_ref: string | null; status: string | null } | null;
}

const LINK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'director',          label: 'Director of' },
  { value: 'shareholder',       label: 'Shareholder of' },
  { value: 'spouse_partner',    label: 'Spouse / Partner of' },
  { value: 'trustee',           label: 'Trustee of' },
  { value: 'beneficiary',       label: 'Beneficiary of' },
  { value: 'associated_company',label: 'Associated Company' },
  { value: 'parent_company',    label: 'Parent Company of' },
  { value: 'subsidiary',        label: 'Subsidiary of' },
  { value: 'guarantor',         label: 'Guarantor of' },
  { value: 'other',             label: 'Other / Associated' },
];
const LINK_TYPE_LABEL = (t: string) => LINK_TYPE_OPTIONS.find(o => o.value === t)?.label ?? t;

export default function ClientLinksPanel({ clientId }: { clientId: string }) {
  const [links, setLinks] = useState<ClientLink[] | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [linkType, setLinkType] = useState('director');
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Edit-link state
  const [editLink, setEditLink] = useState<ClientLink | null>(null);
  const [editType, setEditType] = useState('director');
  const [editNotes, setEditNotes] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const fetchLinks = () => {
    fetch(`/api/clients/${clientId}/links`)
      .then(r => (r.ok ? r.json() : { links: [] }))
      .then(d => setLinks(d.links ?? []))
      .catch(() => setLinks([]));
  };
  useEffect(() => { fetchLinks(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  async function addLink() {
    if (!picked) return;
    setAdding(true); setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_client_id: picked.id, link_type: linkType, notes: notes || undefined }),
      });
      if (!res.ok) throw new Error();
      setShowAdd(false); setPicked(null); setNotes(''); setLinkType('director');
      fetchLinks();
    } catch {
      setError('Could not add the link. Please try again.');
    } finally { setAdding(false); }
  }

  function startEdit(l: ClientLink) {
    setEditLink(l);
    setEditType(l.link_type);
    setEditNotes(l.notes ?? '');
    setEditError(null);
  }

  async function saveEdit() {
    if (!editLink) return;
    setEditSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/links/${editLink.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_type: editType, notes: editNotes || null }),
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

  return (
    <div className="glass rounded-xl p-5 h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          Linked Clients{links && links.length > 0 ? ` (${links.length})` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {links && links.length > 0 && (
            <button onClick={() => setShowGraph(true)} className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] px-2 py-1 rounded-lg hover:bg-[var(--accent-light)] transition-colors" title="Org chart">
              <Network size={13} /> Org chart
            </button>
          )}
          <button onClick={() => { setShowAdd(v => !v); setError(null); }} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] px-2 py-1 rounded-lg hover:bg-[var(--accent-light)] transition-colors">
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
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)]">{LINK_TYPE_LABEL(l.link_type)}</span>
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
          onClick={() => { setShowAdd(false); setPicked(null); setError(null); }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Add a linked client</h3>
              <button onClick={() => { setShowAdd(false); setPicked(null); setError(null); }} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <ClientSearchInput
                value={picked?.id ?? ''}
                valueName={picked?.name}
                onChange={(id, name) => {
                  if (!id) { setPicked(null); setError(null); return; }
                  if (id === clientId) { setError("Can't link a client to itself"); return; }
                  setError(null); setPicked({ id, name });
                }}
                placeholder="Search for a client to link…"
              />
              <select value={linkType} onChange={e => setLinkType(e.target.value)} className="input-base w-full text-sm">
                {LINK_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (e.g. ownership %)" className="input-base w-full text-sm" />
              {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setShowAdd(false); setPicked(null); setError(null); }} className="btn-ghost text-xs">Cancel</button>
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
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] p-5"
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
