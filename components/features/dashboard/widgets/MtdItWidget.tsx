'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';
import MtdItQuarterStats from '@/components/features/mtd-it/MtdItQuarterStats';
import { currentTaxYear } from '@/lib/mtdIt/quarters';
import type { MtdItClientRow as Row } from '@/types';

/**
 * MtdItWidget — the dashboard MTD IT panel. Shows the same four-quarter status
 * donuts + legend as the MTD tool's own "Quarter status" view (the shared
 * MtdItQuarterStats component, in `embedded` mode), for the current tax year.
 */
export default function MtdItWidget() {
  const openTool = useOpenTool();
  const [clients, setClients] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const taxYear = currentTaxYear(new Date());

  useEffect(() => {
    let active = true;
    fetch(`/api/mtd-it/clients?tax_year=${taxYear}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (active) setClients((d.clients ?? []) as Row[]); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [taxYear]);

  return (
    <WidgetCard
      icon={<CalendarCheck size={15} className="text-[var(--accent)]" />}
      title="MTD IT"
      onViewAll={() => openTool('mtd-it', 'MTD IT', '/mtd-it', CalendarCheck)}
    >
      {failed ? (
        <div className="h-full flex items-center justify-center text-center">
          <p className="text-xs text-[var(--text-muted)]">Couldn&apos;t load MTD IT data.</p>
        </div>
      ) : clients === null ? (
        <WidgetLoading />
      ) : clients.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center gap-1.5">
          <CalendarCheck size={20} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">No MTD IT clients yet.</p>
        </div>
      ) : (
        <MtdItQuarterStats clients={clients} taxYear={taxYear} embedded />
      )}
    </WidgetCard>
  );
}
