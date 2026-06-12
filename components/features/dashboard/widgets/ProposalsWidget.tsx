'use client';

import { useEffect, useState } from 'react';
import { FileSignature } from 'lucide-react';
import { WidgetCard, StatRow, WidgetLoading, useOpenTool } from './shared';

interface Counts { outstanding: number; accepted: number; declined: number; }

export default function ProposalsWidget() {
  const openTool = useOpenTool();
  const [c, setC] = useState<Counts | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/proposals/analytics')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!active) return;
        const k = d?.counts;
        setC({ outstanding: k?.outstanding ?? 0, accepted: k?.accepted ?? 0, declined: k?.declined ?? 0 });
      })
      .catch(() => { if (active) setC({ outstanding: 0, accepted: 0, declined: 0 }); });
    return () => { active = false; };
  }, []);

  return (
    <WidgetCard
      icon={<FileSignature size={15} className="text-[var(--accent)]" />}
      title="Proposals"
      onViewAll={() => openTool('proposals', 'Proposals', '/proposals', FileSignature)}
    >
      {!c ? (
        <WidgetLoading />
      ) : (
        <div className="h-full flex flex-col justify-center gap-2">
          <StatRow label="Awaiting response" value={c.outstanding} color="#f59e0b" />
          <StatRow label="Accepted" value={c.accepted} color="#10b981" />
          <StatRow label="Declined" value={c.declined} color="#ef4444" />
        </div>
      )}
    </WidgetCard>
  );
}
