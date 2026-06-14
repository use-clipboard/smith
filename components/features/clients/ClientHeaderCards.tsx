'use client';

/**
 * ClientHeaderCards — the "Account Manager" and "Relationship since" cards shown
 * on the right of the client header. Reads from /api/clients/[id]/overview.
 * Clicking the account manager opens their team profile.
 */

import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import { useOpenProfile } from '@/components/features/team/useOpenProfile';

interface Manager { id: string; name: string; jobTitle: string | null; avatarUrl: string | null }

function sinceLabel(iso: string): string {
  const start = new Date(iso); const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months--;
  months = Math.max(0, months);
  const y = Math.floor(months / 12); const m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} year${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} month${m > 1 ? 's' : ''}`);
  return parts.join(', ') || 'Less than a month';
}

export default function ClientHeaderCards({ clientId }: { clientId: string }) {
  const openProfile = useOpenProfile();
  const [manager, setManager] = useState<Manager | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/clients/${clientId}/overview`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => {
        if (!active || !d) return;
        setManager(d.client?.manager ?? null);
        setSince(d.client?.relationshipSince ?? null);
        setLoaded(true);
      });
    return () => { active = false; };
  }, [clientId]);

  if (!loaded) return null;

  return (
    <div className="hidden lg:flex items-stretch gap-2.5 shrink-0">
      {/* Account Manager */}
      <div className="rounded-lg border border-[var(--border-card)] bg-white/60 shadow-sm px-3 py-2.5 w-[190px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Account Manager</p>
        {manager ? (
          <button onClick={() => openProfile(manager.id, manager.name)} className="flex items-center gap-2 group text-left w-full">
            <Avatar name={manager.name} avatarUrl={manager.avatarUrl} size={28} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)]">{manager.name}</p>
              {manager.jobTitle && <p className="text-[11px] text-[var(--text-muted)] truncate">{manager.jobTitle}</p>}
            </div>
          </button>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Not assigned</p>
        )}
      </div>

      {/* Relationship since */}
      {since && (
        <div className="rounded-lg border border-[var(--border-card)] bg-white/60 shadow-sm px-3 py-2.5 w-[190px]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Relationship since</p>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
              <CalendarDays size={15} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{new Date(since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              <p className="text-[11px] text-[var(--text-muted)]">{sinceLabel(since)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
