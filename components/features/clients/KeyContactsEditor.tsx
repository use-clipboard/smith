'use client';

/**
 * KeyContactsEditor — used inside the client Edit modal to manage the client's
 * Key Contacts. Each contact is either typed in manually or linked to another
 * existing client (selecting one prefills name/email/phone from that client's
 * record, with linked_client_id kept for reference). Values stay editable after
 * linking so they can be overridden.
 */

import { useEffect, useState } from 'react';
import { Plus, X, Link2 } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import Avatar from '@/components/ui/Avatar';

export interface KeyContact {
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  linked_client_id?: string | null;
}

interface LinkedSuggestion { id: string; name: string; role: string | null }

export default function KeyContactsEditor({
  clientId, value, onChange,
}: {
  clientId?: string;
  value: KeyContact[];
  onChange: (next: KeyContact[]) => void;
}) {
  const [linkingIndex, setLinkingIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<LinkedSuggestion[]>([]);

  // Suggest the client's existing linked clients as one-click contacts.
  useEffect(() => {
    if (!clientId) return;
    let active = true;
    fetch(`/api/clients/${clientId}/links`)
      .then(r => (r.ok ? r.json() : { links: [] }))
      .then(d => {
        if (!active) return;
        const seen = new Set<string>();
        const list: LinkedSuggestion[] = [];
        for (const l of (d.links ?? [])) {
          const oc = l.other_client;
          if (!oc || seen.has(oc.id)) continue;
          seen.add(oc.id);
          list.push({ id: oc.id, name: oc.name, role: l.link_type ?? null });
        }
        setSuggestions(list);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [clientId]);

  const LINK_ROLE_LABEL: Record<string, string> = {
    director: 'Director', shareholder: 'Shareholder', spouse_partner: 'Spouse / Partner',
    trustee: 'Trustee', beneficiary: 'Beneficiary', associated_company: 'Associated Company',
    parent_company: 'Parent Company', subsidiary: 'Subsidiary', guarantor: 'Guarantor', other: 'Associated',
  };

  const update = (i: number, patch: Partial<KeyContact>) =>
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { name: '', role: '', email: '', phone: '', linked_client_id: null }]);

  async function linkClient(i: number, id: string, name: string, role?: string | null) {
    // Prefill name immediately, then pull the linked client's contact details.
    update(i, { name, linked_client_id: id, ...(role ? { role } : {}) });
    setLinkingIndex(null);
    try {
      const res = await fetch(`/api/clients/${id}`);
      if (!res.ok) return;
      const { client } = await res.json();
      onChange(value.map((c, idx) => idx === i ? {
        ...c,
        name: client?.name ?? name,
        email: client?.contact_email ?? c.email ?? '',
        phone: client?.contact_number ?? c.phone ?? '',
        linked_client_id: id,
      } : c));
    } catch { /* keep the name we already set */ }
  }

  // Quick-add a brand-new contact straight from a linked-client suggestion.
  async function addFromSuggestion(s: LinkedSuggestion) {
    const roleLabel = s.role ? (LINK_ROLE_LABEL[s.role] ?? s.role) : '';
    const next: KeyContact[] = [...value, { name: s.name, role: roleLabel, email: '', phone: '', linked_client_id: s.id }];
    onChange(next);
    try {
      const res = await fetch(`/api/clients/${s.id}`);
      if (!res.ok) return;
      const { client } = await res.json();
      onChange(next.map(c => c.linked_client_id === s.id
        ? { ...c, name: client?.name ?? c.name, email: client?.contact_email ?? '', phone: client?.contact_number ?? '' }
        : c));
    } catch { /* keep what we set */ }
  }

  // Linked clients not already added as a contact.
  const availableSuggestions = suggestions.filter(s => !value.some(c => c.linked_client_id === s.id));

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">No key contacts yet — add a contact or link an existing client.</p>
      )}

      {value.map((c, i) => (
        <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-page)] p-3 space-y-2 relative">
          <button type="button" onClick={() => remove(i)} aria-label="Remove contact"
            className="absolute top-2 right-2 text-[var(--text-muted)] hover:text-red-600 transition-colors">
            <X size={14} />
          </button>

          {c.linked_client_id && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)]">
              <Link2 size={10} /> Linked client
            </span>
          )}

          {linkingIndex === i ? (
            <div className="space-y-1.5">
              <ClientSearchInput value="" onChange={(id, name) => { if (id) void linkClient(i, id, name); }} placeholder="Search a client to link…" />
              {availableSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {availableSuggestions.map(s => (
                    <button key={s.id} type="button" onClick={() => void linkClient(i, s.id, s.name, s.role ? (LINK_ROLE_LABEL[s.role] ?? s.role) : null)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border border-[var(--border)] bg-white hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                      <Link2 size={10} /> {s.name}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setLinkingIndex(null)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel link</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input value={c.name} onChange={e => update(i, { name: e.target.value })} placeholder="Name *" className="input-base w-full text-sm" />
              <input value={c.role ?? ''} onChange={e => update(i, { role: e.target.value })} placeholder="Role (e.g. Director)" className="input-base w-full text-sm" />
              <input value={c.email ?? ''} onChange={e => update(i, { email: e.target.value })} placeholder="Email" className="input-base w-full text-sm" />
              <input value={c.phone ?? ''} onChange={e => update(i, { phone: e.target.value })} placeholder="Phone" className="input-base w-full text-sm" />
            </div>
          )}

          {linkingIndex !== i && (
            <button type="button" onClick={() => setLinkingIndex(i)}
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline">
              <Link2 size={11} /> {c.linked_client_id ? 'Re-link to a client' : 'Link to an existing client'}
            </button>
          )}
        </div>
      ))}

      {availableSuggestions.length > 0 && (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Suggested from linked clients</p>
          <div className="flex flex-wrap gap-1.5">
            {availableSuggestions.map(s => (
              <button key={s.id} type="button" onClick={() => void addFromSuggestion(s)}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border border-[var(--border)] bg-white hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                <Avatar name={s.name} size={16} /> {s.name}
                {s.role && <span className="text-[var(--text-muted)]">· {LINK_ROLE_LABEL[s.role] ?? s.role}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={add}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline">
        <Plus size={14} /> Add contact
      </button>
    </div>
  );
}
