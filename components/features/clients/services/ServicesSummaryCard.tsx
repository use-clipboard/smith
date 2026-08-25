'use client';

// Compact Services summary for the client Overview. Reads the same endpoint as
// the Services tab and links across to it.

import { useEffect, useState } from 'react';
import { Briefcase, ArrowRight } from 'lucide-react';
import { serviceIcon } from './serviceIcons';
import { monthlyRecurringPence, type ClientService } from '@/lib/services/serviceTypes';

function fmtMoney(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ServicesSummaryCard({ clientId, onOpen }: { clientId: string; onOpen?: () => void }) {
  const [services, setServices] = useState<ClientService[] | null>(null);

  useEffect(() => {
    fetch(`/api/clients/${clientId}/services`).then(r => (r.ok ? r.json() : { services: [] }))
      .then(d => setServices(d.services ?? [])).catch(() => setServices([]));
  }, [clientId]);

  const active = (services ?? []).filter(s => s.status === 'active');
  const monthly = monthlyRecurringPence(services ?? []);

  return (
    <div className="glass rounded-xl p-5 h-[320px] flex flex-col">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          Services{active.length > 0 ? ` (${active.length})` : ''}
        </span>
        {onOpen && (
          <button onClick={onOpen} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
            Manage <ArrowRight size={12} />
          </button>
        )}
      </div>

      {services === null ? (
        <p className="text-sm text-[var(--text-muted)] py-6 text-center">Loading…</p>
      ) : active.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
          <Briefcase size={20} className="text-[var(--text-muted)] opacity-40" />
          <p className="text-xs text-[var(--text-muted)]">No services yet.</p>
          {onOpen && <button onClick={onOpen} className="text-xs text-[var(--accent)] font-medium hover:underline">Add a service</button>}
        </div>
      ) : (
        <>
          {monthly > 0 && (
            <div className="mb-3 shrink-0">
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Monthly recurring</p>
              <p className="text-lg font-bold text-[var(--text-primary)]">{fmtMoney(monthly)} <span className="text-[11px] font-normal text-[var(--text-muted)]">excl VAT</span></p>
            </div>
          )}
          <ul className="flex-1 min-h-0 overflow-y-auto scrollbar-thin space-y-1.5 -mx-1 px-1">
            {active.map(svc => {
              const Icon = serviceIcon(svc.icon);
              return (
                <li key={svc.id} className="flex items-center gap-2.5 rounded-lg border border-[var(--border-card)] bg-white/50 px-2.5 py-2">
                  <span className="grid place-items-center h-7 w-7 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] shrink-0"><Icon size={13} /></span>
                  <span className="text-sm text-[var(--text-primary)] truncate flex-1">{svc.name}</span>
                  {svc.pricePence != null && <span className="text-xs text-[var(--text-muted)] tabular-nums shrink-0">{fmtMoney(svc.pricePence)}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
