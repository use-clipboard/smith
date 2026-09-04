'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, Building2, FileText, Calendar } from 'lucide-react';
import { StudioCard } from '../primitives';
import { fetchJson } from '@/lib/fetchJson';
import type { TaxReturn, Sa800Data } from '../types';

// SA800 Setup — the partnership's identity + accounting period. Seeds the UTR and
// business name from the linked client record; the period is captured here and on
// the Review → Details tab.
interface ClientRecord { utr_number?: string | null; name?: string | null }

export default function StageSetupSa800({ ret, patch, advance }: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}): JSX.Element {
  const sa = ret.sa800 ?? { trading: {}, statement: { partners: [] } };
  const setData = (u: Partial<Sa800Data>) => patch(r => ({ ...r, sa800: { ...(r.sa800 as Sa800Data), ...u } }));

  const pulled = useRef(false);
  useEffect(() => {
    if (pulled.current || !ret.clientId) return;
    pulled.current = true;
    (async () => {
      try {
        const { client } = await fetchJson<{ client: ClientRecord }>(`/api/clients/${ret.clientId}`, { cache: 'no-store' });
        patch(r => ({
          ...r,
          utr: r.utr ? r.utr : (client.utr_number ?? r.utr ?? null),
          sa800: { ...(r.sa800 as Sa800Data), businessName: (r.sa800 as Sa800Data).businessName || client.name || r.clientName },
        }));
      } catch { /* best-effort */ }
    })();
  }, [ret.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <StudioCard className="p-5">
        <div className="mb-3 flex items-center gap-1.5">
          <Building2 size={15} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Partnership details</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label icon={Building2}>Name of business</Label>
            <input value={sa.businessName ?? ret.clientName ?? ''} onChange={e => setData({ businessName: e.target.value })} className="input-base py-1.5 text-sm" />
          </div>
          <div>
            <Label icon={FileText}>Partnership UTR</Label>
            <input value={ret.utr ?? ''} onChange={e => patch(r => ({ ...r, utr: e.target.value }))} placeholder="10-digit partnership UTR" className="input-base py-1.5 text-sm" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label icon={Calendar}>Accounting period start</Label>
            <input type="date" value={sa.periodStart ?? ''} onChange={e => setData({ periodStart: e.target.value })} className="input-base py-1.5 text-sm" />
          </div>
          <div>
            <Label icon={Calendar}>Accounting period end</Label>
            <input type="date" value={sa.periodEnd ?? ''} onChange={e => setData({ periodEnd: e.target.value })} className="input-base py-1.5 text-sm" />
          </div>
        </div>
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">Continue to analyse <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

function Label({ icon: Icon, children }: { icon: typeof Building2; children: React.ReactNode }) {
  return <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]"><Icon size={12} /> {children}</label>;
}
