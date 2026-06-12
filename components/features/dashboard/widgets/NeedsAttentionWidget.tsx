'use client';

/**
 * NeedsAttentionWidget — a firm-wide list of clients that need looking at,
 * derived from live tasks (see /api/dashboard/needs-attention). Each row shows
 * the client, the reason, and an urgency badge (Overdue / Due soon), and links
 * straight to the client record.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { UserRoundCheck } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';
import Avatar from '@/components/ui/Avatar';
import { useDashboardData, type NeedsAttentionClient } from '@/components/features/dashboard/DashboardDataProvider';

const BADGE: Record<NeedsAttentionClient['status'], { cls: string; label: string }> = {
  'overdue':  { cls: 'bg-red-50 text-red-700 border-red-200',       label: 'Overdue'  },
  'due-soon': { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Due soon' },
};

export default function NeedsAttentionWidget() {
  const openTool = useOpenTool();
  const shared = useDashboardData();
  const [own, setOwn] = useState<NeedsAttentionClient[] | null>(null);

  // Prefer the shared provider; only self-fetch if rendered without it.
  useEffect(() => {
    if (shared) return;
    let active = true;
    fetch('/api/dashboard/needs-attention')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) setOwn(d?.clients ?? []); })
      .catch(() => { if (active) setOwn([]); });
    return () => { active = false; };
  }, [shared]);

  const clients = shared ? shared.needsAttention : own;

  return (
    <WidgetCard
      icon={<UserRoundCheck size={15} className="text-[var(--accent)]" />}
      title="Needs Attention"
      onViewAll={() => openTool('tasks', 'Tasks', '/tasks', UserRoundCheck)}
    >
      {clients === null ? (
        <WidgetLoading />
      ) : clients.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
          <UserRoundCheck size={20} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">Nothing needs attention — all clients on track.</p>
        </div>
      ) : (
        <ul className="h-full overflow-y-auto scrollbar-thin space-y-2.5 -mx-1 px-1">
          {clients.map(c => {
            const b = BADGE[c.status];
            return (
              <li key={c.clientId}>
                <Link href={`/clients/${c.clientId}`} className="flex items-center gap-2.5 group">
                  <Avatar name={c.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent)]">{c.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">{c.reason}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${b.cls}`}>
                    {b.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
