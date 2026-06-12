'use client';

import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';

export default function VaultWidget() {
  const openTool = useOpenTool();
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/vault/sync/status')
      .then(r => r.ok ? r.json() : { untaggedCount: 0 })
      .then(d => { if (active) setN(d.untaggedCount ?? 0); })
      .catch(() => { if (active) setN(0); });
    return () => { active = false; };
  }, []);

  return (
    <WidgetCard
      icon={<Archive size={15} className="text-[var(--accent)]" />}
      title="Document Vault"
      onViewAll={() => openTool('document-vault', 'Document Vault', '/vault', Archive)}
    >
      {n === null ? (
        <WidgetLoading />
      ) : (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <p className="text-4xl font-bold leading-none" style={{ color: n > 0 ? '#f59e0b' : '#10b981' }}>{n}</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {n === 0 ? 'All documents tagged' : n === 1 ? 'document to tag' : 'documents to tag'}
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
