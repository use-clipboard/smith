'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, Search } from 'lucide-react';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import ProfileTab from './ProfileTab';
import type { TeamMember } from './HrClient';

interface Props {
  viewerId: string;
  viewerRole: 'admin' | 'staff';
  team: TeamMember[];
  /** Bubble a saved row back up to HrClient so the team list reflects the
   *  new value immediately. */
  onMemberUpdated?: (member: Partial<TeamMember> & { id: string }) => void;
}

export default function TeamProfilesTab({ viewerId, viewerRole, team, onMemberUpdated }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Admins see everyone except themselves; managers see only their direct reports.
  const visible = useMemo(() => {
    const base = viewerRole === 'admin'
      ? team.filter(m => m.id !== viewerId)
      : team.filter(m => m.manager_id === viewerId);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(m =>
      (m.full_name ?? '').toLowerCase().includes(q) ||
      (m.email ?? '').toLowerCase().includes(q) ||
      (m.job_title ?? '').toLowerCase().includes(q),
    );
  }, [team, viewerId, viewerRole, search]);

  const selected = useMemo(() => team.find(m => m.id === selectedId), [team, selectedId]);

  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedId(null)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline">
          <ChevronLeft size={13} />Back to team profiles
        </button>
        <ProfileTab userId={selected.id} viewerId={viewerId} viewerRole={viewerRole} team={team} onMemberUpdated={onMemberUpdated} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search team…"
          className="input-base text-sm w-full pl-9"
        />
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-[var(--border)]">
          <p className="text-sm text-[var(--text-muted)]">
            {viewerRole === 'admin' ? 'No team members in your firm yet.' : 'You don’t manage anyone yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {visible.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-nav-hover)] transition-colors text-left"
            >
              <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white ${avatarColour(m.id)}`}>
                {initials(m.full_name, m.email)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">{m.full_name ?? m.email}</p>
                <p className="text-xs text-[var(--text-muted)]">{m.job_title ?? '—'}</p>
              </div>
              <span className="text-xs text-[var(--accent)]">View →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
