'use client';

import { useEffect, useRef, useState } from 'react';
import { Users, Loader2, AlertTriangle } from 'lucide-react';
import type { AudienceGroup, AudiencePreview as PreviewData, AudienceSource } from '@/types/campaigns';

interface Props {
  source: AudienceSource;
  definition?: AudienceGroup;
  memberClientIds?: string[];
}

export default function AudiencePreview({ source, definition, memberClientIds }: Props) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = JSON.stringify({ source, definition, memberClientIds });

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch('/api/campaigns/audiences/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, definition, member_client_ids: memberClientIds }),
        });
        if (r.ok) setData(await r.json());
      } finally { setLoading(false); }
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users size={15} style={{ color: 'var(--accent)' }} />
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">Live audience</h4>
        {loading && <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-[var(--text-primary)] tracking-tight">{data?.sendable ?? 0}</span>
        <span className="text-sm text-[var(--text-secondary)]">will receive it</span>
      </div>
      <div className="text-xs text-[var(--text-secondary)] mt-1">
        {data ? `${data.total} matched · ` : ''}
        {data && data.noEmail > 0 && <span className="inline-flex items-center gap-1 mr-2 text-amber-600"><AlertTriangle size={11} />{data.noEmail} no email</span>}
        {data && data.unsubscribed > 0 && <span className="mr-2">{data.unsubscribed} unsubscribed</span>}
        {data && data.duplicates > 0 && <span className="mr-2">{data.duplicates} duplicate address{data.duplicates === 1 ? '' : 'es'}</span>}
        {data && data.tooRecent > 0 && <span className="mr-2">{data.tooRecent} emailed too recently</span>}
      </div>

      {data && data.sample.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Sample recipients</div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-thin">
            {data.sample.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[var(--text-primary)] truncate">{r.name || '(no name)'}</span>
                <span className={`truncate ${r.excludedReason ? 'text-amber-600' : 'text-[var(--text-secondary)]'}`}>
                  {r.email || '— no email'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
