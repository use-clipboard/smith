'use client';

import { Users, Trash2 } from 'lucide-react';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import type { CgtOwner } from './types';

/** Business types that file a personal SA return — the only clients that can
 *  jointly own a personal asset (interest, property, a CGT disposal). */
export const PERSONAL_CLIENT_TYPES = ['individual', 'sole_trader'];

let _oid = 0;
const oid = () => `o-${Date.now()}-${_oid++}`;

/** Reusable ownership split — the taxpayer plus co-owners (each linked to a
 *  client) at any percentages totalling 100%. Used by the CGT calculator and
 *  joint interest. */
export default function OwnershipEditor({ owners, onChange, taxpayerName, compact }: {
  owners: CgtOwner[];
  onChange: (owners: CgtOwner[]) => void;
  taxpayerName: string;
  compact?: boolean;
}) {
  const total = owners.reduce((a, o) => a + (o.sharePct || 0), 0);
  const init = () => onChange([
    { id: oid(), name: taxpayerName || 'You', sharePct: 50, isTaxpayer: true },
    { id: oid(), name: '', sharePct: 50 },
  ]);

  if (owners.length === 0) {
    return (
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--text-muted)]">Owned 100% by {taxpayerName || 'the taxpayer'}.</p>
        <button onClick={init} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">Split with co-owner(s)</button>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {!compact && <p className="flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><Users size={11} /> Ownership</p>}
      {owners.map(o => (
        <div key={o.id} className="flex flex-wrap items-center gap-1.5">
          {o.isTaxpayer ? (
            <span className="min-w-0 flex-1 truncate rounded-md bg-[var(--accent)]/10 px-2 py-1 text-[11.5px] font-semibold text-[var(--accent)]">{taxpayerName || 'You'} (this return)</span>
          ) : (
            <div className="min-w-0 flex-1"><ClientSearchInput value={o.clientId ?? ''} valueName={o.name} businessTypes={PERSONAL_CLIENT_TYPES} placeholder="Link co-owner’s client…" onChange={(id, name, ref) => onChange(owners.map(x => x.id === o.id ? { ...x, clientId: id, clientRef: ref, name: name || x.name } : x))} /></div>
          )}
          <div className="flex items-center rounded-md border border-[var(--border)] bg-white px-1.5">
            <input type="number" value={o.sharePct || ''} onChange={e => onChange(owners.map(x => x.id === o.id ? { ...x, sharePct: Number(e.target.value) || 0 } : x))} className="w-12 bg-transparent py-1 text-right text-[12px] outline-none" />
            <span className="text-[11px] text-[var(--text-muted)]">%</span>
          </div>
          {!o.isTaxpayer && <button onClick={() => onChange(owners.filter(x => x.id !== o.id))} className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-rose-500"><Trash2 size={12} /></button>}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button onClick={() => onChange([...owners, { id: oid(), name: '', sharePct: 0 }])} className="text-[11px] font-semibold text-[var(--accent)] hover:underline">+ Add owner</button>
        <span className={`text-[10.5px] ${total === 100 ? 'text-[var(--text-muted)]' : 'text-amber-600'}`}>Total {total}%{total !== 100 ? ' — should be 100%' : ''}</span>
      </div>
    </div>
  );
}
