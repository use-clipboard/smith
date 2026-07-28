'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';

interface TeamMember { id: string; full_name: string | null; email: string; role: string }

/**
 * Multi-select of firm team members to ADDITIONALLY notify (in-app + email) when
 * a client approves or requests changes. Shared by the Accounts Studio and MTD
 * IT settings tabs so both work identically.
 */
export default function NotifyMembersPicker({
  value, onChange, disabled = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);

  useEffect(() => {
    fetch('/api/users/team')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMembers(d?.members ?? []))
      .catch(() => setMembers([]));
  }, []);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);

  if (members === null) {
    return <div className="flex items-center gap-2 py-2 text-xs text-gray-400"><Loader2 size={13} className="animate-spin" /> Loading team…</div>;
  }
  if (members.length === 0) {
    return <p className="py-1 text-xs text-gray-400">No other team members found.</p>;
  }

  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {members.map(m => {
        const checked = value.includes(m.id);
        return (
          <label
            key={m.id}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
              checked ? 'border-indigo-300 bg-indigo-50/60' : 'border-gray-200 bg-white hover:bg-gray-50'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(m.id)} className="rounded" />
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400"><Users size={12} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-gray-800">{m.full_name || m.email}</span>
              <span className="block truncate text-[10.5px] text-gray-400">{m.email}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
